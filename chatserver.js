require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;

// --- MongoDB models ---
mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('MongoDB connected'))
    .catch(err => console.error(err));

const userSchema = new mongoose.Schema({
    username: { type: String, unique: true },
    password: String
});

const messageSchema = new mongoose.Schema({
    from: String,
    to: String,
    encrypted: String,
    timestamp: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Message = mongoose.model('Message', messageSchema);

// --- Routes ---
app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    if(!username || !password) return res.status(400).send('Missing fields');
    const hash = await bcrypt.hash(password, 10);
    try {
        const user = await User.create({ username, password: hash });
        res.json({ success: true });
    } catch (e) {
        res.status(400).json({ success: false, error: 'Username taken' });
    }
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if(!username || !password) return res.status(400).send('Missing fields');
    const user = await User.findOne({ username });
    if(!user) return res.status(400).json({ success: false, error: 'User not found' });
    const match = await bcrypt.compare(password, user.password);
    if(!match) return res.status(400).json({ success: false, error: 'Wrong password' });
    res.json({ success: true });
});

// --- Socket.IO chat ---
io.on('connection', socket => {
    console.log('User connected:', socket.id);
    socket.emit('socket_id', socket.id);

    socket.on('send_message', async ({ from, to, passphrase, message }) => {
        if(!message || !passphrase) return;
        const key = crypto.createHash('sha256').update(passphrase).digest();
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
        let encrypted = cipher.update(message, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const finalMessage = iv.toString('hex') + ':' + encrypted;

        const msgDoc = await Message.create({ from, to, encrypted: finalMessage });
        io.emit('receive_message', { from, to, encrypted: finalMessage });
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

// --- Delete old messages after 2 months (check every 24h) ---
setInterval(async () => {
    const twoMonthsAgo = new Date(Date.now() - 60*24*60*60*1000);
    const oneWeekBefore = new Date(twoMonthsAgo.getTime() + 7*24*60*60*1000);
    const oldMsgs = await Message.find({ timestamp: { $lt: twoMonthsAgo } });
    oldMsgs.forEach(msg => {
        console.log(`Deleting message from ${msg.from} to ${msg.to} older than 2 months`);
        msg.deleteOne();
    });
}, 24*60*60*1000);

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
