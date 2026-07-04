const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

let gameState = {
    phase: 'LOBBY', 
    players: {},    
    hostId: null,
    nightSummary: '',
    actions: { kill: null, save: null }
};

// مصفوفة الأدوار باللغة العربية لتتوافق مع تصميمك الفخم أونلاين
const ROLES = ['مافيا', 'مافيا', 'طبيب', 'تحري', 'مواطن', 'مواطن', 'مواطن'];

app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

io.on('connection', (socket) => {
    socket.on('registerHost', () => {
        gameState.hostId = socket.id;
        io.emit('updatePlayers', Object.values(gameState.players));
    });

    socket.on('joinGame', (playerName) => {
        gameState.players[socket.id] = {
            id: socket.id,
            name: playerName.trim(),
            role: null,
            isAlive: true,
            votedFor: null
        };
        socket.emit('playerRegistered', gameState.players[socket.id]);
        io.emit('updatePlayers', Object.values(gameState.players));
    });

    socket.on('distributeRoles', () => {
        const playerIds = Object.keys(gameState.players);
        if (playerIds.length === 0) return;

        let shuffledRoles = [...ROLES];
        while (shuffledRoles.length < playerIds.length) shuffledRoles.push('مواطن');
        shuffledRoles = shuffledRoles.sort(() => Math.random() - 0.5);

        playerIds.forEach((id, index) => {
            gameState.players[id].role = shuffledRoles[index];
            gameState.players[id].isAlive = true;
            gameState.players[id].votedFor = null;
            io.to(id).emit('yourRole', gameState.players[id].role);
        });

        io.emit('updatePlayers', Object.values(gameState.players));
    });

    socket.on('startNight', () => {
        gameState.phase = 'NIGHT';
        Object.keys(gameState.players).forEach(id => gameState.players[id].votedFor = null);
        io.emit('gameStateChanged', { phase: gameState.phase, nightSummary: '' });
        io.emit('updatePlayers', Object.values(gameState.players));
    });

    socket.on('startDay', () => {
        gameState.phase = 'DAY';
        gameState.nightSummary = 'طلع الصباح؛ حان الوقت لمناقشة مجريات الليلة والتصويت على المشتبه بهم!';
        io.emit('gameStateChanged', { phase: gameState.phase, nightSummary: gameState.nightSummary });
        io.emit('updatePlayers', Object.values(gameState.players));
    });

    socket.on('castVote', (targetId) => {
        if (gameState.players[socket.id]) {
            gameState.players[socket.id].votedFor = targetId;
            io.emit('updatePlayers', Object.values(gameState.players));
        }
    });

    socket.on('sendMafiaMessage', (msg) => {
        const sender = gameState.players[socket.id];
        if (sender) {
            io.emit('receiveMafiaMessage', { sender: sender.name, text: msg });
        }
    });

    socket.on('disconnect', () => {
        delete gameState.players[socket.id];
        io.emit('updatePlayers', Object.values(gameState.players));
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});