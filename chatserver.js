require('dotenv').config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const bcrypt = require("bcryptjs");
const { MongoClient, ObjectId } = require("mongodb");
const CryptoJS = require("crypto-js");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;

if(!MONGODB_URI){
  console.error("❌ MONGODB_URI is not defined in environment variables!");
  process.exit(1);
}

const client = new MongoClient(MONGODB_URI);
let usersCollection, messagesCollection;

async function initDB() {
  await client.connect();
  const db = client.db("chatapp");
  usersCollection = db.collection("users");
  messagesCollection = db.collection("messages");
  console.log("✅ Connected to MongoDB");
}
initDB();

// Xóa tin nhắn > 2 tháng, báo trước 1 tuần
setInterval(async () => {
  const now = new Date();
  const deleteBefore = new Date(now.getTime() - 60*24*60*60*1000); // 60 ngày
  const warnBefore = new Date(now.getTime() - 53*24*60*60*1000); // 53 ngày

  const warnMsgs = await messagesCollection.find({createdAt: {$lt: warnBefore, $gte: deleteBefore}}).toArray();
  warnMsgs.forEach(m => io.to(m.socketId).emit("warnDelete", {msgId: m._id}));

  const oldMsgs = await messagesCollection.deleteMany({createdAt: {$lt: deleteBefore}});
  if(oldMsgs.deletedCount>0) console.log(`🗑 Deleted ${oldMsgs.deletedCount} old messages`);
}, 24*60*60*1000);

io.on("connection", socket => {
  console.log(`User connected: ${socket.id}`);
  
  socket.on("register", async ({username, password}, cb) => {
    const exist = await usersCollection.findOne({username});
    if(exist) return cb({ok:false, msg:"Username taken"});
    const hashed = bcrypt.hashSync(password, 10);
    await usersCollection.insertOne({username, password:hashed});
    cb({ok:true});
  });

  socket.on("login", async ({username, password}, cb) => {
    const user = await usersCollection.findOne({username});
    if(!user) return cb({ok:false, msg:"User not found"});
    if(!bcrypt.compareSync(password, user.password)) return cb({ok:false, msg:"Wrong password"});
    cb({ok:true, socketId: socket.id});
  });

  socket.on("chatMessage", async ({from, msg, passphrase}) => {
    const encrypted = CryptoJS.AES.encrypt(msg, passphrase).toString();
    const messageDoc = {
      from,
      msg: encrypted,
      createdAt: new Date(),
      socketId: socket.id
    };
    await messagesCollection.insertOne(messageDoc);
    io.emit("chatMessage", {from, msg: encrypted});
  });

  socket.on("disconnect", () => console.log(`User disconnected: ${socket.id}`));
});

server.listen(PORT, ()=>console.log(`Server running on port ${PORT}`));
