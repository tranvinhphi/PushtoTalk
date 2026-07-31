/**
 * Walkie Talkie Web App - Server
 * Node.js + Express + Socket.io
 * v5.0.0
 *
 * MỚI trong v5.0.0:
 * - QR code / link chia sẻ phòng (?room=xxx tự join thẳng)
 * - Nút SOS khẩn cấp: báo động toàn phòng + ghim vị trí + push notification
 * - Vai trò "Chủ phòng": kick thành viên, khoá mic
 * - Chat chữ nhanh trong phòng
 * - Báo chất lượng mạng/trạng thái từng người (ping, battery)
 * - Lời nhắn thoại để lại (voice memo khi offline)
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const webpush = require('web-push');

const app = express();
app.use(express.json());
const server = http.createServer(app);

// ============ WEB PUSH (VAPID) ============
const VAPID_PUBLIC_KEY = 'BDTnYKWEcRAZbGHBaCekCGkDMzlnR5RZnhZKlRvrkTykxkSheHnc0xIkpYhE8_aiApr5IbhXTIRBJTkj4nUSzpc';
const VAPID_PRIVATE_KEY = 'f11gX6No3oeQWTsdwcI_31EQoG8HBCToU9oWV91rn0I';
webpush.setVapidDetails('mailto:admin@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const pushSubs = {};

function sendPushToRoom(roomCode, { title, body, tag }, excludeSocketId) {
  const subsMap = pushSubs[roomCode];
  if (!subsMap) return;
  const payload = JSON.stringify({ title, body, tag, roomCode });
  subsMap.forEach((sub, socketId) => {
    if (socketId === excludeSocketId) return;
    webpush.sendNotification(sub, payload).catch((err) => {
      if (err.statusCode === 404 || err.statusCode === 410) subsMap.delete(socketId);
      else console.log('Lỗi gửi push:', err.message);
    });
  });
}

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 8 * 1024 * 1024,
  pingTimeout: 20000,
  pingInterval: 10000,
});

app.get('/', (req, res) => res.send('Walkie Talkie Server v5.0.0 đang chạy.'));
app.get('/health', (req, res) => res.status(200).json({ status: 'ok', version: '5.0.0' }));
app.get('/vapid-public-key', (req, res) => res.status(200).json({ key: VAPID_PUBLIC_KEY }));

// rooms[roomCode][socketId] = { username, lat, lng, ping, battery, muted }
const rooms = {};
// roomOwners[roomCode] = socketId of first person who created the room
const roomOwners = {};
// micHolders[roomCode] = { socketId, username, sinceTs } | null
const micHolders = {};
const micTimeouts = {};
// voiceMemos[roomCode] = { username, audioBuffer, ts } | null  (lưu đoạn cuối)
const voiceMemos = {};

const MAX_HOLD_MS = 90 * 1000;
const ROOM_CODE_REGEX = /^[A-Za-zÀ-ỹà-ỹ0-9_-]{3,20}$/;
const GIBBERISH_LIST = ['test','asdf','asdfg','asdfgh','qwerty','qwe','zxcv','zxcvb','fdsa','lkjh','hjkl','abcxyz','lorem','ipsum','anonymous','nickname','unknown'];

function isRealLookingName(rawName) {
  const name = rawName.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 30) return false;
  if (!/^[\p{L}\s]+$/u.test(name)) return false;
  if (/(.)\1{2,}/i.test(name.replace(/\s/g, ''))) return false;
  const lower = name.toLowerCase();
  if (GIBBERISH_LIST.some((g) => lower.includes(g))) return false;
  const uniqueChars = new Set(lower.replace(/\s/g, '').split(''));
  if (uniqueChars.size < 2) return false;
  const words = name.split(' ');
  const hasVowel = (w) => /[aeiouyAEIOUY]/.test(w.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
  if (!words.every(hasVowel)) return false;
  return true;
}

function getRoomUserList(roomCode) {
  if (!rooms[roomCode]) return [];
  const ownerSocketId = roomOwners[roomCode];
  return Object.entries(rooms[roomCode]).map(([id, data]) => ({
    id,
    username: data.username,
    lat: data.lat,
    lng: data.lng,
    ping: data.ping || null,
    battery: data.battery || null,
    muted: data.muted || false,
    isOwner: id === ownerSocketId,
  }));
}

function broadcastUserList(roomCode) {
  io.to(roomCode).emit('user-list', getRoomUserList(roomCode));
}

function clearMicTimeout(roomCode) {
  if (micTimeouts[roomCode]) { clearTimeout(micTimeouts[roomCode]); delete micTimeouts[roomCode]; }
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
  micTimeouts[roomCode] = setTimeout(() => releaseMic(roomCode, 'timeout'), MAX_HOLD_MS);
  socket.emit('mic-granted', { username });
  io.to(roomCode).emit('speaking-start', { username });
  sendPushToRoom(roomCode, { title: `🎙️ ${username} đang nói`, body: `Phòng ${roomCode} - bấm để mở Bộ Đàm`, tag: 'botdam-speaking' }, socket.id);
}

function leaveCurrentRoom(socket) {
  const { roomCode, username } = socket.data;
  if (!roomCode || !rooms[roomCode]) return;

  const holder = micHolders[roomCode];
  if (holder && holder.socketId === socket.id) releaseMic(roomCode, 'left');

  delete rooms[roomCode][socket.id];
  socket.leave(roomCode);
  if (pushSubs[roomCode]) pushSubs[roomCode].delete(socket.id);

  if (Object.keys(rooms[roomCode]).length === 0) {
    delete rooms[roomCode];
    delete micHolders[roomCode];
    delete pushSubs[roomCode];
    delete roomOwners[roomCode];
    delete voiceMemos[roomCode];
    clearMicTimeout(roomCode);
  } else {
    // Nếu owner rời đi, chuyển quyền cho người đầu tiên còn lại
    if (roomOwners[roomCode] === socket.id) {
      const nextOwnerId = Object.keys(rooms[roomCode])[0];
      roomOwners[roomCode] = nextOwnerId;
      const nextOwnerName = rooms[roomCode][nextOwnerId].username;
      io.to(roomCode).emit('system-message', `👑 ${nextOwnerName} đã trở thành Chủ phòng mới.`);
      io.to(nextOwnerId).emit('you-are-owner');
    }
    broadcastUserList(roomCode);
    io.to(roomCode).emit('system-message', `${username || 'Một người dùng'} đã rời phòng.`);
  }
}

io.on('connection', (socket) => {
  console.log(`[+] Kết nối mới: ${socket.id}`);

  socket.on('join-room', ({ roomCode, username }) => {
    if (!roomCode || !username) { socket.emit('join-error', 'Vui lòng nhập đầy đủ Mã phòng và Tên hiển thị.'); return; }

    roomCode = String(roomCode).trim().substring(0, 20);
    username = String(username).trim().replace(/\s+/g, ' ').substring(0, 30);

    if (!ROOM_CODE_REGEX.test(roomCode)) { socket.emit('join-error', 'Mã phòng phải dài 3-20 ký tự, chỉ gồm chữ/số/gạch dưới/gạch ngang.'); return; }
    if (!isRealLookingName(username)) { socket.emit('join-error', 'Tên chưa hợp lệ - chỉ nhập tên thật bằng chữ cái (không số, không ký tự đặc biệt).'); return; }

    const lowerUsername = username.toLowerCase();
    const isSelfRejoin = socket.data.roomCode === roomCode && socket.data.username && socket.data.username.toLowerCase() === lowerUsername;
    if (!isSelfRejoin && rooms[roomCode]) {
      const taken = Object.values(rooms[roomCode]).some((u) => u.username.toLowerCase() === lowerUsername);
      if (taken) { socket.emit('join-error', `Tên "${username}" đã có người dùng trong phòng này rồi, hãy chọn tên khác.`); return; }
    }

    leaveCurrentRoom(socket);
    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.username = username;

    const isNewRoom = !rooms[roomCode];
    if (!rooms[roomCode]) rooms[roomCode] = {};
    rooms[roomCode][socket.id] = { username, lat: null, lng: null, ping: null, battery: null, muted: false };
    if (!(roomCode in micHolders)) micHolders[roomCode] = null;

    // Người đầu tiên vào = chủ phòng
    if (isNewRoom) {
      roomOwners[roomCode] = socket.id;
      socket.emit('you-are-owner');
    }

    const isOwner = roomOwners[roomCode] === socket.id;
    socket.emit('joined', { roomCode, username, isOwner });
    broadcastUserList(roomCode);
    socket.to(roomCode).emit('system-message', `${username} đã vào phòng.`);

    const holder = micHolders[roomCode];
    if (holder) socket.emit('speaking-start', { username: holder.username });

    // Gửi voice memo còn lại (nếu có) cho người mới vào
    if (voiceMemos[roomCode]) {
      const memo = voiceMemos[roomCode];
      socket.emit('voice-memo', { username: memo.username, audio: memo.audioBuffer, ts: memo.ts });
    }

    console.log(`[Room ${roomCode}] ${username} đã tham gia. Tổng: ${Object.keys(rooms[roomCode]).length}`);
  });

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

  // Cập nhật ping + battery từ client
  socket.on('update-status', ({ ping, battery }) => {
    const { roomCode } = socket.data;
    if (!roomCode || !rooms[roomCode] || !rooms[roomCode][socket.id]) return;
    if (typeof ping === 'number') rooms[roomCode][socket.id].ping = ping;
    if (typeof battery === 'number') rooms[roomCode][socket.id].battery = battery;
    broadcastUserList(roomCode);
  });

  // ============ MIC ============
  socket.on('start-speaking', () => {
    const { roomCode, username } = socket.data;
    if (!roomCode) return;
    // Kiểm tra mic bị khoá không
    if (rooms[roomCode] && rooms[roomCode][socket.id] && rooms[roomCode][socket.id].muted) {
      socket.emit('mic-denied', { holder: 'Chủ phòng (mic của bạn bị khoá)' });
      return;
    }
    const holder = micHolders[roomCode];
    if (!holder) grantMic(roomCode, socket, username);
    else if (holder.socketId === socket.id) { /* đã giữ */ }
    else socket.emit('mic-denied', { holder: holder.username });
  });

  socket.on('stop-speaking', () => {
    const { roomCode } = socket.data;
    if (!roomCode) return;
    const holder = micHolders[roomCode];
    if (holder && holder.socketId === socket.id) releaseMic(roomCode, 'released');
  });

  socket.on('audio-data', (audioBuffer) => {
    const { roomCode, username } = socket.data;
    if (!roomCode || !audioBuffer) return;
    const holder = micHolders[roomCode];
    if (!holder || holder.socketId !== socket.id) return;
    socket.to(roomCode).emit('audio-data', { username, audio: audioBuffer });
    // Lưu voice memo (đoạn cuối cùng)
    voiceMemos[roomCode] = { username, audioBuffer, ts: Date.now() };
  });

  // ============ SOS ============
  socket.on('sos', ({ lat, lng }) => {
    const { roomCode, username } = socket.data;
    if (!roomCode || !username) return;
    console.log(`[SOS] ${username} trong phòng ${roomCode}`);
    io.to(roomCode).emit('sos-alert', { username, lat, lng, ts: Date.now() });
    sendPushToRoom(roomCode, {
      title: `🆘 SOS từ ${username}!`,
      body: `Cần hỗ trợ khẩn cấp - Phòng ${roomCode}`,
      tag: 'botdam-sos',
    }, socket.id);
  });

  // ============ CHAT ============
  socket.on('chat-message', ({ text }) => {
    const { roomCode, username } = socket.data;
    if (!roomCode || !username || !text) return;
    const msg = String(text).trim().substring(0, 300);
    if (!msg) return;
    io.to(roomCode).emit('chat-message', { username, text: msg, ts: Date.now() });
  });

  // ============ OWNER CONTROLS ============
  socket.on('kick-user', ({ targetId }) => {
    const { roomCode } = socket.data;
    if (!roomCode || roomOwners[roomCode] !== socket.id) return;
    const targetSocket = io.sockets.sockets.get(targetId);
    if (!targetSocket || !rooms[roomCode] || !rooms[roomCode][targetId]) return;
    const targetName = rooms[roomCode][targetId].username;
    targetSocket.emit('kicked', { reason: 'Chủ phòng đã mời bạn rời khỏi phòng.' });
    leaveCurrentRoom(targetSocket);
    io.to(roomCode).emit('system-message', `👢 ${targetName} đã bị chủ phòng mời ra.`);
  });

  socket.on('toggle-mute', ({ targetId }) => {
    const { roomCode } = socket.data;
    if (!roomCode || roomOwners[roomCode] !== socket.id) return;
    if (!rooms[roomCode] || !rooms[roomCode][targetId]) return;
    const wasHolding = micHolders[roomCode] && micHolders[roomCode].socketId === targetId;
    rooms[roomCode][targetId].muted = !rooms[roomCode][targetId].muted;
    const isMuted = rooms[roomCode][targetId].muted;
    const targetName = rooms[roomCode][targetId].username;
    if (isMuted && wasHolding) releaseMic(roomCode, 'muted');
    io.sockets.sockets.get(targetId)?.emit('you-are-muted', { muted: isMuted });
    io.to(roomCode).emit('system-message', isMuted ? `🔇 ${targetName} đã bị tắt mic.` : `🔊 ${targetName} đã được bật lại mic.`);
    broadcastUserList(roomCode);
  });

  // ============ REACTION ============
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
server.listen(PORT, () => console.log(`Server v5.0.0 đang chạy tại cổng ${PORT}`));
