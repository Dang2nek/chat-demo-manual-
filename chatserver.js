const fs = require("fs");
const path = require("path");
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const bcrypt = require("bcryptjs");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const USERS_FILE = path.join(__dirname, "users.json");
const MSG_FILE = path.join(__dirname, "messages.json");

// Load dữ liệu
let users = fs.existsSync(USERS_FILE) ? JSON.parse(fs.readFileSync(USERS_FILE)) : {};
let messages = fs.existsSync(MSG_FILE) ? JSON.parse(fs.readFileSync(MSG_FILE)) : [];

// Middleware
app.use(express.json());

// Serve HTML & JS client trực tiếp
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/client.js", (req, res) => res.sendFile(path.join(__dirname, "client.js")));

// ===== API AUTH & SIGNALING =====

// Đăng ký user + lưu hashed password + publicKey
app.post("/register", async (req, res) => {
  const { username, password, publicKey } = req.body;
  if (!username || !password || !publicKey) {
    return res.status(400).json({ error: "Missing fields" });
  }
  if (users[username]) return res.status(400).json({ error: "User exists" });

  const hashed = await bcrypt.hash(password, 10);
  users[username] = { passwordHash: hashed, publicKey };
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));

  res.json({ success: true });
});

// Đăng nhập
app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const user = users[username];
  if (!user) return res.status(400).json({ error: "Invalid credentials" });

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) return res.status(400).json({ error: "Invalid credentials" });

  res.json({ success: true, publicKey: user.publicKey });
});

// Lấy publicKey của user khác
app.get("/publickey/:username", (req, res) => {
  const user = users[req.params.username];
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ publicKey: user.publicKey });
});

// ===== SOCKET CHAT =====
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // Gửi lịch sử tin nhắn cho client
  socket.emit("message_history", messages);

  // Nhận tin nhắn đã mã hóa
  socket.on("sendMessage", (msg) => {
    // msg = { from, to, ciphertext, iv }
    const msgObj = { ...msg, timestamp: Date.now() };
    messages.push(msgObj);
    fs.writeFileSync(MSG_FILE, JSON.stringify(messages, null, 2));
    io.emit("receiveMessage", msgObj);
  });

  socket.on("disconnect", () => console.log("User disconnected:", socket.id));
});

// ===== AUTO DELETE OLD MESSAGES (2 tháng) =====
setInterval(() => {
  const now = Date.now();
  const twoMonths = 1000 * 60 * 60 * 24 * 60;
  const oneWeek = 1000 * 60 * 60 * 24 * 7;

  messages.forEach(msg => {
    if (!msg.warned && now - msg.timestamp > twoMonths - oneWeek) {
      // TODO: emit warning trước 1 tuần cho client
      io.emit("message_warning", { to: msg.to, from: msg.from });
      msg.warned = true;
    }
  });

  messages = messages.filter(msg => now - msg.timestamp <= twoMonths);
  fs.writeFileSync(MSG_FILE, JSON.stringify(messages, null, 2));
}, 1000 * 60 * 60); // mỗi giờ

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
