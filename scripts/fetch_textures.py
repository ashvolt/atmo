"""
Downloads planet textures (Solar System Scope, CC BY 4.0, https://www.solarsystemscope.com/textures/)
into public/textures, converting TIFF maps to browser formats.
"""
import os
import subprocess

from PIL import Image

Image.MAX_IMAGE_PIXELS = None
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'textures')
RAW = os.path.join(ROOT, 'data-raw', 'textures')
BASE = 'https://www.solarsystemscope.com/textures/download/'

# (remote file, local name, max width, output format)
FILES = [
    ('8k_earth_daymap.jpg', 'earth_day.jpg', 8192, 'JPEG'),
    ('8k_earth_nightmap.jpg', 'earth_night.jpg', 8192, 'JPEG'),
    ('8k_earth_clouds.jpg', 'earth_clouds.jpg', 4096, 'JPEG'),
    ('8k_earth_normal_map.tif', 'earth_normal.jpg', 8192, 'JPEG'),
    ('8k_earth_specular_map.tif', 'earth_specular.jpg', 4096, 'JPEG'),
    ('8k_moon.jpg', 'moon.jpg', 4096, 'JPEG'),
    ('8k_mars.jpg', 'mars.jpg', 4096, 'JPEG'),
    ('8k_jupiter.jpg', 'jupiter.jpg', 8192, 'JPEG'),
    ('8k_stars_milky_way.jpg', 'stars.jpg', 8192, 'JPEG'),
]

os.makedirs(OUT, exist_ok=True)
os.makedirs(RAW, exist_ok=True)
for remote, local, width, fmt in FILES:
    raw = os.path.join(RAW, remote)
    if not os.path.exists(raw):
        print('downloading', remote)
        subprocess.run(['curl', '-sSL', '--retry', '3', '--max-time', '600', '-o', raw, BASE + remote], check=True)
    img = Image.open(raw)
    if local == 'earth_clouds.jpg' or local == 'earth_specular.jpg':
        img = img.convert('L')  # single-channel maps
    elif img.mode not in ('RGB', 'L'):
        img = img.convert('RGB')
    if img.width > width:
        img = img.resize((width, width // 2), Image.LANCZOS)
    dst = os.path.join(OUT, local)
    img.save(dst, fmt, quality=90, optimize=True)
    print(local, img.size, os.path.getsize(dst) // 1024, 'KB')
