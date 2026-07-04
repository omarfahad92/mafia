// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// إدارة حالة اللعبة
let gameState = {
    phase: 'LOBBY', // LOBBY, NIGHT, DAY, VOTING_REVEAL
    players: {},    // { socketId: { id, name, role, isAlive, votedFor } }
    hostId: null,
    nightSummary: '',
    actions: { kill: null, save: null, spyTarget: null }
};

// الأدوار المتاحة (يتم توزيعها عشوائياً)
const ROLES = ['Mafia', 'Mafia', 'Doctor', 'Spy', 'Detective', 'Citizen', 'Citizen'];

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

io.on('connection', (socket) => {
    console.log('لاعب متصل:', socket.id);

    // تعيين الهوست (أول شخص يدخل أو يطلب صلاحية الهوست)
    socket.on('registerHost', () => {
        gameState.hostId = socket.id;
        socket.emit('initHost', gameState);
        io.emit('updatePlayers', Object.values(gameState.players));
    });

    // *** حل مشكلة زر التأكيد للاعبين ***
    socket.on('joinGame', (playerName) => {
        if (!playerName || playerName.trim() === '') {
            socket.emit('errorMsg', 'الرجاء إدخال اسم صحيح');
            return;
        }
        
        // تسجيل اللاعب وحجز المقعد
        gameState.players[socket.id] = {
            id: socket.id,
            name: playerName.trim(),
            role: null,
            isAlive: true,
            votedFor: null
        };
        
        console.log(`تم تسجيل اللاعب بنجاح: ${playerName}`);
        socket.emit('playerRegistered', gameState.players[socket.id]);
        io.emit('updatePlayers', Object.values(gameState.players));
        io.emit('gameStateChanged', { phase: gameState.phase, nightSummary: gameState.nightSummary });
    });

    // توزيع الأدوار وبدء اللعبة
    socket.on('distributeRoles', () => {
        if (socket.id !== gameState.hostId) return;
        
        const playerIds = Object.keys(gameState.players);
        if (playerIds.length === 0) return;

        // خلط الأدوار عشوائياً
        let shuffledRoles = [...ROLES];
        if (playerIds.length > shuffledRoles.length) {
            // إضافة مواطنين زيادة لو عدد اللاعبين أكبر
            while (shuffledRoles.length < playerIds.length) shuffledRoles.push('Citizen');
        }
        shuffledRoles = shuffledRoles.sort(() => Math.random() - 0.5);

        playerIds.forEach((id, index) => {
            gameState.players[id].role = shuffledRoles[index];
            gameState.players[id].isAlive = true;
            gameState.players[id].votedFor = null;
            // إرسال الدور لكل لاعب بشكل سري
            io.to(id).emit('yourRole', gameState.players[id].role);
        });

        gameState.phase = 'LOBBY_READY';
        io.emit('gameStateChanged', { phase: gameState.phase });
        io.emit('updatePlayers', Object.values(gameState.players));
        updateMafiaChat();
    });

    // الانتقال لوقت الليل
    socket.on('startNight', () => {
        if (socket.id !== gameState.hostId) return;
        gameState.phase = 'NIGHT';
        gameState.actions = { kill: null, save: null, spyTarget: null };
        // تصفير التصويت
        Object.keys(gameState.players).forEach(id => gameState.players[id].votedFor = null);
        
        io.emit('gameStateChanged', { phase: gameState.phase, nightSummary: '' });
    });

    // أفعال الأدوار في الليل
    socket.on('nightAction', ({ actionType, targetId }) => {
        const player = gameState.players[socket.id];
        if (!player || !player.isAlive || gameState.phase !== 'NIGHT') return;

        if (player.role === 'Mafia' && actionType === 'kill') gameState.actions.kill = targetId;
        if (player.role === 'Doctor' && actionType === 'save') gameState.actions.save = targetId;
        
        if (player.role === 'Spy' && actionType === 'investigate') {
            const target = gameState.players[targetId];
            if (target && target.role === 'Mafia') {
                // الجاسوس كشف المافيا -> ينضم فوراً لشات المافيا
                socket.emit('spyDiscoveredMafia', true);
            } else {
                socket.emit('spyDiscoveredMafia', false);
            }
        }
        updateMafiaChat();
    });

    // الانتقال لوقت الصباح وإعلان الملخص
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

    // تصويت اللاعبين في النهار
    socket.on('castVote', (targetId) => {
        if (gameState.phase !== 'DAY' || !gameState.players[socket.id]?.isAlive) return;
        gameState.players[socket.id].votedFor = targetId;
        io.emit('updatePlayers', Object.values(gameState.players));
    });

    // إنهاء التصويت وعرض النتائج ثم الانتقال التلقائي لليل
    socket.on('revealVotes', () => {
        if (socket.id !== gameState.hostId) return;
        gameState.phase = 'VOTING_REVEAL';
        io.emit('gameStateChanged', { phase: gameState.phase });

        // انتقال تلقائي لليل بعد 7 ثوانٍ من عرض النتائج
        setTimeout(() => {
            gameState.phase = 'NIGHT';
            gameState.actions = { kill: null, save: null, spyTarget: null };
            Object.keys(gameState.players).forEach(id => gameState.players[id].votedFor = null);
            io.emit('gameStateChanged', { phase: gameState.phase, nightSummary: 'بدأت ليلة جديدة تلقائياً...' });
        }, 7000);
    });

    // شات المافيا والجاسوس
    socket.on('sendMafiaMessage', (msg) => {
        const sender = gameState.players[socket.id];
        if (!sender) return;
        // إرسال للمافيا، الجاسوس، وللهوست دائماً للمراقبة
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

server.listen(3000, () => {
    console.log('الموقع شغال على الرابط: http://localhost:3000');
});