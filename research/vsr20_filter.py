# ============================================================
# vsr20_filter.py — DÙNG VSR 20-20 LÀM BỘ LỌC
#
# Câu hỏi: VSR 20-20 có phân tách lệnh THẮNG (hit +2%) vs THUA không?
# Phân tích: vị trí entry so với zone VSR 20-20 (trên/trong/dưới)
# + kết hợp với các feature khác
# ============================================================
import sys, json, os, math
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
    return states, atr

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

def vsr_arrays(bars, length, threshold):
    nn = len(bars)
    uppers = np.full(nn, np.nan); lowers = np.full(nn, np.nan)
    prev_volume = prev_high = prev_low = prev_close = prev_stdev = np.nan
    vc = []; upper = lower = np.nan
    for i in range(nn):
        b = bars[i]
        change = 0.0 if (math.isnan(prev_volume) or prev_volume == 0) else b["volume"]/prev_volume - 1
        vc.append(change)
        if len(vc) > length: vc.pop(0)
        stdev = 0.0
        if len(vc) >= 2:
            m = sum(vc)/len(vc)
            stdev = math.sqrt(sum((x-m)**2 for x in vc)/len(vc))
        signal = 0.0
        if not math.isnan(prev_stdev) and prev_stdev != 0 and len(vc) >= 2:
            signal = abs(change/prev_stdev)
        if signal > threshold and not math.isnan(prev_high):
            p_upper = max(prev_high, prev_close); p_lower = min(prev_low, prev_close)
            is_overlap = (not math.isnan(upper)) and (p_lower <= upper and lower <= p_upper)
            if is_overlap:
                upper = max(upper, p_upper); lower = min(lower, p_lower)
            else:
                upper = p_upper; lower = p_lower
        uppers[i] = upper; lowers[i] = lower
        prev_volume = b["volume"]; prev_high = b["high"]; prev_low = b["low"]
        prev_close = b["close"]; prev_stdev = stdev
    return uppers, lowers

rows = []
for sym in ALL:
    bars = load(sym)
    if bars is None: continue
    nn = len(bars)
    slow_st, _ = _core(bars, 10, 55, 2, "vidya")
    fast_st, fast_atr = _core(bars, 10, 21, 4, "ema")
    us10, ls10 = vsr_arrays(bars, 10, 10)   # VSR 10-10 (tham chiếu)
    us20, ls20 = vsr_arrays(bars, 20, 20)   # VSR 20-20 (bộ lọc mới)
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
        mfe = 0.0
        for j in range(cs + 1, ex + 1):
            if S == 1:
                p = (bars[j]["high"] - entry) / entry * 100
            else:
                p = (entry - bars[j]["low"]) / entry * 100
            if p > mfe: mfe = p
        win = mfe >= 2.0
        # vị trí vs VSR 20-20
        def vsr_pos(u, l):
            if math.isnan(u): return 0
            if entry > u: return 1
            if entry < l: return -1
            return 0
        pos20 = vsr_pos(us20[cs], ls20[cs])
        pos10 = vsr_pos(us10[cs], ls10[cs])
        # khoảng cách entry tới zone 20-20
        if math.isnan(us20[cs]):
            dist20 = np.nan
        elif S == 1:
            dist20 = (entry - us20[cs]) / max(1e-9, fast_atr[cs]) if entry > us20[cs] else (entry - ls20[cs]) / max(1e-9, fast_atr[cs])
        else:
            dist20 = (ls20[cs] - entry) / max(1e-9, fast_atr[cs]) if entry < ls20[cs] else (us20[cs] - entry) / max(1e-9, fast_atr[cs])
        rows.append(dict(sym=sym, win=win, pos20=pos20, pos10=pos10, dist20=dist20,
                         mfe=mfe, S=S))

df = pd.DataFrame(rows)
print(f"TỔNG: {len(df)} | WIN (hit+2%): {df.win.mean()*100:.1f}% | THUA: {(~df.win).mean()*100:.1f}%")

