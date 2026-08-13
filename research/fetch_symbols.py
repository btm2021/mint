# ============================================================
# fetch_symbols.py — phân hạng volume + fetch 9 symbol mới
# Chia: 3 lớn / 3 trung / 3 nhỏ (theo 24h quote volume)
# ============================================================
import json, os, sys, time
import requests

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

os.makedirs("research/cache", exist_ok=True)

# ---- 1) lấy 24h tickers để phân hạng volume ----
r = requests.get("https://fapi.binance.com/fapi/v1/ticker/24hr", timeout=30)
tickers = r.json()
usdt = [t for t in tickers if t["symbol"].endswith("USDT") and t["quoteVolume"] != "0"]
usdt.sort(key=lambda t: float(t["quoteVolume"]), reverse=True)
print(f"Symbols USDT-M: {len(usdt)}")

# loại symbol có volume cực nhỏ (dưới hạng 300) để tránh nhiễu
valid = [t for t in usdt if float(t["quoteVolume"]) >= 1e6]
print(f"Hợp lệ (24h vol >= $1M): {len(valid)}")
for i, t in enumerate(valid[:15]):
    print(f"  #{i+1} {t['symbol']:12s} vol24h ${float(t['quoteVolume'])/1e9:8.2f}B")

# ---- 2) chọn 9 symbol: 3 lớn / 3 trung / 3 nhỏ ----
top3 = [t["symbol"] for t in valid[0:3]]          # BTC ETH BNB (lớn nhất)
mid3 = [t["symbol"] for t in valid[95:98]]        # hạng ~96-98
low3 = [t["symbol"] for t in valid[290:293]]      # hạng ~291-293
NEW = top3 + mid3 + low3
print(f"\nChọn: TOP {top3} | MID {mid3} | LOW {low3}")

# ---- 3) fetch OHLCV 15m mỗi symbol ----
INTERVAL = "15m"
def fetch_history(symbol, first_time=1643500800000):
    rows = []
    end_time = int(time.time() * 1000)
    while True:
        url = f"https://fapi.binance.com/fapi/v1/klines?symbol={symbol}&interval={INTERVAL}&limit=1500&endTime={end_time-1}"
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

for sym in NEW:
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

print("\nDone.")
