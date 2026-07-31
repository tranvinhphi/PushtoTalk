/**
 * Walkie Talkie Web App - Server
 * Node.js + Express + Socket.io
 *
 * Không dùng database. Trạng thái phòng được lưu tạm trong RAM (đủ dùng cho
 * quy mô nhỏ/vừa). Nếu server restart, danh sách phòng sẽ mất - đây là đánh
 * đổi hợp lý cho một app "không đăng nhập, không lưu trữ" như yêu cầu.
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    // Production: thay '*' bằng domain Vercel thực tế của bạn, ví dụ:
    // origin: "https://ten-app-cua-ban.vercel.app"
    origin: '*',
    methods: ['GET', 'POST'],
  },
  // Audio blob của mỗi lượt nói có thể khá nặng, tăng giới hạn buffer mặc định
  maxHttpBufferSize: 8 * 1024 * 1024, // 8MB
  pingTimeout: 20000,
  pingInterval: 10000,
});

app.get('/', (req, res) => {
  res.send('Walkie Talkie Server đang chạy. Kết nối qua Socket.io.');
});

// health check cho Render
app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

// rooms[roomCode] = { [socketId]: username }
const rooms = {};

function getRoomUserList(roomCode) {
  if (!rooms[roomCode]) return [];
  return Object.values(rooms[roomCode]);
}

function leaveCurrentRoom(socket) {
  const { roomCode, username } = socket.data;
  if (!roomCode || !rooms[roomCode]) return;

  delete rooms[roomCode][socket.id];
  socket.leave(roomCode);

  if (Object.keys(rooms[roomCode]).length === 0) {
    delete rooms[roomCode];
  } else {
    io.to(roomCode).emit('user-list', getRoomUserList(roomCode));
    io.to(roomCode).emit('system-message', `${username || 'Một người dùng'} đã rời phòng.`);
  }
}

io.on('connection', (socket) => {
  console.log(`[+] Kết nối mới: ${socket.id}`);

  socket.on('join-room', ({ roomCode, username }) => {
    if (!roomCode || !username) {
      socket.emit('join-error', 'Vui lòng nhập đầy đủ Mã phòng và Tên hiển thị.');
      return;
    }

    roomCode = String(roomCode).trim().toUpperCase().substring(0, 20);
    username = String(username).trim().substring(0, 30);

    if (!roomCode || !username) {
      socket.emit('join-error', 'Mã phòng hoặc Tên không hợp lệ.');
      return;
    }

    // Nếu đang ở phòng khác thì rời trước
    leaveCurrentRoom(socket);

    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.username = username;

    if (!rooms[roomCode]) rooms[roomCode] = {};
    rooms[roomCode][socket.id] = username;

    socket.emit('joined', { roomCode, username });
    io.to(roomCode).emit('user-list', getRoomUserList(roomCode));
    socket.to(roomCode).emit('system-message', `${username} đã vào phòng.`);

    console.log(`[Room ${roomCode}] ${username} đã tham gia. Tổng thành viên: ${Object.keys(rooms[roomCode]).length}`);
  });

  socket.on('start-speaking', () => {
    const { roomCode, username } = socket.data;
    if (!roomCode) return;
    socket.to(roomCode).emit('speaking-start', { username });
  });

  socket.on('stop-speaking', () => {
    const { roomCode, username } = socket.data;
    if (!roomCode) return;
    socket.to(roomCode).emit('speaking-stop', { username });
  });

  // audioBuffer: ArrayBuffer chứa toàn bộ đoạn ghi âm, gửi lên NGAY khi nhả nút
  socket.on('audio-data', (audioBuffer) => {
    const { roomCode, username } = socket.data;
    if (!roomCode || !audioBuffer) return;
    socket.to(roomCode).emit('audio-data', { username, audio: audioBuffer });
  });

  socket.on('disconnect', () => {
    leaveCurrentRoom(socket);
    console.log(`[-] Ngắt kết nối: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server đang chạy tại cổng ${PORT}`);
});
