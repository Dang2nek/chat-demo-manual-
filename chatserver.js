const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { MongoClient, ServerApiVersion } = require("mongodb");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// MongoDB URI từ biến môi trường
const uri = process.env.MONGODB_URI;

if (!uri) {
  console.error("❌ MONGODB_URI is not defined in environment variables!");
  process.exit(1);
}

// Kết nối MongoDB
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

// Trả về file index.html khi truy cập "/"
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Socket.IO chat
io.on("connection", (socket) => {
  console.log("🔗 User connected:", socket.id);

  socket.on("chatMessage", async (msg) => {
    console.log(`💬 ${socket.id}: ${msg}`);

    try {
      const db = client.db("chatapp");
      const messages = db.collection("messages");
      await messages.insertOne({
        text: msg,
        sender: socket.id,
        timestamp: new Date(),
      });
    } catch (err) {
      console.error("❌ Failed to save message:", err);
    }

    io.emit("chatMessage", { from: socket.id, text: msg });
  });

  socket.on("disconnect", () => {
    console.log("❌ User disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
