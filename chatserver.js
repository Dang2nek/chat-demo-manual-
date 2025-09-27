<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Chat E2E</title>
<style>
body { font-family: Arial; padding: 20px; }
#chat { display:none; border:1px solid #ccc; padding:10px; max-height:300px; overflow-y:auto; }
</style>
</head>
<body>

<h2>Đăng ký / Đăng nhập</h2>
<div id="auth">
    <input id="username" placeholder="Username">
    <input id="password" type="password" placeholder="Password">
    <button id="btnRegister">Register</button>
    <button id="btnLogin">Login</button>
    <p id="authMsg"></p>
</div>

<div id="chat">
    <p>Socket ID: <span id="socketId"></span></p>
    <input id="passphrase" placeholder="Passphrase for E2E">
    <input id="toUser" placeholder="Send to username">
    <input id="msg" placeholder="Message">
    <button id="sendBtn">Send</button>
    <div id="messages"></div>
</div>

<script src="/socket.io/socket.io.js"></script>
<script>
const socket = io();

let username = '';
socket.on('socket_id', id => document.getElementById('socketId').innerText = id);

document.getElementById('btnRegister').onclick = async () => {
    username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const res = await fetch('/register', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({username,password})
    }).then(r=>r.json());
    document.getElementById('authMsg').innerText = res.success ? 'Registered!' : res.error;
};

document.getElementById('btnLogin').onclick = async () => {
    username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const res = await fetch('/login', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({username,password})
    }).then(r=>r.json());
    if(res.success){
        document.getElementById('auth').style.display='none';
        document.getElementById('chat').style.display='block';
    } else {
        document.getElementById('authMsg').innerText = res.error;
    }
};

// send message
document.getElementById('sendBtn').onclick = () => {
    const msg = document.getElementById('msg').value;
    const passphrase = document.getElementById('passphrase').value;
    const toUser = document.getElementById('toUser').value;
    socket.emit('send_message',{from:username,to:toUser,message:msg,passphrase});
};

// receive message
socket.on('receive_message', data => {
    const key = cryptoJS.SHA256(document.getElementById('passphrase').value);
    const parts = data.encrypted.split(':');
    const iv = CryptoJS.enc.Hex.parse(parts[0]);
    const encrypted = parts[1];
    const decrypted = CryptoJS.AES.decrypt(encrypted, key, { iv: iv }).toString(CryptoJS.enc.Utf8);
    const msgDiv = document.createElement('div');
    msgDiv.innerText = `${data.from} -> ${data.to}: ${decrypted}`;
    document.getElementById('messages').appendChild(msgDiv);
});
</script>

<script src="https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.1.1/crypto-js.min.js"></script>
</body>
</html>
