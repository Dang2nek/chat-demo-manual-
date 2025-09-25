const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// File JSON để lưu dữ liệu
const USERS_FILE = path.join(__dirname, "users.json");
const MSG_FILE = path.join(__dirname, "messages.json");

// Đọc JSON an toàn
function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return [];
  }
}

// Ghi JSON
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Route gốc trả về index.html
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// API đăng ký
app.post("/register", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ success: false, message: "Thiếu thông tin" });

  let users = readJSON(USERS_FILE);
  if (users.find(u => u.username === username)) {
    return res.status(400).json({ success: false, message: "Tên đã tồn tại" });
  }

  users.push({ username, password });
  writeJSON(USERS_FILE, users);
  res.json({ success: true, message: "Đăng ký thành công" });
});

// API đăng nhập
app.post("/login", (req, res) => {
  const { username, password } = req.body;
  let users = readJSON(USERS_FILE);

  const user = users.find(u => u.username === username && u.password === password);
  if (!user) {
    return res.status(401).json({ success: false, message: "Sai tài khoản hoặc mật khẩu" });
  }

  res.json({ success: true, message: "Đăng nhập thành công" });
});

// ================== SOCKET.IO ==================
io.on("connection", (socket) => {
  console.log("🔗 User connected:", socket.id);

  // Gửi lại lịch sử tin nhắn cho user mới
  let history = readJSON(MSG_FILE);
  socket.emit("message_history", history);

  // Nhận tin nhắn
  socket.on("chat_message", (data) => {
    let history = readJSON(MSG_FILE);

    const msgObj = {
      from: data.from,
      message: data.message,
      time: new Date().toISOString()
    };

    history.push(msgObj);
    writeJSON(MSG_FILE, history);

    io.emit("message", msgObj);
  });

  socket.on("disconnect", () => {
    console.log("❌ User disconnected:", socket.id);
  });
});

// ================== CHẠY SERVER ==================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
