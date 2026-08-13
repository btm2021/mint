# fetch 6 symbol còn lại
import json, os, sys, time
import requests
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

os.makedirs("research/cache", exist_ok=True)
SYMBOLS = ["SOLUSDT", "DOGEUSDT", "1000SHIBUSDT", "ETCUSDT", "ARUSDT", "MAVUSDT"]

def fetch_history(symbol, first_time=1643500800000):
    rows = []
    end_time = int(time.time() * 1000)
    while True:
        url = f"https://fapi.binance.com/fapi/v1/klines?symbol={symbol}&interval=15m&limit=1500&endTime={end_time-1}"
        r = requests.get(url, timeout=30)
        batch = r.json()
        if not batch:
            break
        new = [b for b in batch if b[0] < end_time]
        if not new:
            break
        rows = new + rows
        end_time = int(new[0][0])
        if end_time <= first_time:
            break
        time.sleep(0.12)
    return rows

for sym in SYMBOLS:
    fname = f"research/cache/{sym.lower()}_15m.json"
    existing = {}
    if os.path.exists(fname):
        for a in json.load(open(fname)):
            existing[a[0]] = a
    rows = fetch_history(sym)
    for b in rows:
        existing[b[0]] = [int(b[0]), float(b[1]), float(b[2]), float(b[3]), float(b[4]), float(b[5])]
    out = sorted(existing.values(), key=lambda x: x[0])
    json.dump(out, open(fname, "w"))
    print(f"  {sym:12s} {len(out):7d} nến  {out[0][0]} → {out[-1][0]}")
    time.sleep(0.15)
print("Done.")
