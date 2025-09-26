const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { MongoClient } = require("mongodb");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const uri =
  process.env.MONGODB_URI ||
  "mongodb+srv://chat_for_class:chatforclass@cluster0.cfyfeh9.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";

let messagesCollection;

async function connectDB() {
  try {
    const client = new MongoClient(uri);
    await client.connect();
    console.log("✅ Connected to MongoDB");
    const db = client.db("chatapp");
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

// socket.io
io.on("connection", (socket) => {
  console.log("🔵 A user connected");

  socket.on("set username", (username) => {
    socket.username = username || "Ẩn danh";

    // gửi tin nhắn cũ
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
    if (!socket.username) return; // chưa login thì bỏ qua
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