print()
print("=" * 110)
print("1) VỊ TRÍ ENTRY SO VỚI VSR 20-20")
print("=" * 110)
for pos, lbl in [(1, "TRÊN zone 20-20"), (-1, "DƯỚI zone 20-20"), (0, "TRONG / không zone")]:
    sub = df[df.pos20 == pos]
    if len(sub) >= 20:
        print(f"  {lbl:24s} n={len(sub):5d} | WIN {sub.win.mean()*100:5.1f}% | THUA {(~sub.win).mean()*100:5.1f}%")

print()
print("=" * 110)
print("2) SO SÁNH VSR 10-10 vs VSR 20-20")
print("=" * 110)
for lbl, col in [("VSR 10-10", "pos10"), ("VSR 20-20", "pos20")]:
    print(f"  -- {lbl} --")
    for pos, lbl2 in [(1, "TRÊN zone"), (-1, "DƯỚI zone"), (0, "TRONG/không")]:
        sub = df[df[col] == pos]
        if len(sub) >= 20:
            print(f"    {lbl2:14s} n={len(sub):5d} | WIN {sub.win.mean()*100:5.1f}%")

print()
print("=" * 110)
print("3) LỌC THEO VỊ TRÍ VSR 20-20 (bỏ nhóm xấu)")
print("=" * 110)
base = df
print(f"  BASE:                     n={len(base):5d} | WIN {base.win.mean()*100:5.1f}% | THUA {len(base)-base.win.sum():4d}")
for mask, lbl in [
    (df.pos20 != 1, "BỎ entry TRÊN zone (mua đỉnh?)"),
    (df.pos20 != -1, "BỎ entry DƯỚI zone (bán đáy?)"),
    (df.pos20 != 0, "BỎ entry TRONG zone"),
    (df.pos20 == 0, "CHỈ entry TRONG zone"),
    (df.pos20 == -1, "CHỈ entry DƯỚI zone"),
    (df.pos20 == 1, "CHỈ entry TRÊN zone"),
]:
    sub = df[mask]
    if len(sub) >= 50:
        print(f"  {lbl:32s} n={len(sub):5d} | WIN {sub.win.mean()*100:5.1f}% | THUA {len(sub)-sub.win.sum():4d}")

print()
print("=" * 110)
print("4) THEO NHÓM VOLUME — VSR 20-20 (chỉ entry trong zone)")
print("=" * 110)
for grp, syms in GROUPS.items():
    sub = df[df.sym.isin(syms)]
    inz = sub[sub.pos20 == 0]
    if len(inz) >= 20:
        print(f"  {grp:4s} trong zone: n={len(inz):4d} WIN {inz.win.mean()*100:5.1f}% vs toàn nhóm {sub.win.mean()*100:5.1f}%")

print()
print("=" * 110)
print("5) KHOẢNG CÁCH TỚI ZONE 20-20 (dist20) vs WIN")
print("=" * 110)
s = df.dropna(subset=["dist20"])
for lo, hi, lbl in [(-100, 1, "entry trong/gần zone (<1 ATR)"), (1, 3, "cách 1-3 ATR"), (3, 100, "cách >3 ATR")]:
    sub = s[(s.dist20 > lo) & (s.dist20 <= hi)]
    if len(sub) >= 30:
        print(f"  {lbl:28s} n={len(sub):5d} | WIN {sub.win.mean()*100:5.1f}%")

print()
print("=" * 110)
print("6) KẾT HỢP: trong zone 20-20 + các lọc khác")
print("=" * 110)
z = df[df.pos20 == 0]
print(f"  trong zone 20-20:            n={len(z):5d} | WIN {z.win.mean()*100:5.1f}%")
z2 = df[(df.pos20 == 0) & (df.pos10 == 0)]
print(f"  trong CẢ 10-10 & 20-20:       n={len(z2):5d} | WIN {z2.win.mean()*100:5.1f}%")
z3 = df[df.pos20 != 0]
print(f"  NGOÀI zone 20-20:             n={len(z3):5d} | WIN {z3.win.mean()*100:5.1f}%")
