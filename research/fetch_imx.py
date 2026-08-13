# ============================================================
# fetch_imx.py — fetch IMXUSDT 15m klines từ Binance Futures
# Lưu: research/cache/imxusdt_15m.json (list [time, open, high, low, close, volume])
# ============================================================
import json, os, sys, time
import requests

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SYMBOL = "IMXUSDT"
INTERVAL = "15m"
OUT = "research/cache/imxusdt_15m.json"
os.makedirs("research/cache", exist_ok=True)

# load cache cũ nếu có
existing = {}
if os.path.exists(OUT):
    for a in json.load(open(OUT)):
        existing[a[0]] = a

def fetch(start=None, end=None):
    url = f"https://fapi.binance.com/fapi/v1/klines?symbol={SYMBOL}&interval={INTERVAL}&limit=1500"
    if start: url += f"&startTime={start}"
    if end: url += f"&endTime={end}"
    r = requests.get(url, timeout=30)
    if r.status_code != 200:
        print("HTTP", r.status_code, r.text[:200])
        return []
    return r.json()

# fetch từ đầu (listing ~2022-02) tới giờ
all_rows = []
end_time = int(time.time() * 1000)
first_time = 1643500800000  # 2022-01-30
while True:
    batch = fetch(end=end_time - 1)
    if not batch:
        break
    new = [b for b in batch if b[0] < end_time]
    if not new:
        break
    all_rows = new + all_rows
    end_time = int(new[0][0])
    print(f"  fetched till {end_time}, total {len(all_rows)}")
    if end_time <= first_time:
        break
    time.sleep(0.15)

for b in all_rows:
    existing[b[0]] = [int(b[0]), float(b[1]), float(b[2]), float(b[3]), float(b[4]), float(b[5])]

rows = sorted(existing.values(), key=lambda x: x[0])
json.dump(rows, open(OUT, "w"))
print(f"Saved {len(rows)} bars → {OUT}")
print(f"Range: {rows[0][0]} → {rows[-1][0]}")
