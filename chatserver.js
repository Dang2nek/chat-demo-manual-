const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { MongoClient } = require("mongodb");
const path = require("path");
const bcrypt = require("bcrypt");
const bodyParser = require("body-parser");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(bodyParser.json());
app.use(express.static(__dirname));

const uri =
  process.env.MONGODB_URI ||
  "mongodb+srv://chat_for_class:chatforclass@cluster0.cfyfeh9.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";

let usersCollection, messagesCollection;

async function connectDB() {
  try {
    const client = new MongoClient(uri);
    await client.connect();
    console.log("✅ Connected to MongoDB");
    const db = client.db("chatapp");
    usersCollection = db.collection("users");
    messagesCollection = db.collection("messages");
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err);
  }
}
connectDB();

// serve index.html
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// API đăng ký
app.post("/register", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Thiếu dữ liệu" });

  const existingUser = await usersCollection.findOne({ username });
  if (existingUser) return res.status(400).json({ error: "Tên đã tồn tại" });

  const hashed = await bcrypt.hash(password, 10);
  await usersCollection.insertOne({ username, password: hashed });
  res.json({ success: true });
});

// API đăng nhập
app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const user = await usersCollection.findOne({ username });
  if (!user) return res.status(400).json({ error: "Sai tài khoản" });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(400).json({ error: "Sai mật khẩu" });

  res.json({ success: true });
});

// socket.io chat
io.on("connection", (socket) => {
  console.log("🔵 A user connected");

  socket.on("set username", (username) => {
    socket.username = username;

    // load tin nhắn cũ
    if (messagesCollection) {
      messagesCollection
        .find()
        .sort({ _id: -1 })
        .limit(20)
        .toArray()
        .then((msgs) => {
          socket.emit("load messages", msgs.reverse());
        });
    }
  });

  socket.on("chat message", async (msg) => {
    if (!socket.username) return;
    const messageDoc = { user: socket.username, text: msg, createdAt: new Date() };
    if (messagesCollection) await messagesCollection.insertOne(messageDoc);
    io.emit("chat message", messageDoc);
  });

  socket.on("disconnect", () => {
    console.log("🔴 A user disconnected");
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
