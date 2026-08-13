# ============================================================
# verify_hit2.py — ĐƠN GIẢN: % lệnh cùng bias từng chạm +2%
# Entry: fast flip CÙNG bias → trong thời gian bias giữ,
#        giá có từng đi +2% theo hướng lệnh không?
# ============================================================
import sys, json, os
import numpy as np

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

CACHE = "research/cache"
GROUPS = {
    "TOP": ["BTCUSDT", "SOLUSDT", "DOGEUSDT"],
    "MID": ["IMXUSDT", "LTCUSDT", "1000SHIBUSDT", "ETCUSDT"],
    "LOW": ["SUSHIUSDT", "ARUSDT", "MAVUSDT"],
}
ALL = GROUPS["TOP"] + GROUPS["MID"] + GROUPS["LOW"]

def load(sym):
    f = f"{CACHE}/{sym.lower()}_15m.json"
    if not os.path.exists(f):
        return None
    raw = json.load(open(f))
    return [dict(time=a[0], open=a[1], high=a[2], low=a[3], close=a[4], volume=a[5]) for a in raw]

def _core(bars, atrLen, maLen, mult, maType):
    nn = len(bars)
    close = np.array([b["close"] for b in bars])
    high = np.array([b["high"] for b in bars])
    low = np.array([b["low"] for b in bars])
    atr = np.zeros(nn); tr = np.zeros(nn)
    tr[0] = high[0] - low[0]
    for i in range(1, nn):
        tr[i] = max(high[i]-low[i], abs(high[i]-close[i-1]), abs(low[i]-close[i-1]))
    atr[0] = tr[0]
    for i in range(1, nn):
        atr[i] = (atr[i-1]*(atrLen-1)+tr[i])/atrLen
    trail1 = np.zeros(nn)
    alpha = 2/(maLen+1)
    if maType == "vidya":
        trail1[0] = close[0]
        for i in range(1, nn):
            j0 = max(1, i-maLen+1)
            gains = 0.0; losses = 0.0
            for j in range(j0, i+1):
                ch = close[j]-close[j-1]
                if ch > 0: gains += ch
                else: losses -= ch
            movement = gains+losses
            cmo = abs(gains-losses)/movement if movement != 0 else 0.0
            trail1[i] = alpha*cmo*close[i] + (1-alpha*cmo)*trail1[i-1]
    else:
        trail1[0] = close[0]
        for i in range(1, nn):
            trail1[i] = alpha*close[i] + (1-alpha)*trail1[i-1]
    trail2 = np.zeros(nn); states = np.zeros(nn, dtype=int)
    for i in range(nn):
        loss = atr[i]*mult
        t1 = trail1[i]
        if i == 0:
            prevT2 = 0.0; prevT1 = t1
        else:
            prevT2 = trail2[i-1]; prevT1 = trail1[i-1]
        if t1 > prevT2:
            trail2[i] = max(prevT2, t1-loss) if prevT1 > prevT2 else t1-loss
        else:
            trail2[i] = min(prevT2, t1+loss) if (t1 < prevT2 and prevT1 < prevT2) else t1+loss
        states[i] = 1 if t1 > trail2[i] else -1
    return states

def cycles_of(states):
    cyc = []
    cur = dict(s=states[0], start=0, end=0)
    for i in range(1, len(states)):
        if states[i] != cur["s"]:
            cur["end"] = i-1; cyc.append(cur)
            cur = dict(s=states[i], start=i, end=i)
        else:
            cur["end"] = i
    cyc.append(cur)
    return cyc

rows = []
for sym in ALL:
    bars = load(sym)
    if bars is None: continue
    nn = len(bars)
    slow_st = _core(bars, 10, 55, 2, "vidya")
    fast_st = _core(bars, 10, 21, 4, "ema")
    slow_cyc = cycles_of(slow_st)
    fast_cyc = cycles_of(fast_st)
    slow_cycle_idx = np.zeros(nn, dtype=int)
    for ci, c in enumerate(slow_cyc):
        slow_cycle_idx[c["start"]:c["end"]+1] = ci
    for c in range(len(fast_cyc) - 1):
        cy = fast_cyc[c]
        cs, ce, S = cy["start"], cy["end"], cy["s"]
        if ce - cs < 1: continue
        if slow_st[cs] != S: continue
        sc = slow_cyc[slow_cycle_idx[cs]]
        ex = min(sc["end"], nn - 1)
        if ex <= cs: continue
        entry = bars[cs]["close"]
        hit = False
        for j in range(cs + 1, ex + 1):
            if S == 1:
                if (bars[j]["high"] - entry) / entry * 100 >= 2.0:
                    hit = True; break
            else:
                if (entry - bars[j]["low"]) / entry * 100 >= 2.0:
                    hit = True; break
        rows.append(dict(sym=sym, hit=hit))

import collections
n = len(rows)
hits = sum(1 for r in rows if r["hit"])
print(f"TỔNG: {n} lệnh cùng bias | ĐẠT +2%: {hits} lệnh = {hits/n*100:.1f}%")
print()
print("Theo nhóm:")
for grp, syms in GROUPS.items():
    sub = [r for r in rows if r["sym"] in syms]
    h = sum(1 for r in sub if r["hit"])
    print(f"  {grp:4s}: {len(sub):4d} lệnh | đạt +2%: {h:4d} = {h/len(sub)*100:.1f}%")
print()
print("Theo symbol:")
for sym in ALL:
    sub = [r for r in rows if r["sym"] == sym]
    h = sum(1 for r in sub if r["hit"])
    print(f"  {sym:12s}: {len(sub):4d} lệnh | đạt +2%: {h:4d} = {h/len(sub)*100:.1f}%")
