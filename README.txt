WalkieTalkieWeb - v4.0.0
=========================

TINH NANG MOI TRONG v4.0.0
---------------------------

1) PHONG MAC DINH "ROOMCASA"
   - Ma phong duoc dien san la ROOMCASA khi mo app (van co the sua lai
     thanh ma phong khac neu muon).

2) CHON TEN TU DANH SACH CO SAN (hoac tu nhap)
   - Thay vi go tay, gio co the CHON nhanh ten trong danh sach 20 nguoi:
     Phi, HongAnh, VietNgoc, Thuong, MinhNgoc, Nhan, Tuan, Thuan, AnhMinh,
     MinhAnh, Nam, Tram, Huong, An, Loan, Hoai, Hien, Khoa, Son, Huyen.
   - Neu ten khong co trong danh sach, chon "Tu nhap ten khac..." o cuoi
     danh sach de go ten rieng nhu binh thuong.

3) GIU MAN HINH SANG (nut 🔆 tren thanh header trong phong)
   - Bam de bat Wake Lock - man hinh dien thoai se KHONG tu tat trong luc
     dung app, rat hop khi gan dien thoai tren xe di duong dai.
   - GIOI HAN THUC TE: Wake Lock chi hoat dong khi tab dang HIEN THI truoc
     mat. Neu ban chuyen han sang mo app khac (Zalo, Google Maps...), trinh
     duyet se TU NHA wake lock va man hinh co the tu khoa lai binh thuong -
     day la gioi han ky thuat cua moi trinh duyet, khong the vuot qua duoc
     tu phia web app.

4) THONG BAO + RUNG KHI CO NGUOI BAT DAU NOI (nut 🔔, Web Push)
   - Bam de cho phep thong bao. Sau do, ke ca khi ban da chuyen sang dung
     app/tab khac, may se BAO (thong bao he thong + rung) moi khi co ai do
     trong phong bat dau noi, de ban biet ma bam quay lai mo app nghe.
   - Bam vao thong bao se tu mo lai app.
   - GIOI HAN THUC TE QUAN TRONG:
     * Day la thong bao "co nguoi dang noi", KHONG PHAI tu dong phat lai
       am thanh - trinh duyet KHONG the tu chay code de nhan/phat am thanh
       khi app dang bi thu nho hoan toan o nen. Ban van can mo lai app de
       nghe (giong nhu bo dam that: nghe tieng "keng" bao co nguoi goi,
       roi cam len nghe).
     * Tren Android Chrome: hoat dong kha tot ke ca khi chua cai app, nhung
       on dinh nhat la sau khi da "Cai dat app" (xem muc 5).
     * Tren iPhone (Safari): BAT BUOC phai "Them vao Man hinh chinh" truoc
       (co banner huong dan ngay trong app), va can iOS 16.4 tro len. Neu
       chi mo bang Safari binh thuong (chua Them vao MH chinh) thi Web Push
       se KHONG hoat dong duoc, day la gioi han cua Apple, khong phai loi
       cua app.
     * He dieu hanh (Android/iOS) van co the "diet" tab/app chay nen sau
       mot thoi gian de tiet kiem pin - khong co cach nao dam bao 100% se
       luon nhan duoc thong bao trong moi truong hop.

5) CAI DAT APP RA MAN HINH CHINH (PWA, nut 📲 khi trinh duyet ho tro)
   - Bien app thanh 1 icon rieng tren man hinh dien thoai, mo len chay
     giong app that (khong thanh dia chi trinh duyet), giup app on dinh
     hon so voi mo trong 1 tab Chrome/Safari thuong khi bi dua xuong nen.
   - Tren Android Chrome/Edge: se thay nut 📲 hien ra tu dong, bam la cai
     duoc ngay.
   - Tren iPhone Safari: lam theo banner huong dan trong app (Chia se ->
     Them vao Man hinh chinh).

Cau truc file MOI so voi v3.0.0:
- manifest.json  : Khai bao PWA (ten app, icon, mau nen...)
- sw.js          : Service Worker - nhan Web Push va cho phep cai dat app
- icon-192.png, icon-512.png : Icon app (theo tong mau xanh mint cua app)

LUU Y KHI DEPLOY (THEM SO VOI v3.0.0):
- manifest.json, sw.js, icon-192.png, icon-512.png phai duoc deploy CUNG
  THU MUC voi index.html (cung 1 goc domain), khong duoc doi ten hay bo qua
  file nao, neu khong PWA/Push se khong hoat dong.
- Web Push CAN server chay HTTPS (Render da san co HTTPS) va frontend cung
  phai la HTTPS (Vercel deploy mac dinh la HTTPS) - KHONG chay duoc Web
  Push tren http:// thuong (tru localhost khi test).
