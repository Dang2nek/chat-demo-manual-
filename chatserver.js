const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { MongoClient, ServerApiVersion } = require("mongodb");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public")); // phục vụ index.html từ /public

// ================== KẾT NỐI MONGODB ATLAS ==================
const uri = process.env.MONGODB_URI; // lấy từ biến môi trường Render
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let usersCollection;
let messagesCollection;

async function connectDB() {
  try {
    await client.connect();
    console.log("✅ Connected to MongoDB Atlas");

    const db = client.db("chatapp"); // tên database
    usersCollection = db.collection("users");
    messagesCollection = db.collection("messages");
  } catch (err) {
    console.error("❌ MongoDB connect error:", err);
  }
}
connectDB();

// ================== SOCKET.IO ==================
io.on("connection", async (socket) => {
  console.log("🔗 User connected:", socket.id);

  // Gửi lịch sử tin nhắn
  const history = await messagesCollection.find().sort({ time: 1 }).toArray();
  socket.emit("chatHistory", history);

  // Đăng ký
  socket.on("register", async (data) => {
    const { username, password } = data;
    if (!username || !password) {
      socket.emit("registerError", "Thiếu thông tin");
      return;
    }
    const exist = await usersCollection.findOne({ username });
    if (exist) {
      socket.emit("registerError", "Tên người dùng đã tồn tại");
      return;
    }
    await usersCollection.insertOne({ username, password });
    socket.emit("registerSuccess", "Đăng ký thành công");
  });

  // Đăng nhập
  socket.on("login", async (data) => {
    const { username, password } = data;
    const user = await usersCollection.findOne({ username, password });
    if (!user) {
      socket.emit("loginError", "Sai tài khoản hoặc mật khẩu");
      return;
    }
    socket.username = username;
    socket.emit("loginSuccess", "Đăng nhập thành công");
  });

  // Nhận tin nhắn chat
  socket.on("chatMessage", async (msg) => {
    if (!socket.username) {
      socket.emit("chatError", "Bạn chưa đăng nhập");
      return;
    }
    const messageObj = {
      from: socket.username,
      text: msg,
      time: new Date(),
    };
    await messagesCollection.insertOne(messageObj);
    io.emit("chatMessage", messageObj);
  });

  socket.on("disconnect", () => {
    console.log("❌ User disconnected:", socket.id);
  });
});

// ================== CHẠY SERVER ==================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
