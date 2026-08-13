# ============================================================
# verify_bias_hold2.py — bổ sung:
#   - Sửa OOS (timestamp ms)
#   - PnL sau N nến ngắn (5/10/20/50/100) — "đoạn ngắn tiếp theo"
#   - Phân tích per-entry đầy đủ
# ============================================================
import sys, json
import numpy as np
import pandas as pd

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

DATA = "research/cache/imxusdt_15m.json"
OOS_MS = 1735689600 * 1000  # 2025-01-01 (ms)

bars = []
for a in json.load(open(DATA)):
    bars.append(dict(time=a[0], open=a[1], high=a[2], low=a[3], close=a[4], volume=a[5]))
n = len(bars)

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
    if len(states) == 0: return cyc
    cur = dict(s=states[0], start=0, end=0)
    for i in range(1, len(states)):
        if states[i] != cur["s"]:
            cur["end"] = i-1; cyc.append(cur)
            cur = dict(s=states[i], start=i, end=i)
        else:
            cur["end"] = i
    cyc.append(cur)
    return cyc

slow_st, slow_atr = _core(bars, 10, 55, 2, "vidya")
fast_st, fast_atr = _core(bars, 10, 21, 4, "ema")
slow_cyc = cycles_of(slow_st)
fast_cyc = cycles_of(fast_st)
slow_cycle_idx = np.zeros(n, dtype=int)
for ci, c in enumerate(slow_cyc):
    slow_cycle_idx[c["start"]:c["end"]+1] = ci

rows = []
for c in range(len(fast_cyc) - 1):
    cy = fast_cyc[c]
    cs, ce, S = cy["start"], cy["end"], cy["s"]
    if ce - cs < 1: continue
    if slow_st[cs] != S: continue
    sc = slow_cyc[slow_cycle_idx[cs]]
    entry_price = bars[cs]["close"]
    exit_idx = min(sc["end"], n - 1)
    if exit_idx <= cs: continue
    exit_price = bars[exit_idx]["close"]
    pnl_pct = S * (exit_price / entry_price - 1) * 100
    hold = exit_idx - cs
    # PnL sau N nến ngắn
    pnls_N = {}
    for N in [5, 10, 20, 50, 100]:
        j = min(cs + N, exit_idx)
        pnls_N[f"pnl_{N}"] = S * (bars[j]["close"] / entry_price - 1) * 100
    flips = 0
    for k in range(c + 1, len(fast_cyc)):
        if fast_cyc[k]["start"] <= exit_idx:
            flips += 1
        else:
            break
    rows.append(dict(t=bars[cs]["time"], cs=cs, S=S, pnl_pct=pnl_pct, hold=hold,
                     flips=flips, bias_left=sc["end"]-cs,
                     atr_pct=fast_atr[cs]/entry_price*100, **pnls_N))

df = pd.DataFrame(rows)
df["win"] = df.pnl_pct > 0
print(f"ENTRIES: {len(df)} | WIN tới bias đảo: {df.win.mean()*100:.1f}% | PnL TB {df.pnl_pct.mean():+.3f}%")

print()
print("=" * 110)
print("A) PnL SAU N NẾN NGẮN (câu hỏi: 'đoạn ngắn tiếp theo' có dương/hòa vốn?)")
print("=" * 110)
for N in [5, 10, 20, 50, 100]:
    col = f"pnl_{N}"
    w = (df[col] > 0).mean() * 100
    be = (df[col] >= 0).mean() * 100
    print(f"  Sau {N:3d} nến: WIN {w:5.1f}% | >=hòa vốn {be:5.1f}% | PnL TB {df[col].mean():+7.3f}% | "
          f"median {df[col].median():+7.3f}% | P25 {df[col].quantile(0.25):+7.3f}% | P75 {df[col].quantile(0.75):+7.3f}%")

print()
print("=" * 110)
print("B) NHIỄU (flips trong đoạn hold) vs PnL sau 20 nến & tới bias đảo")
print("=" * 110)
for lo, hi, lbl in [(0, 1, "ít nhiễu (0-1 flip)"), (2, 4, "nhiễu vừa (2-4)"), (5, 100, "nhiễu nặng (>=5)")]:
    sub = df[(df.flips > lo) & (df.flips <= hi)]
    if len(sub) >= 20:
        print(f"  {lbl:22s} n={len(sub):5d} | pnl20 {sub.pnl_20.mean():+7.3f}% | pnl50 {sub.pnl_50.mean():+7.3f}% | "
              f"pnl_bias_dao {sub.pnl_pct.mean():+7.3f}% | win20 {(sub.pnl_20>0).mean()*100:5.1f}%")

print()
print("=" * 110)
print("C) IS vs OOS")
print("=" * 110)
for lbl, mask in [("IS 2022-2024", df.t < OOS_MS), ("OOS 2025+", df.t >= OOS_MS)]:
    sub = df[mask]
    if len(sub) >= 20:
        print(f"  {lbl:12s} n={len(sub):5d} | pnl20 TB {sub.pnl_20.mean():+7.3f}% | win20 {(sub.pnl_20>0).mean()*100:5.1f}% | "
              f"pnl_bias_dao {sub.pnl_pct.mean():+7.3f}% | win_dao {sub.win.mean()*100:5.1f}%")

print()
print("=" * 110)
print("D) HOLD theo nhiễu — nhiễu có kéo dài hold?")
print("=" * 110)
for lo, hi, lbl in [(0, 1, "ít nhiễu"), (2, 4, "nhiễu vừa"), (5, 100, "nhiễu nặng")]:
    sub = df[(df.flips > lo) & (df.flips <= hi)]
    if len(sub) >= 20:
        print(f"  {lbl:14s} hold TB {sub.hold.mean():7.1f} | median {sub.hold.median():7.1f} | P90 {sub.hold.quantile(0.9):7.1f}")

print()
print("=" * 110)
print("E) PnL tích lũy khi giữ tới bias đảo (theo 3 tháng)")
print("=" * 110)
df["quarter"] = pd.to_datetime(df.t, unit="ms", utc=True).dt.to_period("Q")
g = df.groupby("quarter").agg(n=("win", "count"), win=("win", "mean"), pnl=("pnl_pct", "mean"), pnl20=("pnl_20", "mean"))
g["win"] = (g["win"]*100).round(1); g["pnl"] = g["pnl"].round(1); g["pnl20"] = g["pnl20"].round(2)
print(g.to_string())
