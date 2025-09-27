// chatserver.js
require('dotenv').config(); // Đọc MONGODB_URI từ .env
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const CryptoJS = require('crypto-js');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// ================== MongoDB ==================
if (!process.env.MONGODB_URI) {
  console.error("❌ MONGODB_URI is not defined in environment variables!");
  process.exit(1);
}

const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: ServerApiVersion.v1
});
let db;

async function connectDB() {
  await client.connect();
  db = client.db('chatapp'); // tên database
  console.log("✅ Connected to MongoDB!");
}
connectDB().catch(console.error);

// ================== Serve index.html ==================
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ================== REGISTER ==================
app.post("/register", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ success: false, message: "Thiếu thông tin" });

    const users = db.collection('users');
    const exists = await users.findOne({ username });
    if (exists) return res.status(400).json({ success: false, message: "Tên đã tồn tại" });

    const hash = await bcrypt.hash(password, 10);
    await users.insertOne({ username, password: hash });
    res.json({ success: true, message: "Đăng ký thành công" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
});

// ================== LOGIN ==================
app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const users = db.collection('users');
    const user = await users.findOne({ username });
    if (!user) return res.status(401).json({ success: false, message: "Sai tài khoản hoặc mật khẩu" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ success: false, message: "Sai tài khoản hoặc mật khẩu" });

    res.json({ success: true, message: "Đăng nhập thành công" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
});

// ================== SOCKET.IO ==================
io.on("connection", async (socket) => {
  console.log("🔗 User connected:", socket.id);

  const messagesCol = db.collection('messages');

  // gửi lịch sử tin nhắn
  const history = await messagesCol.find({}).sort({ createdAt: 1 }).toArray();
  socket.emit("message_history", history);

  // Nhận tin nhắn
  socket.on("chat_message", async (data) => {
    try {
      const { from, message } = data;
      // Mã hóa E2E
      const key = CryptoJS.enc.Utf8.parse(socket.id); // key ngẫu nhiên theo socket
      const encrypted = CryptoJS.AES.encrypt(message, key).toString();

      const msgObj = {
        from,
        message: encrypted,
        createdAt: new Date()
      };

      await messagesCol.insertOne(msgObj);

      // gửi đến tất cả
      io.emit("message", { from, message: encrypted });
    } catch (err) {
      console.error(err);
    }
  });

  socket.on("disconnect", () => {
    console.log("❌ User disconnected:", socket.id);
  });
});

// ================== AUTO XÓA TIN NHẮN ==================
async function cleanupOldMessages() {
  const messagesCol = db.collection('messages');
  const now = new Date();
  const twoMonthsAgo = new Date(now.getTime() - 60*24*60*60*1000); // 2 tháng
  const oneWeekBefore = new Date(now.getTime() - 53*24*60*60*1000); // 1 tuần trước

  // thông báo cho tin nhắn sắp xóa
  const soonDelete = await messagesCol.find({ createdAt: { $gte: oneWeekBefore, $lt: twoMonthsAgo } }).toArray();
  soonDelete.forEach(msg => {
    io.emit("message_warning", { id: msg._id, from: msg.from, message: msg.message });
  });

  // xóa tin nhắn 2 tháng
  const result = await messagesCol.deleteMany({ createdAt: { $lt: twoMonthsAgo } });
  if (result.deletedCount > 0) {
    console.log(`🗑 Xóa ${result.deletedCount} tin nhắn cũ hơn 2 tháng`);
  }
}

// chạy cleanup mỗi ngày
setInterval(() => {
  cleanupOldMessages().catch(console.error);
}, 24*60*60*1000);

// ================== SERVER ==================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
