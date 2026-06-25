# -*- coding: utf-8 -*-
"""피기뱅크 원본 이미지를 앱 아이콘/로고로 변환한다."""
import sys
from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\양진혁\Downloads\Gemini_Generated_Image_f9gi5zf9gi5zf9gi.png"
ICON_OUT = sys.argv[2] if len(sys.argv) > 2 else r"C:\Users\양진혁\Desktop\PiggyDownloader\build\icon.png"
LOGO_OUT = sys.argv[3] if len(sys.argv) > 3 else r"C:\Users\양진혁\Desktop\PiggyDownloader\src\renderer\assets\logo.png"

img = Image.open(SRC).convert("RGBA")
w, h = img.size
# 정사각형 중앙 크롭
side = min(w, h)
left = (w - side) // 2
top = (h - side) // 2
sq = img.crop((left, top, left + side, top + side))

# 앱 아이콘: 1024x1024
icon = sq.resize((1024, 1024), Image.LANCZOS)
icon.save(ICON_OUT)
print("icon ->", ICON_OUT)

# 렌더러 로고: 256x256
logo = sq.resize((256, 256), Image.LANCZOS)
logo.save(LOGO_OUT)
print("logo ->", LOGO_OUT)
