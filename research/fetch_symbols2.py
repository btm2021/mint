# ============================================================
# fetch_symbols2.py — chọn lại: symbol có LỊCH SỬ ĐẦY ĐỦ (>=100k nến)
# trong mỗi nhóm volume (TOP/MID/LOW)
# ============================================================
import json, os, sys, time
import requests

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

os.makedirs("research/cache", exist_ok=True)

r = requests.get("https://fapi.binance.com/fapi/v1/ticker/24hr", timeout=30)
usdt = [t for t in r.json() if t["symbol"].endswith("USDT") and float(t["quoteVolume"]) > 1e6]
usdt.sort(key=lambda t: float(t["quoteVolume"]), reverse=True)

# loại các symbol crypto chính có thể bị trùng (BTC/ETH đã có rồi thì vẫn dùng)
print("Hạng volume TOP 20:")
for i, t in enumerate(usdt[:20]):
    print(f"  #{i+1} {t['symbol']:14s} ${float(t['quoteVolume'])/1e6:8.1f}M")

def has_history(symbol, need=100000):
    """kiểm tra nhanh: fetch 1 batch cuối xem bar đầu tiên có đủ cũ không"""
    url = f"https://fapi.binance.com/fapi/v1/klines?symbol={symbol}&interval=15m&limit=1500"
    r = requests.get(url, timeout=30)
    batch = r.json()
    if not batch:
        return 0
    first = batch[0][0]
    # 100k nến 15m ~ 1050 ngày
    age_days = (int(time.time()*1000) - first) / 86400000
    est_bars = int(age_days * 96)
    return est_bars

# duyệt từng nhóm, chọn symbol đầu tiên có >= 100k nến
def pick_from(ranks, label, need=100000):
    for idx in ranks:
        if idx >= len(usdt):
            continue
        sym = usdt[idx]["symbol"]
        est = has_history(sym)
        print(f"  thử {sym} (hạng {idx+1}) ước {est} nến...")
        if est >= need:
            return sym
    return None

top_sel = pick_from(range(0, 15), "TOP")
mid_sel = pick_from(range(90, 150), "MID")
low_sel = pick_from(range(280, 400), "LOW")
print(f"\nChọn cuối: TOP={top_sel} MID={mid_sel} LOW={low_sel}")
NEW = [top_sel, mid_sel, low_sel]

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
    if not sym:
        continue
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
    print(f"  {sym:12s} {len(out):7d} nến")
    time.sleep(0.15)
print("Done.")
