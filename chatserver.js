require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const { MongoClient } = require('mongodb');
const CryptoJS = require('crypto-js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const uri = process.env.MONGODB_URI; // MongoDB Atlas
const client = new MongoClient(uri);

let db, usersCol, messagesCol;

async function initDb(){
    await client.connect();
    db = client.db('chatapp');
    usersCol = db.collection('users');
    messagesCol = db.collection('messages');
}
initDb().catch(console.error);

app.get('/', (req,res)=>{
    res.sendFile(__dirname + '/index.html');
});

// Register endpoint
app.post('/register', async (req,res)=>{
    const { username, password } = req.body;
    if(!username || !password) return res.status(400).send("Missing fields");
    const exists = await usersCol.findOne({ username });
    if(exists) return res.status(400).send("Username exists");
    const hash = await bcrypt.hash(password, 10);
    await usersCol.insertOne({ username, password: hash });
    res.send("Registered");
});

// Login endpoint
app.post('/login', async (req,res)=>{
    const { username, password } = req.body;
    if(!username || !password) return res.status(400).send("Missing fields");
    const user = await usersCol.findOne({ username });
    if(!user) return res.status(400).send("User not found");
    const valid = await bcrypt.compare(password, user.password);
    if(!valid) return res.status(400).send("Invalid password");
    res.send("Logged in");
});

io.on('connection', (socket)=>{
    console.log('User connected:', socket.id);

    // Send socket ID to client
    socket.emit('socketId', socket.id);

    socket.on('chatMessage', async ({from,msg,passphrase})=>{
        if(!msg) return;
        try {
            const encrypted = CryptoJS.AES.encrypt(msg, passphrase).toString();
            const messageDoc = { from, msg: encrypted, passphrase, createdAt: new Date() };
            await messagesCol.insertOne(messageDoc);
            io.emit('chatMessage', { from, msg: encrypted });
        } catch(err){
            console.error(err);
        }
    });

    // Load previous messages
    socket.on('loadMessages', async ({passphrase})=>{
        const msgs = await messagesCol.find({}).sort({createdAt:1}).toArray();
        msgs.forEach(m=>{
            let decrypted = "[Cannot decrypt]";
            try{
                if(m.msg && passphrase){
                    decrypted = CryptoJS.AES.decrypt(m.msg, passphrase).toString(CryptoJS.enc.Utf8);
                }
            }catch{}
            socket.emit('chatMessage',{from:m.from, msg:decrypted});
        });
    });

    socket.on('disconnect', ()=>{
        console.log('User disconnected:', socket.id);
    });
});

// Auto-delete old messages every day
setInterval(async ()=>{
    const twoMonthsAgo = new Date(Date.now() - 1000*60*60*24*60);
    const oneWeekAgo = new Date(Date.now() - 1000*60*60*24*53); // 7 days before 2 months
    const oldMsgs = await messagesCol.find({createdAt: {$lt: twoMonthsAgo}}).toArray();
    oldMsgs.forEach(m=>{
        io.emit('deleteNotice', {from:m.from, msg:m.msg});
    });
    await messagesCol.deleteMany({createdAt: {$lt: twoMonthsAgo}});
}, 1000*60*60*24); // every 24h

server.listen(process.env.PORT || 3000, ()=>{
    console.log('Server running on port', process.env.PORT || 3000);
});
