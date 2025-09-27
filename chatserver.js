// chatserver.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// --- MongoDB setup ---
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI is not defined in environment variables!');
  process.exit(1);
}

const client = new MongoClient(MONGODB_URI);
let db;
async function connectDB() {
  try {
    await client.connect();
    db = client.db('chatapp');
    console.log('✅ Connected to MongoDB');
  } catch (err) {
    console.error('❌ MongoDB connection error:', err);
  }
}
connectDB();

// --- Helper functions ---
function generatePassphrase() {
  return crypto.randomBytes(32).toString('hex'); // 64 char hex key
}

function encryptMessage(message, passphrase) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(passphrase, 'hex'), iv);
  let encrypted = cipher.update(message, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return { iv: iv.toString('hex'), tag, encrypted };
}

function decryptMessage(encryptedObj, passphrase) {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    Buffer.from(passphrase, 'hex'),
    Buffer.from(encryptedObj.iv, 'hex')
  );
  decipher.setAuthTag(Buffer.from(encryptedObj.tag, 'hex'));
  let decrypted = decipher.update(encryptedObj.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// --- Auto delete messages older than 2 months ---
async function cleanOldMessages() {
  const now = new Date();
  const twoMonthsAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000); // 60 days
  const oneWeekBefore = new Date(twoMonthsAgo.getTime() + 7 * 24 * 60 * 60 * 1000);
  
  const oldMsgs = await db.collection('messages').find({ createdAt: { $lt: twoMonthsAgo } }).toArray();
  if (oldMsgs.length) {
    console.log(`🗑 Deleting ${oldMsgs.length} messages older than 2 months.`);
    await db.collection('messages').deleteMany({ createdAt: { $lt: twoMonthsAgo } });
  }

  const upcomingDelete = await db.collection('messages').find({ createdAt: { $lt: oneWeekBefore, $gte: twoMonthsAgo } }).toArray();
  if (upcomingDelete.length) {
    console.log(`⚠️ ${upcomingDelete.length} messages will be deleted in 1 week.`);
  }
}

// Run cleanup every hour
setInterval(cleanOldMessages, 60 * 60 * 1000);

// --- Routes ---
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });

  const existing = await db.collection('users').findOne({ username });
  if (existing) return res.status(400).json({ error: 'Username already exists' });

  const hashed = await bcrypt.hash(password, 10);
  const passphrase = generatePassphrase();
  await db.collection('users').insertOne({ username, password: hashed, passphrase });

  res.json({ success: true, message: 'User registered', passphrase });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });

  const user = await db.collection('users').findOne({ username });
  if (!user) return res.status(400).json({ error: 'User not found' });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(400).json({ error: 'Incorrect password' });

  res.json({ success: true, message: 'Login successful', passphrase: user.passphrase });
});

// --- Socket.io ---
io.on('connection', (socket) => {
  console.log('🔗 New client connected');

  socket.on('sendMessage', async (data) => {
    try {
      const { username, message, passphrase } = data;
      const encrypted = encryptMessage(message, passphrase);
      const doc = { username, encrypted, createdAt: new Date() };
      await db.collection('messages').insertOne(doc);

      io.emit('receiveMessage', { username, message }); // broadcast plaintext to client
    } catch (err) {
      console.error('❌ Error sending message:', err);
    }
  });

  socket.on('getMessages', async (passphrase) => {
    const msgs = await db.collection('messages').find({}).sort({ createdAt: 1 }).toArray();
    const decryptedMsgs = msgs.map(m => {
      let msgText = '';
      try {
        msgText = decryptMessage(m.encrypted, passphrase);
      } catch (e) {
        msgText = '[Cannot decrypt]';
      }
      return { username: m.username, message: msgText, createdAt: m.createdAt };
    });
    socket.emit('allMessages', decryptedMsgs);
  });

  socket.on('disconnect', () => console.log('🔗 Client disconnected'));
});

// --- Start server ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
