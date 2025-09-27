const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const bcrypt = require("bcryptjs");
const { MongoClient } = require("mongodb");
const cron = require("node-cron");
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MongoDB
const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("❌ MONGODB_URI is not defined in environment variables!");
  process.exit(1);
}
const client = new MongoClient(uri);
let usersCol, messagesCol;

// Connect Mongo
async function connectMongo() {
  await client.connect();
  const db = client.db("chatapp");
  usersCol = db.collection("users");
  messagesCol = db.collection("messages");
}
connectMongo();

// Serve static html
const path = require("path");
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Register
app.post("/register", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, message: "Thiếu thông tin" });

  const exists = await usersCol.findOne({ username });
  if (exists) return res.status(400).json({ success: false, message: "Tên đã tồn tại" });

  const hash = await bcrypt.hash(password, 10);
  await usersCol.insertOne({ username, password: hash });
  res.json({ success: true, message: "Đăng ký thành công" });
});

// Login
app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const user = await usersCol.findOne({ username });
  if (!user) return res.status(401).json({ success: false, message: "Sai tài khoản hoặc mật khẩu" });

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(401).json({ success: false, message: "Sai tài khoản hoặc mật khẩu" });

  res.json({ success: true, message: "Đăng nhập thành công" });
});

// ====== SOCKET.IO ======
const passphrase = require("crypto").randomBytes(16).toString("hex");

io.on("connection", async (socket) => {
  console.log("🔗 User connected:", socket.id);
  socket.emit("set_passphrase", passphrase);

  // Send message history
  const history = await messagesCol.find().sort({ time: 1 }).toArray();
  socket.emit("message_history", history);

  // Receive message
  socket.on("chat_message", async (data) => {
    const msgObj = { ...data, time: new Date() };
    await messagesCol.insertOne(msgObj);
    io.emit("message", msgObj);
  });

  socket.on("disconnect", () => {
    console.log("❌ User disconnected:", socket.id);
  });
});

// ====== CLEANUP OLD MESSAGES ======
// Every day at midnight
cron.schedule("0 0 * * *", async () => {
  const twoMonthsAgo = new Date();
  twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
  const oneWeekBefore = new Date();
  oneWeekBefore.setDate(twoMonthsAgo.getDate() - 7);

  const toDelete = await messagesCol.find({ time: { $lte: twoMonthsAgo } }).toArray();
  toDelete.forEach(msg => {
    if (msg.time <= oneWeekBefore) {
      messagesCol.deleteOne({ _id: msg._id });
    } else {
      // Notify users 1 week before
      io.emit("message", { from: "System", message: `Tin nhắn từ ${msg.from} sẽ xóa vào tuần sau.`, time: new Date() });
    }
  });
});

// ====== RUN SERVER ======
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
