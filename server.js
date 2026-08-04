/**
 * Walkie Talkie Web App - Server v6.0.2
 * Fix:
 * 1. camera-state broadcast ngay lập tức khi toggle
 * 2. approval queue reset đúng khi owner reconnect
 * 3. socket reconnect tự rejoin
 */
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const webpush = require('web-push');

const app = express();
app.use(express.json());
app.use(express.static(__dirname)); // serve index.html trực tiếp
const server = http.createServer(app);

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
    webpush.sendNotification(sub, payload).catch(err => {
      if (err.statusCode === 404 || err.statusCode === 410) subsMap.delete(socketId);
    });
  });
}

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 10 * 1024 * 1024,
  pingTimeout: 20000,
  pingInterval: 10000,
});

app.get('/health', (req, res) => res.json({ status: 'ok', version: '6.0.2' }));
app.get('/vapid-public-key', (req, res) => res.json({ key: VAPID_PUBLIC_KEY }));

// ============ DATA ============
const rooms      = {}; // rooms[code][socketId] = { username, lat, lng, ping, battery, muted, hasCamera, cameraOn }
const roomMeta   = {}; // { isPublic, requireApproval, description, createdAt }
const roomOwners = {}; // roomOwners[code] = socketId
const micHolders = {}; // { socketId, username, sinceTs } | null
const micTimeouts= {};
const approvalQueue = {}; // [{ socketId, username, requestedAt }]
const voiceMemos = {}; // { username, audioBuffer, ts }

const MAX_HOLD_MS = 90000;
const ROOM_CODE_REGEX = /^[A-Za-zÀ-ỹà-ỹ0-9_-]{3,20}$/;
const GIBBERISH = ['test','asdf','asdfg','asdfgh','qwerty','qwe','zxcv','zxcvb','fdsa','lkjh','hjkl','abcxyz','lorem','ipsum','anonymous','nickname','unknown'];

function isRealLookingName(rawName) {
  const name = rawName.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 30) return false;
  if (!/^[\p{L}\s]+$/u.test(name)) return false;
  if (/(.)\1{2,}/i.test(name.replace(/\s/g, ''))) return false;
  const lower = name.toLowerCase();
  if (GIBBERISH.some(g => lower.includes(g))) return false;
  if (new Set(lower.replace(/\s/g,'').split('')).size < 2) return false;
  const hasVowel = w => /[aeiouyAEIOUY]/.test(w.normalize('NFD').replace(/[\u0300-\u036f]/g,''));
  return name.split(' ').every(hasVowel);
}

function getRoomUserList(roomCode) {
  if (!rooms[roomCode]) return [];
  const ownerSocketId = roomOwners[roomCode];
  return Object.entries(rooms[roomCode]).map(([id, d]) => ({
    id, username: d.username, lat: d.lat, lng: d.lng,
    ping: d.ping||null, battery: d.battery||null,
    muted: d.muted||false, isOwner: id === ownerSocketId,
    hasCamera: d.hasCamera||false, cameraOn: d.cameraOn||false,
  }));
}

function broadcastUserList(roomCode) {
  io.to(roomCode).emit('user-list', getRoomUserList(roomCode));
}

function getPublicRooms(query) {
  const result = [];
  for (const [code, meta] of Object.entries(roomMeta)) {
    if (!meta.isPublic) continue;
    const memberCount = rooms[code] ? Object.keys(rooms[code]).length : 0;
    if (memberCount === 0) continue;
    if (query && !code.toLowerCase().includes(query) && !(meta.description||'').toLowerCase().includes(query)) continue;
    result.push({ code, memberCount, description: meta.description||'', requireApproval: meta.requireApproval||false, createdAt: meta.createdAt });
  }
  return result.sort((a, b) => b.memberCount - a.memberCount);
}

app.get('/rooms', (req, res) => {
  const q = (req.query.q||'').toLowerCase().trim();
  res.json(getPublicRooms(q||null));
});

function clearMicTimeout(roomCode) {
  if (micTimeouts[roomCode]) { clearTimeout(micTimeouts[roomCode]); delete micTimeouts[roomCode]; }
}

