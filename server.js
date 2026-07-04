const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);

// السماح بـ CORS للـ WebSockets لتفادي مشاكل الحظر في الاستضافات
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// إدارة حالة اللعبة
let gameState = {
    phase: 'LOBBY', 
    players: {},    
    hostId: null,
    nightSummary: '',
    actions: { kill: null, save: null, spyTarget: null }
};

const ROLES = ['Mafia', 'Mafia', 'Doctor', 'Spy', 'Detective', 'Citizen', 'Citizen'];

// إرسال ملف الواجهة
app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

io.on('connection', (socket) => {
    console.log('لاعب متصل:', socket.id);

    socket.on('registerHost', () => {
        gameState.hostId = socket.id;
        socket.emit('initHost', gameState);
        io.emit('updatePlayers', Object.values(gameState.players));
    });

    socket.on('joinGame', (playerName) => {
        if (!playerName || playerName.trim() === '') {
            socket.emit('errorMsg', 'الرجاء إدخال اسم صحيح');
            return;
        }
        
        gameState.players[socket.id] = {
            id: socket.id,
            name: playerName.trim(),
            role: null,
            isAlive: true,
            votedFor: null
        };
        
        socket.emit('playerRegistered', gameState.players[socket.id]);
        io.emit('updatePlayers', Object.values(gameState.players));
        io.emit('gameStateChanged', { phase: gameState.phase, nightSummary: gameState.nightSummary });
    });

    socket.on('distributeRoles', () => {
        if (socket.id !== gameState.hostId) return;
        
        const playerIds = Object.keys(gameState.players);
        if (playerIds.length === 0) return;

        let shuffledRoles = [...ROLES];
        if (playerIds.length > shuffledRoles.length) {
            while (shuffledRoles.length < playerIds.length) shuffledRoles.push('Citizen');
        }
        shuffledRoles = shuffledRoles.sort(() => Math.random() - 0.5);

        playerIds.forEach((id, index) => {
            gameState.players[id].role = shuffledRoles[index];
            gameState.players[id].isAlive = true;
            gameState.players[id].votedFor = null;
            io.to(id).emit('yourRole', gameState.players[id].role);
        });

        gameState.phase = 'LOBBY_READY';
        io.emit('gameStateChanged', { phase: gameState.phase });
        io.emit('updatePlayers', Object.values(gameState.players));
        updateMafiaChat();
    });

    socket.on('startNight', () => {
        if (socket.id !== gameState.hostId) return;
        gameState.phase = 'NIGHT';
        gameState.actions = { kill: null, save: null, spyTarget: null };
        Object.keys(gameState.players).forEach(id => gameState.players[id].votedFor = null);
        io.emit('gameStateChanged', { phase: gameState.phase, nightSummary: '' });
    });

    socket.on('nightAction', ({ actionType, targetId }) => {
        const player = gameState.players[socket.id];
        if (!player || !player.isAlive || gameState.phase !== 'NIGHT') return;

        if (player.role === 'Mafia' && actionType === 'kill') gameState.actions.kill = targetId;
        if (player.role === 'Doctor' && actionType === 'save') gameState.actions.save = targetId;
        
        if (player.role === 'Spy' && actionType === 'investigate') {
            const target = gameState.players[targetId];
            if (target && target.role === 'Mafia') {
                socket.emit('spyDiscoveredMafia', true);
            } else {
                socket.emit('spyDiscoveredMafia', false);
            }
        }
        updateMafiaChat();
    });

    socket.on('startDay', () => {
        if (socket.id !== gameState.hostId) return;
        gameState.phase = 'DAY';

        let killedName = 'لا أحد';
        if (gameState.actions.kill && gameState.actions.kill !== gameState.actions.save) {
            const victim = gameState.players[gameState.actions.kill];
            if (victim) {
                victim.isAlive = false;
                killedName = victim.name;
            }
        } else if (gameState.actions.kill && gameState.actions.kill === gameState.actions.save) {
            killedName = 'حاولت المافيا القتل ولكن الطبيب أنقذ الضحية!';
        }

        gameState.nightSummary = `ملخص الليلة: تم إقصاء [ ${killedName} ]`;
        io.emit('gameStateChanged', { phase: gameState.phase, nightSummary: gameState.nightSummary });
        io.emit('updatePlayers', Object.values(gameState.players));
    });

    socket.on('castVote', (targetId) => {
        if (gameState.phase !== 'DAY' || !gameState.players[socket.id]?.isAlive) return;
        gameState.players[socket.id].votedFor = targetId;
        io.emit('updatePlayers', Object.values(gameState.players));
    });

    socket.on('revealVotes', () => {
        if (socket.id !== gameState.hostId) return;
        gameState.phase = 'VOTING_REVEAL';
        io.emit('gameStateChanged', { phase: gameState.phase });

        setTimeout(() => {
            gameState.phase = 'NIGHT';
            gameState.actions = { kill: null, save: null, spyTarget: null };
            Object.keys(gameState.players).forEach(id => gameState.players[id].votedFor = null);
            io.emit('gameStateChanged', { phase: gameState.phase, nightSummary: 'بدأت ليلة جديدة تلقائياً...' });
        }, 7000);
    });

    socket.on('sendMafiaMessage', (msg) => {
        const sender = gameState.players[socket.id];
        if (!sender) return;
        io.emit('receiveMafiaMessage', { sender: sender.name, text: msg });
    });

    socket.on('disconnect', () => {
        delete gameState.players[socket.id];
        io.emit('updatePlayers', Object.values(gameState.players));
    });
});

function updateMafiaChat() {
    const mafiaMembers = Object.values(gameState.players).filter(p => p.role === 'Mafia').map(p => p.name);
    io.emit('mafiaListUpdate', mafiaMembers);
}

// Render يعتمد على الـ PORT البيئي
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`السيرفر شغال على التردد: ${PORT}`);
});