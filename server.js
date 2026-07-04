const express = require('express');
const http = require('http');
const path = require('path');
const { ExpressPeerServer } = require('peer');

const app = express();
const server = http.createServer(app);

// تشغيل سيرفر السقنال (PeerJS Server) لربط اللاعبين ببعضهم
const peerServer = ExpressPeerServer(server, {
    debug: true,
    path: '/'
});

// دمج سيرفر PeerJS مع Express
app.use('/peerjs', peerServer);

// تشغيل الملفات الساكنة (index.html وباقي الملفات)
app.use(express.static(path.join(__dirname)));

// عند فتح الرابط الرئيسي يتم عرض ملف الـ HTML الفخم الخاص بك
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// تحديد المنفذ (البورت) للسيرفر
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(`  سيرفر مافيا VEO يعمل بنجاح الآن!`);
    console.log(`  الرابط المحلي: http://localhost:${PORT}`);
    console.log(`==================================================`);
});