function releaseMic(roomCode, reason) {
  const holder = micHolders[roomCode];
  if (!holder) return;
  micHolders[roomCode] = null;
  clearMicTimeout(roomCode);
  io.to(roomCode).emit('speaking-stop', { username: holder.username, reason: reason||'released' });
}

function grantMic(roomCode, socket, username) {
  micHolders[roomCode] = { socketId: socket.id, username, sinceTs: Date.now() };
  clearMicTimeout(roomCode);
  micTimeouts[roomCode] = setTimeout(() => releaseMic(roomCode, 'timeout'), MAX_HOLD_MS);
  socket.emit('mic-granted', { username });
  io.to(roomCode).emit('speaking-start', { username });
  sendPushToRoom(roomCode, { title: `🎙️ ${username} đang nói`, body: `Phòng ${roomCode}`, tag: 'botdam-speaking' }, socket.id);
}

function doJoinRoom(socket, roomCode, username) {
  socket.join(roomCode);
  socket.data.roomCode = roomCode;
  socket.data.username = username;
  socket.data.pendingRoom = null;
  socket.data.pendingUsername = null;

  const isNewRoom = !rooms[roomCode];
  if (!rooms[roomCode]) rooms[roomCode] = {};
  rooms[roomCode][socket.id] = { username, lat:null, lng:null, ping:null, battery:null, muted:false, hasCamera:false, cameraOn:false };
  if (!(roomCode in micHolders)) micHolders[roomCode] = null;
  if (!approvalQueue[roomCode]) approvalQueue[roomCode] = [];

  if (isNewRoom) {
    roomOwners[roomCode] = socket.id;
    if (!roomMeta[roomCode]) roomMeta[roomCode] = { isPublic:true, requireApproval:false, description:'', createdAt:Date.now() };
  }

  const isOwner = roomOwners[roomCode] === socket.id;
  if (isOwner) {
    socket.emit('you-are-owner');
    socket.emit('room-settings', roomMeta[roomCode]);
    // FIX: gửi lại approval queue hiện tại cho owner khi rejoin
    if (approvalQueue[roomCode] && approvalQueue[roomCode].length > 0) {
      approvalQueue[roomCode].forEach(req => {
        socket.emit('approval-request', { socketId: req.socketId, username: req.username, roomCode });
      });
    }
  }

  socket.emit('joined', { roomCode, username, isOwner });
  broadcastUserList(roomCode);
  socket.to(roomCode).emit('system-message', `${username} đã vào phòng.`);

  const holder = micHolders[roomCode];
  if (holder) socket.emit('speaking-start', { username: holder.username });

  if (voiceMemos[roomCode]) {
    const m = voiceMemos[roomCode];
    socket.emit('voice-memo', { username: m.username, audio: m.audioBuffer, ts: m.ts });
  }

  console.log(`[Room ${roomCode}] ${username} joined. Total: ${Object.keys(rooms[roomCode]).length}`);
}

function leaveCurrentRoom(socket) {
  const { roomCode, username } = socket.data;
  if (!roomCode || !rooms[roomCode]) return;

  const holder = micHolders[roomCode];
  if (holder && holder.socketId === socket.id) releaseMic(roomCode, 'left');

  if (rooms[roomCode][socket.id]) {
    rooms[roomCode][socket.id].cameraOn = false;
    rooms[roomCode][socket.id].hasCamera = false;
  }

  delete rooms[roomCode][socket.id];
  socket.leave(roomCode);
  if (pushSubs[roomCode]) pushSubs[roomCode].delete(socket.id);
  if (approvalQueue[roomCode]) {
    approvalQueue[roomCode] = approvalQueue[roomCode].filter(r => r.socketId !== socket.id);
  }

  if (Object.keys(rooms[roomCode]).length === 0) {
    delete rooms[roomCode];
    delete micHolders[roomCode];
    delete pushSubs[roomCode];
    delete roomOwners[roomCode];
    delete voiceMemos[roomCode];
    delete approvalQueue[roomCode];
    clearMicTimeout(roomCode);
  } else {
    if (roomOwners[roomCode] === socket.id) {
      const nextOwnerId = Object.keys(rooms[roomCode])[0];
      roomOwners[roomCode] = nextOwnerId;
      const nextName = rooms[roomCode][nextOwnerId].username;
      io.to(roomCode).emit('system-message', `👑 ${nextName} đã trở thành Chủ phòng mới.`);
      io.to(nextOwnerId).emit('you-are-owner');
      io.to(nextOwnerId).emit('room-settings', roomMeta[roomCode]||{});
      // Gửi lại approval queue cho owner mới
      if (approvalQueue[roomCode] && approvalQueue[roomCode].length > 0) {
        approvalQueue[roomCode].forEach(req => {
          io.to(nextOwnerId).emit('approval-request', { socketId: req.socketId, username: req.username, roomCode });
        });
      }
    }
    broadcastUserList(roomCode);
    io.to(roomCode).emit('system-message', `${username||'Một người dùng'} đã rời phòng.`);
  }
}

