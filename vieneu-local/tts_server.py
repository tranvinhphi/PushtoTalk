#!/usr/bin/env python3
"""
VieNeu-TTS Local Server — Bộ Đàm Web v10
=========================================
Chạy trên máy bạn, lắng nghe POST /tts
Dùng làm fallback khi Zalo AI / ViettelAI không phản hồi

Cài đặt (Windows/Mac/Linux):
  pip install vieneu flask
  python tts_server.py

Sau đó sửa biến VIENEU_URL trong server.js:
  const VIENEU_LOCAL_URL = 'http://YOUR_IP:7860/tts';
"""
import base64, io, os, sys
from flask import Flask, request, jsonify

app = Flask(__name__)
tts = None

VOICE_MAP = {
    'nu-nam': 'Trúc Ly',     # nữ miền Nam (default)
    'nu-bac': 'Ngọc',        # nữ miền Bắc
    'nam-nam': 'Tuyên',      # nam miền Bắc
    'nam-bac': 'Vinh',       # nam miền Bắc
}

def load_tts():
    global tts
    try:
        from vieneu import Vieneu
        print('[VieNeu] Đang tải model... (lần đầu mất ~30s)')
        tts = Vieneu()
        voices = tts.list_preset_voices()
        print(f'[VieNeu] Model sẵn sàng. Giọng có sẵn:')
        for label, vid in voices:
            print(f'  - {label} ({vid})')
        return True
    except ImportError:
        print('[VieNeu] Chưa cài vieneu. Chạy: pip install vieneu')
        return False
    except Exception as e:
        print(f'[VieNeu] Lỗi khi tải model: {e}')
        return False

@app.route('/health')
def health():
    return jsonify({'status': 'ok', 'tts_loaded': tts is not None})

@app.route('/tts', methods=['POST'])
def synthesize():
    if tts is None:
        return jsonify({'error': 'TTS model not loaded'}), 503
    data = request.json or {}
    text = data.get('text', '').strip()[:500]
    voice_key = data.get('voice', 'nu-nam')
    voice_name = VOICE_MAP.get(voice_key, 'Trúc Ly')
    if not text:
        return jsonify({'error': 'text required'}), 400
    try:
        audio = tts.infer(text, voice=voice_name)
        # Convert to WAV bytes in memory
        buf = io.BytesIO()
        tts.save(audio, buf)
        buf.seek(0)
        audio_b64 = base64.b64encode(buf.read()).decode()
        return jsonify({'audio': audio_b64, 'source': 'vieneu-local', 'voice': voice_name})
    except Exception as e:
        print(f'[VieNeu] Lỗi synthesize: {e}')
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 7860))
    print(f'[VieNeu Local TTS Server]')
    print(f'Cài đặt: pip install vieneu flask')
    if not load_tts():
        print('⚠ Chạy server không có TTS — mọi request sẽ lỗi 503')
    print(f'Server đang chạy tại http://localhost:{port}')
    print(f'Nhấn Ctrl+C để dừng\n')
    app.run(host='0.0.0.0', port=port, debug=False)
