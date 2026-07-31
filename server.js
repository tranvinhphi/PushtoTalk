/**
 * Walkie Talkie Web App - Server
 * Node.js + Express + Socket.io
 * v2.0.0
 *
 * Không dùng database. Trạng thái phòng lưu tạm trong RAM.
 * Mỗi thành viên trong phòng được lưu dạng object:
 *   { username, lat, lng }
 * để phục vụ tính năng bản đồ vị trí thành viên.
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
  maxHttpBufferSize: 8 * 1024 * 1024, // 8MB cho audio blob
  pingTimeout: 20000,
  pingInterval: 10000,
});

app.get('/', (req, res) => {
  res.send('Walkie Talkie Server v2.0.0 đang chạy. Kết nối qua Socket.io.');
});

app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

// rooms[roomCode][socketId] = { username, lat, lng }
const rooms = {};

function getRoomUserList(roomCode) {
  if (!rooms[roomCode]) return [];
  return Object.entries(rooms[roomCode]).map(([id, data]) => ({
    id,
    username: data.username,
    lat: data.lat,
    lng: data.lng,
  }));
}

function broadcastUserList(roomCode) {
  io.to(roomCode).emit('user-list', getRoomUserList(roomCode));
}

function leaveCurrentRoom(socket) {
  const { roomCode, username } = socket.data;
  if (!roomCode || !rooms[roomCode]) return;

  delete rooms[roomCode][socket.id];
  socket.leave(roomCode);

  if (Object.keys(rooms[roomCode]).length === 0) {
    delete rooms[roomCode];
  } else {
    broadcastUserList(roomCode);
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

    leaveCurrentRoom(socket);

    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.username = username;

    if (!rooms[roomCode]) rooms[roomCode] = {};
    rooms[roomCode][socket.id] = { username, lat: null, lng: null };

    socket.emit('joined', { roomCode, username });
    broadcastUserList(roomCode);
    socket.to(roomCode).emit('system-message', `${username} đã vào phòng.`);

    console.log(`[Room ${roomCode}] ${username} đã tham gia. Tổng thành viên: ${Object.keys(rooms[roomCode]).length}`);
  });

  // Cập nhật vị trí GPS của thành viên (tuỳ chọn, chỉ gửi nếu người dùng cho phép)
  socket.on('update-location', ({ lat, lng }) => {
    const { roomCode } = socket.data;
    if (!roomCode || !rooms[roomCode] || !rooms[roomCode][socket.id]) return;
    if (typeof lat !== 'number' || typeof lng !== 'number') return;

    rooms[roomCode][socket.id].lat = lat;
    rooms[roomCode][socket.id].lng = lng;
    broadcastUserList(roomCode);
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
  console.log(`Server v2.0.0 đang chạy tại cổng ${PORT}`);
});