- server.js da co san 1 cap khoa VAPID (dung de xac thuc Web Push) de chay
  duoc ngay khong can cau hinh gi them. Neu muon tu tao cap khoa rieng cho
  production that su thi chay lenh: npx web-push generate-vapid-keys
  roi thay 2 gia tri VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY dau file server.js.

WalkieTalkieWeb - v3.0.0 (lich su)
=========================

TINH NANG MOI TRONG v3.0.0
---------------------------

1) TRUYEN AM THANH GAN REAL-TIME (khong doi den luc nha nut)
   - Truoc day: bam giu -> noi -> tha nut -> luc do moi gui am thanh di.
   - Bay gio: bam 1 lan -> mic duoc "giu" -> am thanh duoc ghi va GUI DI
     LIEN TUC theo tung doan nho ~350ms trong luc dang noi, nguoi nghe
     nhan duoc va phat ngay lap tuc, khong can doi ban noi xong.
   - Ly do dung chunk 350ms thay vi stream byte-lien-tuc: MediaRecorder
     tren trinh duyet (dac biet Safari iOS) khong the giai ma tung mieng
     nho cua 1 file am thanh lien tuc (thieu phan header). Giai phap on
     dinh nhat la ghi nhieu doan NGAN nhung DOC LAP (moi doan la 1 file
     am thanh hoan chinh rieng), gui ngay khi vua ghi xong, roi ghi tiep
     doan ke tiep - tao cam giac gan nhu truyen truc tiep (do tre ~0.3-0.6s)
     ma van phat duoc on dinh tren moi trinh duyet, ke ca Safari iOS.

2) CO CHE "GIANH MIC" (mic lock)
   - Ca phong chi 1 nguoi noi duoc tai 1 thoi diem.
   - Ai bam nut TRUOC (tuc goi toi server truoc - phu thuoc toc do mang
     tung nguoi) se duoc cap mic va bat dau noi ngay.
   - Nguoi bam sau trong luc mic dang ban se nhan duoc thong bao vui:
     "Cham chan roi! [Ten] da gianh mic truoc ban."
   - Khi ai do gianh duoc mic thanh cong, TOAN PHONG deu thay thong bao:
     "[Ten] da gianh duoc mic thanh cong!"
   - Tu dong nha mic neu giu lien tuc qua 90 giay (phong loi mang khien
     client khong gui duoc lenh dung noi).

3) GIAO DIEN THIET KE LAI HOAN TOAN (Mobile-first Dark Mode)
   - Man hinh vao phong toi gian: chi Ma phong + Ten, khong ram ri.
   - Header gon: Ma phong ben trai, nut "Roi phong" dang outline ben phai.
   - Ban do (Leaflet/OpenStreetMap) chiem ~34% man hinh, bo goc 18px,
     marker vi tri co hieu ung "ping" lan toa nhu radar.
   - Danh sach thanh vien: avatar mau rieng, cham xanh online, nguoi dang
     noi TU DONG nhay len dau danh sach kem icon mic nhap nhay.
   - Nut BAM DE NOI dat co dinh duoi day man hinh, khi dang noi phat
     sang neon xanh + hieu ung song am (ripple) lan toa xung quanh nut.
   - Toi uu iPhone Safari: co safe-area-inset cho tai nghe/thanh home bar,
     khong bi tran hay cuon ngang.

4) 20 EMOJI CAM XUC VUI NHON
   - Bam nut mat cuoi tron canh nut mic -> mo bang chon 20 emoji.
   - Chon emoji se bay len man hinh moi nguoi trong phong kem ten nguoi gui,
     tu tan bien sau ~2.5 giay (giong hieu ung tha tim tren livestream).
   - Danh sach 20 emoji: 😂 🤣 😭 😢 😡 😠 😱 😍 🥳 😴 🤔 👍 👎 ❤️ 🔥 💯 🎉 😅 🙄 🤯

Cau truc (1 folder duy nhat):
- server.js       : Backend Node.js + Socket.io (deploy len Render)
- package.json    : Khai bao dependencies cho server
- index.html      : Frontend HTML/JS thuan (deploy len Vercel)

Truoc khi deploy:
1. Deploy server.js + package.json len Render (hoac cap nhat lai service
   Render hien tai bang code moi nay).
2. index.html da duoc dien san SERVER_URL = https://pushtotalk-anqr.onrender.com
   Neu URL Render thay doi, sua lai dong nay trong index.html.
3. Deploy index.html len Vercel.

LUU Y VE DO TRE AM THANH:
- Do tre hien tai roi vao khoang 0.3 - 0.8 giay tuy toc do mang, day la
  muc do tre chap nhan duoc cho bo dam khong dung WebRTC. Neu muon giam
  further xuong muc tuc thoi (<100ms) can nang cap len kien truc WebRTC
  (peer-to-peen hoac qua SFU/TURN server), day la mot buoc nang cap lon
  hon nhieu ve ha tang - co the trao doi them neu ban muon.