io.on('connection', socket => {
  console.log(`[+] ${socket.id}`);

  socket.on('join-room', ({ roomCode, username }) => {
    if (!roomCode || !username) { socket.emit('join-error', 'Vui lòng nhập đầy đủ thông tin.'); return; }
    roomCode = String(roomCode).trim().substring(0,20);
    username = String(username).trim().replace(/\s+/g,' ').substring(0,30);

    if (!ROOM_CODE_REGEX.test(roomCode)) { socket.emit('join-error', 'Mã phòng không hợp lệ.'); return; }
    if (!isRealLookingName(username)) { socket.emit('join-error', 'Tên không hợp lệ - chỉ dùng chữ cái.'); return; }

    const lowerUsername = username.toLowerCase();
    const isSelfRejoin = socket.data.roomCode === roomCode && socket.data.username?.toLowerCase() === lowerUsername;
    if (!isSelfRejoin && rooms[roomCode]) {
      const taken = Object.values(rooms[roomCode]).some(u => u.username.toLowerCase() === lowerUsername);
      if (taken) { socket.emit('join-error', `Tên "${username}" đã có người dùng trong phòng này.`); return; }
    }

    leaveCurrentRoom(socket);

    const meta = roomMeta[roomCode];
    const roomExists = !!rooms[roomCode];
    const isOwnerJoining = roomOwners[roomCode] === socket.id;

    if (roomExists && meta?.requireApproval && !isOwnerJoining) {
      if (!approvalQueue[roomCode]) approvalQueue[roomCode] = [];
      const already = approvalQueue[roomCode].find(r => r.username.toLowerCase() === lowerUsername);
      if (!already) approvalQueue[roomCode].push({ socketId: socket.id, username, requestedAt: Date.now() });
      socket.data.pendingRoom = roomCode;
      socket.data.pendingUsername = username;
      socket.emit('waiting-approval', { roomCode, username });
      io.to(roomOwners[roomCode]).emit('approval-request', { socketId: socket.id, username, roomCode });
      return;
    }

    doJoinRoom(socket, roomCode, username);
  });

  // FIX: client gửi rejoin-room khi socket reconnect
  socket.on('rejoin-room', ({ roomCode, username }) => {
    if (!roomCode || !username) return;
    roomCode = String(roomCode).trim().substring(0,20);
    username = String(username).trim().replace(/\s+/g,' ').substring(0,30);
    if (!ROOM_CODE_REGEX.test(roomCode) || !isRealLookingName(username)) return;
    // Chỉ rejoin nếu phòng còn tồn tại
    if (!rooms[roomCode]) { socket.emit('room-closed', { roomCode }); return; }
    // Kiểm tra tên trùng
    const taken = Object.values(rooms[roomCode]).some(u => u.username.toLowerCase() === username.toLowerCase() && !Object.keys(rooms[roomCode]).find(id => id === socket.id));
    if (taken) { socket.emit('join-error', `Tên "${username}" đã có người dùng trong phòng này.`); return; }
    doJoinRoom(socket, roomCode, username);
  });

  socket.on('approve-user', ({ targetSocketId }) => {
    const { roomCode } = socket.data;
    if (!roomCode || roomOwners[roomCode] !== socket.id) return;
    const queue = approvalQueue[roomCode]||[];
    const idx = queue.findIndex(r => r.socketId === targetSocketId);
    if (idx === -1) return;
    const { username } = queue[idx];
    approvalQueue[roomCode].splice(idx,1);
    socket.emit('approval-done', { socketId: targetSocketId });
    const targetSocket = io.sockets.sockets.get(targetSocketId);
    if (!targetSocket) return;
    doJoinRoom(targetSocket, roomCode, username);
    targetSocket.emit('approval-granted', { roomCode });
  });

  socket.on('reject-user', ({ targetSocketId }) => {
    const { roomCode } = socket.data;
    if (!roomCode || roomOwners[roomCode] !== socket.id) return;
    const queue = approvalQueue[roomCode]||[];
    const idx = queue.findIndex(r => r.socketId === targetSocketId);
    if (idx === -1) return;
    const { username } = queue[idx];
    approvalQueue[roomCode].splice(idx,1);
    socket.emit('approval-done', { socketId: targetSocketId });
    io.sockets.sockets.get(targetSocketId)?.emit('approval-rejected', { roomCode });
    io.to(roomCode).emit('system-message', `❌ ${username} đã bị từ chối.`);
  });

  socket.on('update-room-settings', ({ isPublic, requireApproval, description }) => {
    const { roomCode } = socket.data;
    if (!roomCode || roomOwners[roomCode] !== socket.id) return;
    if (!roomMeta[roomCode]) roomMeta[roomCode] = { isPublic:true, requireApproval:false, description:'', createdAt:Date.now() };
    if (typeof isPublic === 'boolean') roomMeta[roomCode].isPublic = isPublic;
    if (typeof requireApproval === 'boolean') roomMeta[roomCode].requireApproval = requireApproval;
    if (typeof description === 'string') roomMeta[roomCode].description = description.substring(0,80);
    socket.emit('room-settings', roomMeta[roomCode]);
    io.to(roomCode).emit('system-message', '⚙️ Chủ phòng đã cập nhật cài đặt phòng.');
  });

  socket.on('save-subscription', subscription => {
    const { roomCode } = socket.data;
    if (!roomCode || !subscription?.endpoint) return;
    if (!pushSubs[roomCode]) pushSubs[roomCode] = new Map();
    pushSubs[roomCode].set(socket.id, subscription);
  });

  socket.on('update-location', ({ lat, lng }) => {
    const { roomCode } = socket.data;
    if (!roomCode || !rooms[roomCode]?.[socket.id]) return;
    if (typeof lat !== 'number' || typeof lng !== 'number') return;
    rooms[roomCode][socket.id].lat = lat;
    rooms[roomCode][socket.id].lng = lng;
    broadcastUserList(roomCode);
  });

  socket.on('update-status', ({ ping, battery }) => {
    const { roomCode } = socket.data;
    if (!roomCode || !rooms[roomCode]?.[socket.id]) return;
    if (typeof ping === 'number') rooms[roomCode][socket.id].ping = ping;
    if (typeof battery === 'number') rooms[roomCode][socket.id].battery = battery;
    broadcastUserList(roomCode);
  });

  socket.on('ping-custom', () => socket.emit('pong-custom'));

  socket.on('start-speaking', () => {
    const { roomCode, username } = socket.data;
    if (!roomCode) return;
    if (rooms[roomCode]?.[socket.id]?.muted) { socket.emit('mic-denied', { holder: 'Chủ phòng (mic bị khoá)' }); return; }
    const holder = micHolders[roomCode];
    if (!holder) grantMic(roomCode, socket, username);
    else if (holder.socketId === socket.id) {}
    else socket.emit('mic-denied', { holder: holder.username });
  });

  socket.on('stop-speaking', () => {
    const { roomCode } = socket.data;
    if (!roomCode) return;
    if (micHolders[roomCode]?.socketId === socket.id) releaseMic(roomCode, 'released');
  });

  socket.on('audio-data', audioBuffer => {
    const { roomCode, username } = socket.data;
    if (!roomCode || !audioBuffer) return;
    if (micHolders[roomCode]?.socketId !== socket.id) return;
    socket.to(roomCode).emit('audio-data', { username, audio: audioBuffer });
    voiceMemos[roomCode] = { username, audioBuffer, ts: Date.now() };
  });

  // FIX: broadcast camera-state ngay lập tức
  socket.on('camera-state', ({ hasCamera, cameraOn }) => {
    const { roomCode } = socket.data;
    if (!roomCode || !rooms[roomCode]?.[socket.id]) return;
    if (typeof hasCamera === 'boolean') rooms[roomCode][socket.id].hasCamera = hasCamera;
    if (typeof cameraOn === 'boolean') rooms[roomCode][socket.id].cameraOn = cameraOn;
    broadcastUserList(roomCode);
  });

  socket.on('video-frame', ({ frame }) => {
    const { roomCode, username } = socket.data;
    if (!roomCode || !frame) return;
    socket.to(roomCode).emit('video-frame', { username, frame });
  });

  socket.on('force-camera-off', ({ targetId }) => {
    const { roomCode } = socket.data;
    if (!roomCode || roomOwners[roomCode] !== socket.id) return;
    io.sockets.sockets.get(targetId)?.emit('camera-forced-off');
    if (rooms[roomCode]?.[targetId]) {
      rooms[roomCode][targetId].cameraOn = false;
      rooms[roomCode][targetId].hasCamera = false;
      broadcastUserList(roomCode);
    }
  });

  socket.on('sos', ({ lat, lng }) => {
    const { roomCode, username } = socket.data;
    if (!roomCode || !username) return;
    io.to(roomCode).emit('sos-alert', { username, lat, lng, ts: Date.now() });
    sendPushToRoom(roomCode, { title:`🆘 SOS từ ${username}!`, body:`Cần hỗ trợ - Phòng ${roomCode}`, tag:'botdam-sos' }, socket.id);
  });

  socket.on('chat-message', ({ text }) => {
    const { roomCode, username } = socket.data;
    if (!roomCode || !username || !text) return;
    const msg = String(text).trim().substring(0,300);
    if (!msg) return;
    io.to(roomCode).emit('chat-message', { username, text: msg, ts: Date.now() });
  });

  socket.on('kick-user', ({ targetId }) => {
    const { roomCode } = socket.data;
    if (!roomCode || roomOwners[roomCode] !== socket.id) return;
    const targetSocket = io.sockets.sockets.get(targetId);
    if (!targetSocket || !rooms[roomCode]?.[targetId]) return;
    const targetName = rooms[roomCode][targetId].username;
    targetSocket.emit('kicked', { reason: 'Chủ phòng đã mời bạn rời phòng.' });
    leaveCurrentRoom(targetSocket);
    io.to(roomCode).emit('system-message', `👢 ${targetName} đã bị mời ra.`);
  });

  socket.on('toggle-mute', ({ targetId }) => {
    const { roomCode } = socket.data;
    if (!roomCode || roomOwners[roomCode] !== socket.id) return;
    if (!rooms[roomCode]?.[targetId]) return;
    const wasHolding = micHolders[roomCode]?.socketId === targetId;
    rooms[roomCode][targetId].muted = !rooms[roomCode][targetId].muted;
    const isMuted = rooms[roomCode][targetId].muted;
    const targetName = rooms[roomCode][targetId].username;
    if (isMuted && wasHolding) releaseMic(roomCode, 'muted');
    io.sockets.sockets.get(targetId)?.emit('you-are-muted', { muted: isMuted });
    io.to(roomCode).emit('system-message', isMuted ? `🔇 ${targetName} bị tắt mic.` : `🔊 ${targetName} được bật mic.`);
    broadcastUserList(roomCode);
  });

  socket.on('reaction', ({ emoji }) => {
    const { roomCode, username } = socket.data;
    if (!roomCode || !emoji) return;
    io.to(roomCode).emit('reaction', { username, emoji: String(emoji).substring(0,8) });
  });

  socket.on('disconnect', () => {
    leaveCurrentRoom(socket);
    console.log(`[-] ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server v6.0.2 running on port ${PORT}`));
