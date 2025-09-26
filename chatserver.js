// chatserver.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { MongoClient } = require("mongodb");
const path = require("path");
const bcrypt = require("bcryptjs");
const cron = require("node-cron");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MongoDB URI (env var on Render) or fallback for local testing
const uri = process.env.MONGODB_URI || "mongodb+srv://chat_for_class:chatforclass@cluster0.cfyfeh9.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";

if (!uri) {
  console.error("❌ No MONGODB_URI provided. Set env var MONGODB_URI.");
  process.exit(1);
}

let dbClient;
let usersCol, messagesCol;

async function connectDB() {
  try {
    dbClient = new MongoClient(uri);
    await dbClient.connect();
    console.log("✅ Connected to MongoDB Atlas");
    const db = dbClient.db("chatapp");
    usersCol = db.collection("users");
    messagesCol = db.collection("messages");

    // Create TTL index: expire documents after 60 days (60*24*3600 = 5184000 sec)
    await messagesCol.createIndex({ createdAt: 1 }, { expireAfterSeconds: 5184000 });
    // Ensure warned flag index for quick queries
    await messagesCol.createIndex({ warned: 1 });

    // Ensure username is unique
    await usersCol.createIndex({ username: 1 }, { unique: true });
  } catch (err) {
    console.error("❌ MongoDB connect/index error:", err);
  }
}
connectDB();

// serve index.html (file sits in same folder)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ----------------- Auth APIs -----------------
// Register (stores hashed password)
app.post("/register", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.json({ success: false, error: "Thiếu thông tin" });

    const hashed = await bcrypt.hash(password, 10);
    await usersCol.insertOne({ username, password: hashed });
    return res.json({ success: true, message: "Đăng ký thành công" });
  } catch (err) {
    if (err.code === 11000) return res.json({ success: false, error: "Tên đã tồn tại" });
    console.error(err);
    return res.json({ success: false, error: "Lỗi server" });
  }
});

// Login (verify password)
app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.json({ success: false, error: "Thiếu thông tin" });

    const user = await usersCol.findOne({ username });
    if (!user) return res.json({ success: false, error: "Sai tài khoản" });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.json({ success: false, error: "Sai mật khẩu" });

    return res.json({ success: true, message: "Đăng nhập thành công" });
  } catch (err) {
    console.error(err);
    return res.json({ success: false, error: "Lỗi server" });
  }
});

// -------- Socket.IO: chat + mapping username -> sockets ---------
const userSockets = new Map(); // username -> set of socket ids

io.on("connection", (socket) => {
  console.log("🔗 socket connected", socket.id);

  // client emits join with username (after login) and passphrase (not sent to server)
  socket.on("join", ({ username }) => {
    socket.username = username;
    if (!userSockets.has(username)) userSockets.set(username, new Set());
    userSockets.get(username).add(socket.id);
    console.log("User joined:", username, "socket:", socket.id);
  });

  // request to load history (server only returns ciphertext/iv/sender/time)
  socket.on("load_history", async () => {
    try {
      const docs = await messagesCol.find().sort({ createdAt: 1 }).toArray();
      // send raw stored docs (ciphertext, iv, user, createdAt, warned)
      socket.emit("history", docs);
    } catch (err) {
      console.error("load_history error", err);
    }
  });

  // receive encrypted message object from client:
  // { ciphertext: string(base64), iv: string(base64), user: username }
  socket.on("send_encrypted", async (data) => {
    try {
      const doc = {
        ciphertext: data.ciphertext,
        iv: data.iv,
        user: data.user,
        createdAt: new Date(),
        warned: false
      };
      await messagesCol.insertOne(doc);
      // broadcast stored doc
      io.emit("new_message", doc);
    } catch (err) {
      console.error("send_encrypted error", err);
    }
  });

  socket.on("disconnect", () => {
    if (socket.username && userSockets.has(socket.username)) {
      userSockets.get(socket.username).delete(socket.id);
      if (userSockets.get(socket.username).size === 0) userSockets.delete(socket.username);
    }
    console.log("🔴 socket disconnected", socket.id);
  });
});

// ---------------- Cron job: daily warning 7 days before deletion ----------------
// TTL deletes at 60 days, so warning threshold = 60 - 7 = 53 days
// We'll run a cron job daily at 00:00 UTC (server time); adjust as needed.
cron.schedule("0 0 * * *", async () => {
  try {
    const now = new Date();
    const warnBeforeDays = 7;
    const ttlDays = 60;
    const warnThresholdDate = new Date(now.getTime() - (ttlDays - warnBeforeDays) * 24 * 60 * 60 * 1000);
    // find messages older than or equal warnThresholdDate and not yet warned
    const oldMsgsCursor = messagesCol.find({ createdAt: { $lte: warnThresholdDate }, warned: { $ne: true } });
    const oldMsgs = await oldMsgsCursor.toArray();
    if (!oldMsgs.length) {
      console.log("Cron: no messages needing warning today");
      return;
    }
    // collect unique users who have messages to be deleted
    const usersToWarn = [...new Set(oldMsgs.map(m => m.user))];
    console.log(`Cron: warning ${usersToWarn.length} users about ${oldMsgs.length} messages`);
    // send socket warning to connected sockets
    usersToWarn.forEach((username) => {
      const sockets = userSockets.get(username);
      if (sockets && sockets.size > 0) {
        sockets.forEach(sid => {
          io.to(sid).emit("deletion_warning", {
            message: `Một số tin nhắn của bạn sẽ bị xoá trong ${warnBeforeDays} ngày.`
          });
        });
      }
    });
    // mark those messages as warned so we don't warn again
    const ids = oldMsgs.map(m => m._id);
    await messagesCol.updateMany({ _id: { $in: ids } }, { $set: { warned: true } });
  } catch (err) {
    console.error("Cron job error:", err);
  }
});

// ---------------- start server ----------------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
