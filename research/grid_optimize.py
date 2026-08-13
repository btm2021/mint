# ============================================================
# grid_optimize.py — TÌM CẤU HÌNH TỐI ƯU
#
# BIAS  : EMA, length {55,89,100,200}, mult {2,3}
# ENTRY : {EMA, VIDYA}, length {14,21,34,55}, mult {2,3,4}
# ATR   : 10 (cả 2)
# VSR   : 10-10
#
# Đo trên 10 symbol:
#   N          : số lệnh cùng bias
#   HIT+2%     : % từng chạm +2% trước khi bias đảo
#   PNL_BIAS   : PnL TB/lệnh giữ tới bias đảo
# ============================================================
import sys, json, os
import numpy as np
import pandas as pd

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

CACHE = "research/cache"
GROUPS = {
    "TOP": ["BTCUSDT", "SOLUSDT", "DOGEUSDT"],
    "MID": ["IMXUSDT", "LTCUSDT", "1000SHIBUSDT", "ETCUSDT"],
    "LOW": ["SUSHIUSDT", "ARUSDT", "MAVUSDT"],
}
ALL = GROUPS["TOP"] + GROUPS["MID"] + GROUPS["LOW"]
HORIZON = 2500  # số nến tối đa quét tìm +2%

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

# ---------- BIAS cores (EMA) ----------
BIAS_LEN = [55, 89, 100, 200]
BIAS_MULT = [2, 3]
ENTRY_TYPES = ["ema", "vidya"]
ENTRY_LEN = [14, 21, 34, 55]
ENTRY_MULT = [2, 3, 4]

agg = {}  # (bias_len, bias_mult, etype, elen, emult) -> [n, hits, pnl_sum]

for sym in ALL:
    bars = load(sym)
    if bars is None: continue
    nn = len(bars)
    close = np.array([b["close"] for b in bars])
    high = np.array([b["high"] for b in bars])
    low = np.array([b["low"] for b in bars])

    # slow cores
    slow_map = {}
    for bl in BIAS_LEN:
        for bm in BIAS_MULT:
            st = _core(bars, 10, bl, bm, "ema")
            cyc = cycles_of(st)
            cidx = np.zeros(nn, dtype=int)
            for ci, c in enumerate(cyc):
                cidx[c["start"]:c["end"]+1] = ci
            slow_map[(bl, bm)] = (st, cyc, cidx)

    # fast cores + cache hit_bar per signal
    fast_map = {}
    for et in ENTRY_TYPES:
        for el in ENTRY_LEN:
            for em in ENTRY_MULT:
                st = _core(bars, 10, el, em, et)
                cyc = cycles_of(st)
                # signals: (cs, S, hit_bar hoặc None)
                sigs = []
                for c in range(len(cyc) - 1):
                    cy = cyc[c]
                    cs, S = cy["start"], cy["s"]
                    if cy["end"] - cs < 1: continue
                    entry = close[cs]
                    hit_bar = None
                    if S == 1:
                        thr = entry * 1.02
                        for j in range(cs + 1, min(cs + HORIZON, nn)):
                            if high[j] >= thr: hit_bar = j - cs; break
                    else:
                        thr = entry * 0.98
                        for j in range(cs + 1, min(cs + HORIZON, nn)):
                            if low[j] <= thr: hit_bar = j - cs; break
                    sigs.append((cs, S, hit_bar))
                fast_map[(et, el, em)] = (st, cyc, sigs)

    # combine
    for (bl, bm), (bst, bcyc, bidx) in slow_map.items():
        for (et, el, em), (fst, fcyc, sigs) in fast_map.items():
            key = (bl, bm, et, el, em)
            if key not in agg:
                agg[key] = [0, 0, 0.0]
            for cs, S, hit_bar in sigs:
                if bst[cs] != S: continue
                sc = bcyc[bidx[cs]]
                bend = min(sc["end"], nn - 1)
                if bend <= cs: continue
                agg[key][0] += 1
                if hit_bar is not None and hit_bar <= (bend - cs):
                    agg[key][1] += 1
                agg[key][2] += S * (close[bend] / close[cs] - 1) * 100

rows = []
for (bl, bm, et, el, em), (n, hits, pnl) in agg.items():
    if n < 300: continue
    rows.append(dict(bias_len=bl, bias_mult=bm, entry_type=et, entry_len=el, entry_mult=em,
                     n=n, hit=hits/n*100, pnl=pnl/n, total=pnl))
res = pd.DataFrame(rows)
res.to_csv("research/output_grid.csv", index=False)

print(f"Tổng cấu hình hợp lệ (n>=300): {len(res)}")
print()
print("=" * 120)
print("TOP 15 — theo PnL TB/lệnh (giữ tới bias đảo)")
print("=" * 120)
top = res.sort_values("pnl", ascending=False).head(15)
for _, r in top.iterrows():
    print(f"  BIAS EMA {r.bias_len:3d}/m{r.bias_mult} | ENTRY {r.entry_type:5s} {int(r.entry_len):2d}/m{r.entry_mult} | "
          f"n={int(r.n):5d} | Hit {r.hit:5.1f}% | PnL {r.pnl:+6.3f}% | Tổng {r.total:+8.0f}%")

print()
print("=" * 120)
print("TOP 15 — theo HIT+2%")
print("=" * 120)
top2 = res.sort_values("hit", ascending=False).head(15)
for _, r in top2.iterrows():
    print(f"  BIAS EMA {r.bias_len:3d}/m{r.bias_mult} | ENTRY {r.entry_type:5s} {int(r.entry_len):2d}/m{r.entry_mult} | "
          f"n={int(r.n):5d} | Hit {r.hit:5.1f}% | PnL {r.pnl:+6.3f}% | Tổng {r.total:+8.0f}%")

print()
print("=" * 120)
print("BẢNG TỔNG — BIAS EMA × ENTRY (PnL TB)")
print("=" * 120)
print(f"{'Bias':>8} | {'Entry':>18} | {'n':>5} {'Hit':>6} {'PnL':>7}")
piv = res.copy()
piv["bias_lbl"] = piv.apply(lambda r: f"L{r.bias_len}/m{r.bias_mult}", axis=1)
piv["entry_lbl"] = piv.apply(lambda r: f"{r.entry_type.upper()}{int(r.entry_len)}/m{r.entry_mult}", axis=1)
piv = piv.pivot(index="bias_lbl", columns="entry_lbl", values="pnl")
print(piv.round(3).to_string())
