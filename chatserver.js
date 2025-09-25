const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ====== HÀM ĐỌC / GHI JSON ======
function loadJSON(filename) {
  try {
    const data = fs.readFileSync(filename, "utf8");
    return data ? JSON.parse(data) : [];
  } catch (err) {
    return [];
  }
}

let users = loadJSON("users.json");
let messages = loadJSON("messages.json");

function saveUsers() {
  fs.writeFileSync("users.json", JSON.stringify(users, null, 2));
}

function saveMessages() {
  fs.writeFileSync("messages.json", JSON.stringify(messages, null, 2));
}

// ====== SOCKET.IO ======
io.on("connection", (socket) => {
  console.log("📌 Client kết nối:", socket.id);

  // Đăng ký
  socket.on("register", ({ username, password }) => {
    if (users.find(u => u.username === username)) {
      socket.emit("register_response", { success: false, message: "Tên đã tồn tại" });
    } else {
      users.push({ username, password });
      saveUsers();
      socket.emit("register_response", { success: true, message: "Đăng ký thành công, hãy đăng nhập" });
    }
  });

  // Đăng nhập
  socket.on("login", ({ username, password }) => {
    const user = users.find(u => u.username === username && u.password === password);
    if (user) {
      socket.username = username;
      socket.emit("login_response", { success: true, message: "Đăng nhập thành công", username });

      // Gửi danh sách user online
      const onlineUsers = Array.from(io.sockets.sockets.values()).map(s => s.username).filter(Boolean);
      io.emit("online_users", onlineUsers);

      // Gửi tin nhắn cũ (lọc theo user)
      const userMsgs = messages.filter(m => m.from === username || m.to === username);
      socket.emit("load_messages", userMsgs);
    } else {
      socket.emit("login_response", { success: false, message: "Sai tài khoản hoặc mật khẩu" });
    }
  });

  // Nhận tin nhắn
  socket.on("chatMessage", ({ to, message }) => {
    if (!socket.username) return; // chưa login
    const msg = { from: socket.username, to, message, timestamp: Date.now() };
    messages.push(msg);
    saveMessages();

    // Gửi cho người nhận
    for (let [id, s] of io.sockets.sockets) {
      if (s.username === to) {
        s.emit("chatMessage", msg);
      }
    }

    // Gửi lại cho chính mình để hiển thị
    socket.emit("chatMessage", msg);
  });

  // Ngắt kết nối
  socket.on("disconnect", () => {
    console.log("❌", socket.username, "ngắt kết nối");
    const onlineUsers = Array.from(io.sockets.sockets.values()).map(s => s.username).filter(Boolean);
    io.emit("online_users", onlineUsers);
  });
});

server.listen(3000, () => {
  console.log("🚀 Server chạy tại http://localhost:3000");
});
