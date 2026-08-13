# ============================================================
# verify_max_pnl.py — LÝ THUYẾT "MAX PNL" (không SL)
#
# Rule: entry khi fast ATRBot flip CÙNG bias.
#       Trong khoảng từ entry → bias đảo (exit khi bias flip),
#       nếu giá từng đi theo hướng entry > T% (high/low chạm)
#       → tính WIN (bất kể kết thúc âm hay dương).
#       Không có SL — chỉ quan tâm "có từng chạm +T% hay không".
#
# BIAS  : VIDYA 55 / ATR 10 / mult 2
# ENTRY : EMA 21 / ATR 10 / mult 4
# ============================================================
import sys, json
import numpy as np
import pandas as pd

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

DATA = "research/cache/imxusdt_15m.json"
OOS_MS = 1735689600 * 1000

bars = []
for a in json.load(open(DATA)):
    bars.append(dict(time=a[0], open=a[1], high=a[2], low=a[3], close=a[4], volume=a[5]))
n = len(bars)
print(f"IMXUSDT 15m: {n} nến")

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

slow_st, _ = _core(bars, 10, 55, 2, "vidya")
fast_st, _ = _core(bars, 10, 21, 4, "ema")
slow_cyc = cycles_of(slow_st)
fast_cyc = cycles_of(fast_st)
slow_cycle_idx = np.zeros(n, dtype=int)
for ci, c in enumerate(slow_cyc):
    slow_cycle_idx[c["start"]:c["end"]+1] = ci

# ---------------- tính MAX PNL tới bias đảo ----------------
rows = []
for c in range(len(fast_cyc) - 1):
    cy = fast_cyc[c]
    cs, ce, S = cy["start"], cy["end"], cy["s"]
    if ce - cs < 1: continue
    bias_agree = (slow_st[cs] == S)
    sc = slow_cyc[slow_cycle_idx[cs]]
    exit_idx = min(sc["end"], n - 1)
    if exit_idx <= cs: continue
    entry_price = bars[cs]["close"]
    max_pnl = 0.0
    reach_bar = -1
    for j in range(cs, exit_idx + 1):
        if S == 1:
            p = (bars[j]["high"] - entry_price) / entry_price * 100
        else:
            p = (entry_price - bars[j]["low"]) / entry_price * 100
        if p > max_pnl:
            max_pnl = p
            reach_bar = j - cs
    # từng chạm ngưỡng nào
    hits = {}
    for T in [0.5, 1.0, 2.0, 3.0, 5.0]:
        hits[f"hit_{T}"] = max_pnl >= T
    rows.append(dict(t=bars[cs]["time"], cs=cs, S=S, bias_agree=bias_agree,
                     max_pnl=max_pnl, reach_bar=reach_bar,
                     hold=exit_idx - cs, **hits))

df = pd.DataFrame(rows)
df["win2"] = df.max_pnl >= 2.0
print(f"\nENTRIES (cùng bias): {df.bias_agree.sum()} | (ngược bias): {(~df.bias_agree).sum()}")

print()
print("=" * 110)
print("A) MAX PNL — TỶ LỆ TỪNG CHẠM +T% TRƯỚC KHI BIAS ĐẢO (entry CÙNG bias)")
print("=" * 110)
sub = df[df.bias_agree]
for T in [0.5, 1.0, 2.0, 3.0, 5.0]:
    col = f"hit_{T}"
    print(f"  Chạm +{T}% : {sub[col].mean()*100:5.1f}% lệnh")

print()
print("=" * 110)
print("B) PHÂN PHỐI MAX PNL (cùng bias)")
print("=" * 110)
s = sub.max_pnl
print(f"  TB {s.mean():+.2f}% | median {s.median():+.2f}% | P25 {s.quantile(0.25):+.2f}% | "
      f"P75 {s.quantile(0.75):+.2f}% | P90 {s.quantile(0.9):+.2f}% | max {s.max():+.1f}%")
bins = pd.cut(s, [-0.01, 0.5, 1, 2, 3, 5, 10, 100], labels=["0-0.5", "0.5-1", "1-2", "2-3", "3-5", "5-10", ">10"])
g = sub.groupby(bins, observed=True).size()
print(g.to_string())

print()
print("=" * 110)
print("C) SO SÁNH CÙNG vs NGƯỢC bias")
print("=" * 110)
for lbl, mask in [("CÙNG bias", df.bias_agree), ("NGƯỢC bias", ~df.bias_agree)]:
    s2 = df[mask]
    print(f"  {lbl:12s} n={len(s2):5d} | max PnL TB {s2.max_pnl.mean():+6.2f}% | "
          f"hit2% {s2['hit_2.0'].mean()*100:5.1f}% | hit1% {s2['hit_1.0'].mean()*100:5.1f}% | hit0.5% {s2['hit_0.5'].mean()*100:5.1f}%")

print()
print("=" * 110)
print("D) THỜI GIAN TỚI MAX (reach_bar) — win nhanh hay chậm?")
print("=" * 110)
s = sub[sub["hit_2.0"]]
print(f"  Lệnh đạt +2%: n={len(s)} | reach TB {s.reach_bar.mean():.0f} nến | median {s.reach_bar.median():.0f} | P90 {s.reach_bar.quantile(0.9):.0f}")
for lo, hi, lbl in [(0, 20, "đạt trong <=20 nến"), (20, 100, "20-100"), (100, 500, "100-500"), (500, 10**9, ">500")]:
    s2 = sub[(sub.reach_bar > lo) & (sub.reach_bar <= hi)]
    print(f"    {lbl:22s} n={len(s2):5d} ({len(s2)/len(sub)*100:5.1f}% lệnh win)")

print()
print("=" * 110)
print("E) OOS ổn định? (hit 2%)")
print("=" * 110)
for lbl, mask in [("IS 2022-2024", sub.t < OOS_MS), ("OOS 2025+", sub.t >= OOS_MS)]:
    s2 = sub[mask]
    print(f"  {lbl:12s} n={len(s2):5d} | hit2% {s2['hit_2.0'].mean()*100:5.1f}% | hit1% {s2['hit_1.0'].mean()*100:5.1f}% | maxPnL TB {s2.max_pnl.mean():+.2f}%")

print()
print("=" * 110)
print("F) ĐIỀU GÌ XẢY RA VỚI LỆNH 'THUA' (không chạm +2%)?")
print("=" * 110)
losers = sub[~sub["hit_2.0"]]
print(f"  n={len(losers)} | max PnL TB {losers.max_pnl.mean():+.3f}% | "
      f"max <1%: {(losers.max_pnl < 1).mean()*100:.1f}% | max <0.5%: {(losers.max_pnl < 0.5).mean()*100:.1f}%")
print(f"  → % lệnh thua mà bias ĐẢO RẤT NHANH (hold <30 nến): {(losers.hold < 30).mean()*100:.1f}%")
