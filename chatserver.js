<script src="/socket.io/socket.io.js"></script>
<script>
  const socket = io();

  // Đăng ký
  function register(username, password) {
    socket.emit("register", { username, password });
  }

  socket.on("registerSuccess", (msg) => alert(msg));
  socket.on("registerError", (err) => alert(err));

  // Đăng nhập
  function login(username, password) {
    socket.emit("login", { username, password });
  }

  socket.on("loginSuccess", (msg) => {
    alert(msg);
  });
  socket.on("loginError", (err) => alert(err));

  // Nhận lịch sử tin nhắn
  socket.on("chatHistory", (messages) => {
    messages.forEach((m) => addMessage(m));
  });

  // Gửi chat
  function sendMessage(text) {
    socket.emit("chatMessage", text);
  }

  // Nhận chat mới
  socket.on("chatMessage", (message) => {
    addMessage(message);
  });

  function addMessage(message) {
    const chatBox = document.getElementById("chat");
    const div = document.createElement("div");
    div.textContent = `${message.from}: ${message.text}`;
    chatBox.appendChild(div);
  }
</script>
