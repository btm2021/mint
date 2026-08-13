import json, sys, time, requests
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
r = requests.get("https://fapi.binance.com/fapi/v1/ticker/24hr", timeout=30)
usdt = [t for t in r.json() if t["symbol"].endswith("USDT") and float(t["quoteVolume"]) > 1e6]
usdt.sort(key=lambda t: float(t["quoteVolume"]), reverse=True)

def first_bar_time(symbol):
    try:
        b = requests.get(f"https://fapi.binance.com/fapi/v1/klines?symbol={symbol}&interval=15m&limit=1&startTime=0", timeout=30).json()
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
            print(f"CHON {sym} hang {idx+1} est {est}")
            return sym
    return None

print(json.dumps({
    "top": pick([16, 17, 18, 20, 25]),
    "mid": pick([92, 100, 107, 112, 118]),
    "low": pick([283, 305, 315, 325, 335, 345, 355, 365, 375]),
}))
