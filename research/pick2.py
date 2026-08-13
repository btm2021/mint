import json, sys, time
import requests
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

r = requests.get("https://fapi.binance.com/fapi/v1/ticker/24hr", timeout=30)
usdt = [t for t in r.json() if t["symbol"].endswith("USDT") and float(t["quoteVolume"]) > 1e6]
usdt.sort(key=lambda t: float(t["quoteVolume"]), reverse=True)

def first_bar_time(symbol):
    url = f"https://fapi.binance.com/fapi/v1/klines?symbol={symbol}&interval=15m&limit=1&startTime=0"
    try:
        b = requests.get(url, timeout=30).json()
        if b:
            return int(b[0][0])
    except Exception:
        pass
    return None

def pick(ranks):
    for idx in ranks:
        if idx >= len(usdt):
            continue
        sym = usdt[idx]["symbol"]
        first = first_bar_time(sym)
        if first is None:
            continue
        est = int(((time.time()*1000 - first)/86400000) * 96)
        if est >= 100000:
            print(f"  CHON {sym:14s} hạng {idx+1} ước {est} nến")
            return sym
        print(f"  bo   {sym:14s} hạng {idx+1} (chỉ {est} nến)")
    return None

top2 = pick([2, 4, 5, 10, 11, 13, 14])
mid2 = pick([95, 100, 105, 110, 115, 120, 125, 130, 135, 140, 145])
low2 = pick([285, 290, 295, 300, 310, 320, 330, 340, 350, 360, 370, 380, 390])
print(json.dumps({"top": top2, "mid": mid2, "low": low2}))
