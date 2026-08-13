# ============================================================
# fetch_symbols3.py — chọn lại bằng cách lấy nến ĐẦU TIÊN (startTime=0)
# ============================================================
import json, os, sys, time
import requests

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

os.makedirs("research/cache", exist_ok=True)

r = requests.get("https://fapi.binance.com/fapi/v1/ticker/24hr", timeout=30)
usdt = [t for t in r.json() if t["symbol"].endswith("USDT") and float(t["quoteVolume"]) > 1e6]
usdt.sort(key=lambda t: float(t["quoteVolume"]), reverse=True)

def first_bar_time(symbol):
    """lấy thời điểm niêm yết (bar đầu tiên)"""
    url = f"https://fapi.binance.com/fapi/v1/klines?symbol={symbol}&interval=15m&limit=1&startTime=0"
    try:
        r = requests.get(url, timeout=30)
        batch = r.json()
        if batch:
            return int(batch[0][0])
    except Exception as e:
        print(f"  err {symbol}: {e}")
    return None

def pick_from(ranks, label, min_bars=100000):
    for idx in ranks:
        if idx >= len(usdt):
            continue
        sym = usdt[idx]["symbol"]
        first = first_bar_time(sym)
        if first is None:
            continue
        age_days = (int(time.time()*1000) - first) / 86400000
        est = int(age_days * 96)
        flag = "✔" if est >= min_bars else "✘"
        print(f"  {flag} {sym:14s} hạng {idx+1:3d} listing {(first/1000):.0f} ước {est:6d} nến")
        if est >= min_bars:
            return sym
    return None

print("=== TOP (hạng 1-15) ===")
top_sel = pick_from(range(0, 15), "TOP")
print("=== MID (hạng 90-150) ===")
mid_sel = pick_from(range(90, 150), "MID")
print("=== LOW (hạng 280-400) ===")
low_sel = pick_from(range(280, 400), "LOW")
print(f"\nChọn: TOP={top_sel} MID={mid_sel} LOW={low_sel}")

NEW = [s for s in [top_sel, mid_sel, low_sel] if s]

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
    print(f"  {sym:12s} {len(out):7d} nến")
    time.sleep(0.15)
print("Done.")
