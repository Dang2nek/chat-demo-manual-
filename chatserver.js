const socket = io();
let currentUser = null;
let privateKey = null;
let publicKey = null;

// Hiển thị login/register
document.getElementById("showRegister").onclick = () => {
  document.getElementById("loginBox").style.display = "none";
  document.getElementById("registerBox").style.display = "block";
};
document.getElementById("showLogin").onclick = () => {
  document.getElementById("registerBox").style.display = "none";
  document.getElementById("loginBox").style.display = "block";
};

// Tạo keypair E2E
async function generateKeyPair() {
  const keyPair = await window.crypto.subtle.generateKey(
    { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: "SHA-256" },
    true,
    ["encrypt", "decrypt"]
  );
  privateKey = keyPair.privateKey;
  publicKey = await window.crypto.subtle.exportKey("spki", keyPair.publicKey);
  return btoa(String.fromCharCode(...new Uint8Array(publicKey)));
}

// Đăng ký
document.getElementById("btnRegister").onclick = async () => {
  const username = document.getElementById("regUser").value.trim();
  const password = document.getElementById("regPass").value.trim();
  const pubKey = await generateKeyPair();

  const res = await fetch("/register", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ username, password, publicKey: pubKey })
  });
  const data = await res.json();
  document.getElementById("regMsg").innerText = data.success ? "Đăng ký thành công!" : data.error;
  if(data.success) document.getElementById("showLogin").click();
};

// Đăng nhập
document.getElementById("btnLogin").onclick = async () => {
  const username = document.getElementById("loginUser").value.trim();
  const password = document.getElementById("loginPass").value.trim();

  const res = await fetch("/login", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ username, password })
  });
  const data = await res.json();
  document.getElementById("loginMsg").innerText = data.success ? "Đăng nhập thành công!" : data.error;
  if(data.success){
    currentUser = username;
    document.getElementById("loginBox").style.display = "none";
    document.getElementById("chatBox").style.display = "block";
  }
};

// Gửi tin nhắn
document.getElementById("sendBtn").onclick = async () => {
  const msgInput = document.getElementById("msgInput");
  let message = msgInput.value.trim();
  if(!message) return;

  // Mã hóa tin nhắn (E2E)
  const enc = new TextEncoder();
  const encrypted = await window.crypto.subtle.encrypt(
    {name:"RSA-OAEP", key: await window.crypto.subtle.importKey("spki", publicKey, {name:"RSA-OAEP", hash:"SHA-256"}, true, ["encrypt"])},
    publicKey,
    enc.encode(message)
  );
  const ciphertext = btoa(String.fromCharCode(...new Uint8Array(encrypted)));

  socket.emit("sendMessage", { from: currentUser, to: "all", ciphertext });
  msgInput.value = "";
};

// Nhận tin nhắn
socket.on("receiveMessage", msg => {
  const msgDiv = document.getElementById("messages");
  const div = document.createElement("div");
  div.innerText = `${msg.from}: ${msg.ciphertext}`;
  msgDiv.appendChild(div);
  msgDiv.scrollTop = msgDiv.scrollHeight;
});

// Lịch sử tin nhắn
socket.on("message_history", history => {
  const msgDiv = document.getElementById("messages");
  history.forEach(msg => {
    const div = document.createElement("div");
    div.innerText = `${msg.from}: ${msg.ciphertext}`;
    msgDiv.appendChild(div);
  });
});
