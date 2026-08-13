VieNeu-TTS Local Server — Bộ Đàm Web v10
==========================================

Đây là server TTS Việt chạy trên máy bạn, dùng model VieNeu offline.
Dùng khi Zalo AI / ViettelAI không phản hồi.

── CÀI ĐẶT ────────────────────────────────────
Windows:
  pip install vieneu flask

Mac/Linux:
  pip install vieneu flask

── CHẠY ────────────────────────────────────────
  python tts_server.py

Lần đầu chạy sẽ tự tải model (~500MB). Sau đó nhanh.

── KẾT NỐI VỚI SERVER RENDER ───────────────────
Sau khi chạy, server lắng nghe tại http://localhost:7860

Để Render gọi được server local, dùng ngrok:
  1. Tải ngrok: https://ngrok.com/download
  2. Chạy: ngrok http 7860
  3. Sao chép URL ngrok (vd: https://xxxx.ngrok.io)
  4. Thêm biến môi trường trên Render:
     VIENEU_LOCAL_URL=https://xxxx.ngrok.io/tts

── GIỌNG CÓ SẴN ────────────────────────────────
  nu-nam  → Trúc Ly  (nữ, mặc định)
  nu-bac  → Ngọc     (nữ)
  nam-nam → Tuyên    (nam)
  nam-bac → Vinh     (nam)

── TEST ─────────────────────────────────────────
curl -X POST http://localhost:7860/tts \
  -H "Content-Type: application/json" \
  -d '{"text":"Xin chào, đây là bộ đàm web","voice":"nu-nam"}'
