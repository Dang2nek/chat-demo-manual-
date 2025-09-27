// ================== CHAT SERVER ==================
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { MongoClient, ServerApiVersion } = require("mongodb");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ================== MONGODB ==================
const uri = process.env.MONGODB_URI || "mongodb+srv://chat_for_class:chatforclass@cluster0.cfyfeh9.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
const client = new MongoClient(uri, {
  serverApi: ServerApiVersion.v1,
  strict: true,
  deprecationErrors: true,
});

let db, usersCol, messagesCol;

async function initDB() {
  await client.connect();
  db = client.db("chatapp");
  usersCol = db.collection("users");
  messagesCol = db.collection("messages");

  console.log("✅ Connected to MongoDB!");
}
initDB().catch(console.error);

// ================== HELPER ==================
function generatePassphrase() {
  return crypto.randomBytes(16).toString("hex");
}

function encryptMessage(message, passphrase) {
  const iv = crypto.randomBytes(12);
  const key = crypto.createHash("sha256").update(passphrase).digest();
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let encrypted = cipher.update(message, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${tag}:${encrypted}`;
}

function decryptMessage(encrypted, passphrase) {
  const [ivHex, tagHex, data] = encrypted.split(":");
  const key = crypto.createHash("sha256").update(passphrase).digest();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  let decrypted = decipher.update(data, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

// ================== ROUTES ==================
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/index.html");
});

// Register
app.post("/register", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, message: "Thiếu thông tin" });

  const existing = await usersCol.findOne({ username });
  if (existing) return res.status(400).json({ success: false, message: "Tên đã tồn tại" });

  const hashed = await bcrypt.hash(password, 10);
  await usersCol.insertOne({ username, password: hashed });
  res.json({ success: true, message: "Đăng ký thành công" });
});

// Login
app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const user = await usersCol.findOne({ username });
  if (!user) return res.status(401).json({ success: false, message: "Sai tài khoản hoặc mật khẩu" });

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(401).json({ success: false, message: "Sai tài khoản hoặc mật khẩu" });

  res.json({ success: true, message: "Đăng nhập thành công" });
});

// ================== SOCKET.IO ==================
io.on("connection", async (socket) => {
  console.log("🔗 User connected:", socket.id);

  // Mỗi socket được cấp passphrase riêng
  const passphrase = generatePassphrase();
  socket.passphrase = passphrase;

  // Lấy lịch sử tin nhắn
  const history = await messagesCol.find({}).sort({ time: 1 }).toArray();
  const decryptedHistory = history.map(msg => ({
    from: msg.from,
    message: decryptMessage(msg.message, msg.passphrase),
    time: msg.time
  }));
  socket.emit("message_history", decryptedHistory);

  socket.on("chat_message", async (data) => {
    const encrypted = encryptMessage(data.message, socket.passphrase);
    const msgObj = { from: data.from, message: encrypted, passphrase: socket.passphrase, time: new Date() };

    await messagesCol.insertOne(msgObj);

    io.emit("message", { from: data.from, message: data.message });
  });

  socket.on("disconnect", () => {
    console.log("❌ User disconnected:", socket.id);
  });
});

// ================== AUTO DELETE OLD MESSAGES ==================
setInterval(async () => {
  const now = new Date();
  const warningDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 1 tuần sau
  const deleteDate = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000); // 2 tháng trước

  const oldMessages = await messagesCol.find({ time: { $lt: deleteDate } }).toArray();
  oldMessages.forEach(msg => {
    io.emit("system_message", `Tin nhắn của ${msg.from} sẽ bị xóa sớm!`);
  });

  await messagesCol.deleteMany({ time: { $lt: deleteDate } });
}, 24 * 60 * 60 * 1000); // chạy mỗi ngày

// ================== START SERVER ==================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
