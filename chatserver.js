require('dotenv').config();
const express = require('express');
const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');
const http = require('http');
const { Server } = require('socket.io');
const CryptoJS = require('crypto-js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = 'chatapp';

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI is not defined!');
  process.exit(1);
}

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Serve single HTML file
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

const client = new MongoClient(MONGODB_URI);
let usersCollection, messagesCollection;

async function startDB() {
  await client.connect();
  const db = client.db(DB_NAME);
  usersCollection = db.collection('users');
  messagesCollection = db.collection('messages');
  console.log('✅ Connected to MongoDB');
}
startDB().catch(console.error);

const userKeys = {}; // socket.id -> key

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // Generate a random key for this socket session
  const key = CryptoJS.lib.WordArray.random(16).toString();
  userKeys[socket.id] = key;
  socket.emit('key', key);

  socket.on('register', async ({ username, password }) => {
    const existing = await usersCollection.findOne({ username });
    if (existing) {
      socket.emit('registerResponse', { success: false, message: 'Username taken' });
    } else {
      const hash = await bcrypt.hash(password, 10);
      await usersCollection.insertOne({ username, password: hash });
      socket.emit('registerResponse', { success: true, message: 'Registered!' });
    }
  });

  socket.on('login', async ({ username, password }) => {
    const user = await usersCollection.findOne({ username });
    if (!user) {
      socket.emit('loginResponse', { success: false, message: 'User not found' });
    } else {
      const match = await bcrypt.compare(password, user.password);
      if (match) socket.emit('loginResponse', { success: true, username });
      else socket.emit('loginResponse', { success: false, message: 'Wrong password' });
    }
  });

  socket.on('sendMessage', async ({ to, message }) => {
    const key = userKeys[socket.id];
    const encrypted = CryptoJS.AES.encrypt(message, key).toString();
    await messagesCollection.insertOne({ from: socket.id, to, message: encrypted, createdAt: new Date() });
    socket.emit('messageSent', { success: true });
  });

  socket.on('disconnect', () => {
    delete userKeys[socket.id];
  });
});

// ================== Auto delete old messages ==================
async function cleanupMessages() {
  const now = new Date();
  const twoMonthsAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000); // 60 days
  const oneWeekBefore = new Date(now.getTime() - 53 * 24 * 60 * 60 * 1000); // 53 days

  // Find messages to warn users
  const messagesToWarn = await messagesCollection.find({ createdAt: { $gte: oneWeekBefore, $lt: twoMonthsAgo } }).toArray();
  messagesToWarn.forEach(msg => {
    io.to(msg.from).emit('messageWarning', { messageId: msg._id, warning: 'This message will be deleted in 1 week.' });
  });

  // Delete messages older than 60 days
  const result = await messagesCollection.deleteMany({ createdAt: { $lt: twoMonthsAgo } });
  if (result.deletedCount > 0) console.log(`🗑 Deleted ${result.deletedCount} old messages`);
}

// Run cleanup every 24h
setInterval(cleanupMessages, 24 * 60 * 60 * 1000);

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
