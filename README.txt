WalkieTalkieWeb - v1.0.0
=========================

Bo dam Web mien phi, chay tren trinh duyet (toi uu Safari/iPhone).

Cau truc:
- server.js      : Backend Node.js + Socket.io (deploy len Render)
- package.json    : Khai bao dependencies cho server
- index.html      : Frontend HTML/JS thuan (deploy len Vercel)

Truoc khi deploy:
1. Deploy server.js + package.json len Render, lay URL dang
   https://ten-app.onrender.com
2. Mo index.html, sua dong:
     const SERVER_URL = "https://YOUR-RENDER-SERVER-URL.onrender.com";
   thanh URL Render that.
3. Deploy index.html len Vercel.

Xem huong dan chi tiet trong phan chat da trao doi.
