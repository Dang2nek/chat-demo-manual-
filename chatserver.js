const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { MongoClient, ServerApiVersion } = require("mongodb");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MongoDB URI (lấy từ Render env var)
const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("❌ MONGODB_URI not found in env variables");
  process.exit(1);
}

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function connectDB() {
  try {
    await client.connect();
    console.log("✅ Connected to MongoDB Atlas");
  } catch (err) {
    console.error("❌ MongoDB connect error:", err);
  }
}
connectDB();

const db = () => client.db("chatapp");
const usersCol = () => db().collection("users");
const messagesCol = () => db().collection("messages");

// Serve index.html
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// API Register
app.post("/register", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.json({ success: false, message: "Thiếu thông tin" });

  const existing = await usersCol().findOne({ username });
  if (existing) {
    return res.json({ success: false, message: "Tên đã tồn tại" });
  }

  await usersCol().insertOne({ username, password });
  res.json({ success: true, message: "Đăng ký thành công" });
});

// API Login
app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const user = await usersCol().findOne({ username, password });

  if (!user) {
    return res.json({ success: false, message: "Sai tài khoản hoặc mật khẩu" });
  }

  res.json({ success: true, message: "Đăng nhập thành công" });
});

// ================= SOCKET.IO =================
io.on("connection", async (socket) => {
  console.log("🔗 User connected:", socket.id);

  // Gửi lịch sử tin nhắn khi user kết nối
  const history = await messagesCol().find().sort({ timestamp: 1 }).toArray();
  socket.emit("message_history", history);

  // Nhận tin nhắn mới
  socket.on("chat_message", async (data) => {
    const msgObj = {
      from: data.from,
      message: data.message,
      timestamp: new Date(),
    };

    await messagesCol().insertOne(msgObj);
    io.emit("message", msgObj);
  });

  socket.on("disconnect", () => {
    console.log("❌ User disconnected:", socket.id);
  });
});

// ================= SERVER =================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
