require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const { MongoClient } = require('mongodb');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MongoDB connection
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

let db;
client.connect().then(() => {
  db = client.db('chatapp');
  console.log('Connected to MongoDB');
});

// Serve HTML
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// ==== API cho đăng ký + đăng nhập ====
app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).send('Missing fields');

  const exists = await db.collection('users').findOne({ username });
  if (exists) return res.status(400).send('Username exists');

  const hashed = await bcrypt.hash(password, 10);
  await db.collection('users').insertOne({ username, password: hashed });
  res.send('Registered');
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await db.collection('users').findOne({ username });
  if (!user) return res.status(400).send('User not found');

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(400).send('Wrong password');

  res.send('Logged in');
});

// ==== Socket.io ====
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Tạo passphrase ngẫu nhiên cho E2E
  const passphrase = crypto.randomBytes(16).toString('hex');
  socket.passphrase = passphrase;

  // Gửi socket.id và passphrase về client
  socket.emit('yourID', { id: socket.id, passphrase });

  // Nhận tin nhắn từ client và mã hóa E2E
  socket.on('chatMessage', async (data) => {
    const { msg } = data;
    const encrypted = encrypt(msg, socket.passphrase);

    await db.collection('messages').insertOne({
      socketId: socket.id,
      msg: encrypted,
      createdAt: new Date()
    });

    io.emit('chatMessage', { id: socket.id, msg: encrypted });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// ==== Xóa tin nhắn cũ sau 2 tháng, báo trước 1 tuần ====
setInterval(async () => {
  const now = new Date();
  const twoMonthsAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  const oneWeekAgo = new Date(now.getTime() - 53 * 24 * 60 * 60 * 1000);

  // Thông báo sắp xóa
  const soonDelete = await db.collection('messages').find({ createdAt: { $lte: oneWeekAgo, $gt: twoMonthsAgo } }).toArray();
  if (soonDelete.length > 0) console.log('Messages will be deleted in 1 week:', soonDelete.length);

  // Xóa thật sự
  await db.collection('messages').deleteMany({ createdAt: { $lte: twoMonthsAgo } });
}, 24 * 60 * 60 * 1000); // chạy mỗi ngày

// ==== Hàm mã hóa/giải mã E2E ====
function encrypt(text, passphrase) {
  const cipher = crypto.createCipher('aes-256-cbc', passphrase);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
}

function decrypt(encrypted, passphrase) {
  const decipher = crypto.createDecipher('aes-256-cbc', passphrase);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ==== Chạy server ====
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
