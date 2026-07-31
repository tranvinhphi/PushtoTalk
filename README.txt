WalkieTalkieWeb - v2.0.0
=========================

Bo dam Web mien phi, chay tren trinh duyet (toi uu Safari/iPhone).
UI phong kieu Paltalk: danh sach thanh vien, avatar mau, mic nhay len
dau list khi dang noi, ban do vi tri thanh vien, che do bam-1-lan-de-noi
an toan khi lai xe.

TINH NANG MOI TRONG v2.0.0:
1. Danh sach thanh vien kieu Paltalk
   - Avatar tron mau rieng theo ten (khong trung nhau)
   - Nguoi dang noi tu dong nhay len dau danh sach
   - Icon mic nhap nhay ben canh ten khi nguoi do dang noi
2. Ban do vi tri thanh vien (Leaflet + OpenStreetMap, khong can API key)
   - Sau khi vao phong, trinh duyet se hoi quyen vi tri (co the tu choi,
     app van hoat dong binh thuong, chi khong hien tren ban do)
   - Moi thanh vien co pin mau rieng tren ban do, ban do tu dong zoom
     vua khung de thay het moi nguoi
   - Tren mobile: co 2 tab "Thanh vien" / "Ban do" de chuyen doi
3. Che do bam 1 lan de noi (an toan khi lai xe)
   - Bam 1 lan vao nut mic -> tu dong GIU mic (khong can giu tay)
   - Trong luc chuan bi: nut chuyen mau vang "DANG CHUAN BI..."
   - Khi san sang: co tieng beep bao hieu + rung (neu may ho tro) +
     nut chuyen xanh la "DANG NOI (bam de dung)"
   - Bam lan nua -> dung noi, gui di, co tieng beep thap bao ket thuc

Cau truc (tat ca trong 1 folder):
- server.js       : Backend Node.js + Socket.io (deploy len Render)
- package.json    : Khai bao dependencies cho server
- index.html      : Frontend HTML/JS thuan (deploy len Vercel)

Truoc khi deploy:
1. Deploy server.js + package.json len Render, lay URL dang
   https://ten-app.onrender.com
2. Mo index.html, sua dong:
     const SERVER_URL = "https://YOUR-RENDER-SERVER-URL.onrender.com";
   thanh URL Render that.
3. Deploy index.html len Vercel.

Luu y:
- Ban do dung tile mien phi cua OpenStreetMap, load truc tiep tu trinh
  duyet nguoi dung (khong can server rieng, khong ton phi).
- Vi tri GPS chi duoc gui len khi nguoi dung dong y cap quyen vi tri
  cua trinh duyet/dien thoai.
