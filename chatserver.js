const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 👉 Route gốc trả về index.html (nằm cùng thư mục với server.js)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ================== SOCKET.IO ==================
io.on("connection", (socket) => {
  console.log("🔗 User connected:", socket.id);

  // Nhận tin nhắn từ client
  socket.on("chat_message", (msg) => {
    io.emit("message", { from: socket.id, message: msg });
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
