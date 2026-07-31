/**
 * Walkie Talkie Web App - Server
 * Node.js + Express + Socket.io
 * v3.0.0
 *
 * MỚI trong v3.0.0:
 * - Cơ chế "giành mic" (mic lock) theo từng phòng: ai bấm nói TRƯỚC (tới server
 *   trước - phụ thuộc độ trễ mạng của từng người) sẽ giữ được mic; người bấm
 *   sau trong lúc mic đang bận sẽ bị từ chối kèm thông tin ai đang giữ mic.
 * - audio-data giờ được gửi liên tục theo từng đoạn nhỏ (chunk) ngay khi đang
 *   nói, thay vì đợi đến lúc nhả nút mới gửi trọn đoạn ghi âm -> gần real-time.
 * - Sự kiện "reaction" để gửi emoji cảm xúc nổi lên màn hình mọi người.
 * - Tự động nhả mic nếu giữ quá lâu (an toàn, tránh bị kẹt mic do lỗi mạng).
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const webpush = require('web-push');

const app = express();
app.use(express.json());
const server = http.createServer(app);

// ============ WEB PUSH (VAPID) ============
// Đã tạo sẵn 1 cặp khoá để chạy được ngay. Nếu deploy production lâu dài,
// nên tự tạo cặp khoá riêng bằng lệnh: npx web-push generate-vapid-keys
// rồi thay 2 giá trị bên dưới (và cập nhật VAPID_PUBLIC_KEY trong index.html).
const VAPID_PUBLIC_KEY = 'BDTnYKWEcRAZbGHBaCekCGkDMzlnR5RZnhZKlRvrkTykxkSheHnc0xIkpYhE8_aiApr5IbhXTIRBJTkj4nUSzpc';
const VAPID_PRIVATE_KEY = 'f11gX6No3oeQWTsdwcI_31EQoG8HBCToU9oWV91rn0I';
webpush.setVapidDetails('mailto:admin@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

// pushSubs[roomCode] = Map(socketId -> subscriptionObject)
const pushSubs = {};

function sendPushToRoom(roomCode, { title, body, tag }, excludeSocketId) {
  const subsMap = pushSubs[roomCode];
  if (!subsMap) return;
  const payload = JSON.stringify({ title, body, tag, roomCode });
  subsMap.forEach((sub, socketId) => {
    if (socketId === excludeSocketId) return;
    webpush.sendNotification(sub, payload).catch((err) => {
      // Subscription hết hạn / không còn hợp lệ -> dọn dẹp
      if (err.statusCode === 404 || err.statusCode === 410) {
        subsMap.delete(socketId);
      } else {
        console.log('Lỗi gửi push:', err.message);
      }
    });
  });
}

const io = new Server(server, {
  cors: {
    // Production: thay '*' bằng domain Vercel thực tế của bạn
    origin: '*',
    methods: ['GET', 'POST'],
  },
  maxHttpBufferSize: 8 * 1024 * 1024,
  pingTimeout: 20000,
  pingInterval: 10000,
});

app.get('/', (req, res) => {
  res.send('Walkie Talkie Server v3.0.0 đang chạy. Kết nối qua Socket.io.');
});
app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));
app.get('/vapid-public-key', (req, res) => res.status(200).json({ key: VAPID_PUBLIC_KEY }));

// rooms[roomCode][socketId] = { username, lat, lng }
const rooms = {};
// micHolders[roomCode] = { socketId, username, sinceTs } | null
const micHolders = {};
// timer tự nhả mic nếu giữ quá lâu (phòng lỗi client không gửi stop-speaking)
const micTimeouts = {};
const MAX_HOLD_MS = 90 * 1000; // an toàn: tối đa giữ mic liên tục 90 giây

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

function clearMicTimeout(roomCode) {
  if (micTimeouts[roomCode]) {
    clearTimeout(micTimeouts[roomCode]);
    delete micTimeouts[roomCode];
  }
}

function releaseMic(roomCode, reason) {
  const holder = micHolders[roomCode];
  if (!holder) return;
  micHolders[roomCode] = null;
  clearMicTimeout(roomCode);
  io.to(roomCode).emit('speaking-stop', { username: holder.username, reason: reason || 'released' });
}

function grantMic(roomCode, socket, username) {
  micHolders[roomCode] = { socketId: socket.id, username, sinceTs: Date.now() };
  clearMicTimeout(roomCode);
  micTimeouts[roomCode] = setTimeout(() => {
    releaseMic(roomCode, 'timeout');
  }, MAX_HOLD_MS);

  socket.emit('mic-granted', { username });
  io.to(roomCode).emit('speaking-start', { username });

  sendPushToRoom(
    roomCode,
    { title: `🎙️ ${username} đang nói`, body: `Phòng ${roomCode} - bấm để mở Bộ Đàm`, tag: 'botdam-speaking' },
    socket.id
  );
}

function leaveCurrentRoom(socket) {
  const { roomCode, username } = socket.data;
  if (!roomCode || !rooms[roomCode]) return;

  const holder = micHolders[roomCode];
  if (holder && holder.socketId === socket.id) {
    releaseMic(roomCode, 'left');
  }

  delete rooms[roomCode][socket.id];
  socket.leave(roomCode);
  if (pushSubs[roomCode]) pushSubs[roomCode].delete(socket.id);

  if (Object.keys(rooms[roomCode]).length === 0) {
    delete rooms[roomCode];
    delete micHolders[roomCode];
    delete pushSubs[roomCode];
    clearMicTimeout(roomCode);
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
    if (!(roomCode in micHolders)) micHolders[roomCode] = null;

    socket.emit('joined', { roomCode, username });
    broadcastUserList(roomCode);
    socket.to(roomCode).emit('system-message', `${username} đã vào phòng.`);

    // Báo cho người mới vào biết ai đang giữ mic (nếu có)
    const holder = micHolders[roomCode];
    if (holder) socket.emit('speaking-start', { username: holder.username });

    console.log(`[Room ${roomCode}] ${username} đã tham gia. Tổng: ${Object.keys(rooms[roomCode]).length}`);
  });

  // Client gửi PushSubscription lên sau khi bật thông báo thành công
  socket.on('save-subscription', (subscription) => {
    const { roomCode } = socket.data;
    if (!roomCode || !subscription || !subscription.endpoint) return;
    if (!pushSubs[roomCode]) pushSubs[roomCode] = new Map();
    pushSubs[roomCode].set(socket.id, subscription);
  });

  socket.on('update-location', ({ lat, lng }) => {
    const { roomCode } = socket.data;
    if (!roomCode || !rooms[roomCode] || !rooms[roomCode][socket.id]) return;
    if (typeof lat !== 'number' || typeof lng !== 'number') return;
    rooms[roomCode][socket.id].lat = lat;
    rooms[roomCode][socket.id].lng = lng;
    broadcastUserList(roomCode);
  });

  // ============ GIÀNH MIC ============
  socket.on('start-speaking', () => {
    const { roomCode, username } = socket.data;
    if (!roomCode) return;

    const holder = micHolders[roomCode];
    if (!holder) {
      grantMic(roomCode, socket, username);
    } else if (holder.socketId === socket.id) {
      // đã giữ sẵn rồi, bỏ qua
    } else {
      // Bị chậm chân - báo lại riêng cho người bấm sau
      socket.emit('mic-denied', { holder: holder.username });
    }
  });

  socket.on('stop-speaking', () => {
    const { roomCode, username } = socket.data;
    if (!roomCode) return;
    const holder = micHolders[roomCode];
    if (holder && holder.socketId === socket.id) {
      releaseMic(roomCode, 'released');
    }
  });

  // Chunk âm thanh gửi liên tục trong lúc đang nói (gần real-time)
  socket.on('audio-data', (audioBuffer) => {
    const { roomCode, username } = socket.data;
    if (!roomCode || !audioBuffer) return;
    const holder = micHolders[roomCode];
    if (!holder || holder.socketId !== socket.id) return; // chỉ người đang giữ mic mới được phát
    socket.to(roomCode).emit('audio-data', { username, audio: audioBuffer });
  });

  // Emoji cảm xúc nổi lên màn hình cả phòng
  socket.on('reaction', ({ emoji }) => {
    const { roomCode, username } = socket.data;
    if (!roomCode || !emoji) return;
    io.to(roomCode).emit('reaction', { username, emoji: String(emoji).substring(0, 8) });
  });

  socket.on('disconnect', () => {
    leaveCurrentRoom(socket);
    console.log(`[-] Ngắt kết nối: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server v3.0.0 đang chạy tại cổng ${PORT}`);
});
