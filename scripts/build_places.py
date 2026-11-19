"""
Builds public/data/places.json from GeoNames cities15000 (CC BY 4.0, https://www.geonames.org/):
every populated place with more than 15 000 inhabitants, as [name, countryCode, lat, lon, population, elevation].
"""
import io
import json
import os
import subprocess
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'data-raw', 'cities15000.zip')
if not os.path.exists(RAW):
    subprocess.run(['curl', '-sSL', '--max-time', '300', '-o', RAW, 'https://download.geonames.org/export/dump/cities15000.zip'], check=True)
with zipfile.ZipFile(RAW) as z:
    text = z.read('cities15000.txt').decode('utf8')
rows = []
for line in text.splitlines():
    p = line.split('\t')
    if len(p) < 19:
        continue
    name, lat, lon, cc, pop = p[1], float(p[4]), float(p[5]), p[8], int(p[14] or 0)
    elev = p[15] or p[16]
    rows.append([name, cc, round(lat, 4), round(lon, 4), pop, int(elev) if elev and elev.lstrip('-').isdigit() else None])
rows.sort(key=lambda r: -r[4])
out = os.path.join(ROOT, 'public', 'data', 'places.json')
with open(out, 'w', encoding='utf8') as f:
    json.dump(rows, f, ensure_ascii=False, separators=(',', ':'))
print(len(rows), 'places', os.path.getsize(out) // 1024, 'KB')
