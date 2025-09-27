const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { MongoClient, ObjectId } = require("mongodb");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname)); // để serve client.js và index.html

// --- MongoDB ---
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);
let usersCollection, messagesCollection;

async function initDB() {
  await client.connect();
  const db = client.db("chatapp");
  usersCollection = db.collection("users");
  messagesCollection = db.collection("messages");
}
initDB().catch(console.error);

// --- AES-256-CBC E2E ---
function encrypt(text, keyHex) {
  const key = Buffer.from(keyHex, "hex");
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

function decrypt(enc, keyHex) {
  const [ivHex, encrypted] = enc.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const key = Buffer.from(keyHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

function generatePassphrase() {
  return crypto.randomBytes(32).toString("hex");
}

// --- Routes ---
app.post("/register", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).send("Missing fields");
  const exists = await usersCollection.findOne({ username });
  if (exists) return res.status(400).send("User exists");

  const hashed = await bcrypt.hash(password, 10);
  const passphrase = generatePassphrase();
  await usersCollection.insertOne({ username, password: hashed, passphrase });
  res.send("Registered");
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const user = await usersCollection.findOne({ username });
  if (!user) return res.status(400).send("Invalid user");
  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(400).send("Invalid password");
  res.json({ username, passphrase: user.passphrase });
});

// --- Socket.IO ---
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("join", ({ username, passphrase }) => {
    socket.data.username = username;
    socket.data.passphrase = passphrase;
    messagesCollection
      .find()
      .sort({ createdAt: 1 })
      .limit(100)
      .toArray()
      .then((msgs) => {
        const decrypted = msgs.map((m) => ({
          username: m.username,
          text: decrypt(m.text, passphrase),
          createdAt: m.createdAt,
        }));
        socket.emit("chat history", decrypted);
      });
  });

  socket.on("chat message", async (msg) => {
    const { username, passphrase } = socket.data;
    if (!username || !passphrase) return;
    const encrypted = encrypt(msg, passphrase);
    await messagesCollection.insertOne({
      username,
      text: encrypted,
      createdAt: new Date(),
    });
    io.emit("chat message", { username, text: msg, createdAt: new Date() });
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

// --- Auto delete messages older than 2 months ---
setInterval(async () => {
  const now = new Date();
  const deleteDate = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  await messagesCollection.deleteMany({ createdAt: { $lt: deleteDate } });
}, 24 * 60 * 60 * 1000);

server.listen(process.env.PORT || 3000, () => console.log("Server running on port 3000"));
