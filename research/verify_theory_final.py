# ============================================================
# verify_theory_final.py — KIỂM CHỨNG LẠI LÝ THUYẾT (đầy đủ)
#
# Lý thuyết:
#   1. Entry fast flip CÙNG bias → giá từng chạm +2% trước khi bias đảo = 82.6%
#   2. Không cần SL — chỉ chờ TP (median 2.4 ngày)
#   3. Cùng bias = biên độ (×3.2), không phải hit-rate
#   4. Thực thi: TP 2% + SL = bias đảo
#
# Bổ sung lần này (các yếu tố trước chưa kiểm):
#   A. MAE — giá đi NGƯỢC sâu bao nhiêu trước khi chạm TP? (quyết định "no SL" khả thi không)
#   B. Lệnh thua khi bias đảo: lỗ thực tế bao nhiêu?
#   C. PnL thực tế nếu TP2% + SL bias-đảo (mô phỏng đầy đủ)
#   D. Loại trùng: nhiều entry trong cùng 1 bias cycle (tương quan)
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

# ---------------- mô phỏng đầy đủ: TP2% / SL = bias đảo ----------------
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
    tp = entry_price * 1.02 if S == 1 else entry_price * 0.98
    # MAE trước khi chạm TP (hoặc tới bias đảo nếu không chạm)
    mae = 0.0; hit_tp = False; tp_bar = -1; mae_before_tp = 0.0
    for j in range(cs + 1, exit_idx + 1):
        if S == 1:
            if bars[j]["high"] >= tp and not hit_tp:
                hit_tp = True; tp_bar = j - cs
            adverse = (entry_price - bars[j]["low"]) / entry_price * 100
        else:
            if bars[j]["low"] <= tp and not hit_tp:
                hit_tp = True; tp_bar = j - cs
            adverse = (bars[j]["high"] - entry_price) / entry_price * 100
        if not hit_tp:
            mae = max(mae, adverse)   # MAE chỉ tính TRƯỚC khi chạm TP
    final_pnl = S * (bars[exit_idx]["close"] / entry_price - 1) * 100
    rows.append(dict(t=bars[cs]["time"], cs=cs, S=S, bias_agree=bias_agree,
                     hit_tp=hit_tp, tp_bar=tp_bar, mae=mae,
                     final_pnl=final_pnl, hold=exit_idx - cs,
                     slow_cycle_no=slow_cycle_idx[cs]))

df = pd.DataFrame(rows)
sub = df[df.bias_agree].copy()
print(f"ENTRIES cùng bias: {len(sub)}")

print()
print("=" * 110)
print("1) XÁC NHẬN LẠI: hit TP 2% trước khi bias đảo")
print("=" * 110)
print(f"  Hit TP2%: {sub.hit_tp.mean()*100:.1f}% (lý thuyết nói 82.6%)")
for lbl, mask in [("IS 2022-2024", sub.t < OOS_MS), ("OOS 2025+", sub.t >= OOS_MS)]:
    s2 = sub[mask]
    print(f"  {lbl:12s}: hit TP {(s2.hit_tp.mean()*100):.1f}% | n={len(s2)}")

print()
print("=" * 110)
print("2) MAE — giá đi NGƯỢC bao nhiêu TRƯỚC KHI chạm TP (yếu tố quyết định 'no SL')")
print("=" * 110)
w = sub[sub.hit_tp]
l = sub[~sub.hit_tp]
print(f"  Lệnh THẮNG (hit TP): n={len(w)} | MAE TB {w.mae.mean():.2f}% | median {w.mae.median():.2f}% | "
      f"P75 {w.mae.quantile(0.75):.2f}% | P90 {w.mae.quantile(0.9):.2f}% | max {w.mae.max():.2f}%")
print(f"  Lệnh THUA (không hit): n={len(l)} | MAE TB {l.mae.mean():.2f}% | median {l.mae.median():.2f}% | "
      f"P75 {l.mae.quantile(0.75):.2f}% | P90 {l.mae.quantile(0.9):.2f}% | max {l.mae.max():.2f}%")
print(f"  → % lệnh thắng mà MAE > 3%: {(w.mae > 3).mean()*100:.1f}% | >5%: {(w.mae > 5).mean()*100:.1f}% | >10%: {(w.mae > 10).mean()*100:.1f}%")

print()
print("=" * 110)
print("3) LỆNH THUA — lỗ thực tế khi bias đảo (SL = bias đảo)")
print("=" * 110)
print(f"  Final PnL lệnh thua: TB {l.final_pnl.mean():+.2f}% | median {l.final_pnl.median():+.2f}% | "
      f"P25 {l.final_pnl.quantile(0.25):+.2f}% | min {l.final_pnl.min():+.2f}%")
print(f"  Hold lệnh thua: TB {l.hold.mean():.0f} nến")
bins = pd.cut(l.final_pnl, [-100, -20, -10, -5, -2, 0, 100], labels=["<-20%", "-20..-10", "-10..-5", "-5..-2", "-2..0", ">0"])
g = l.groupby(bins, observed=True).size()
print(g.to_string())

print()
print("=" * 110)
print("4) PnL THỰC TẾ nếu thực thi: TP2% + SL=bias đảo (mô phỏng từng lệnh)")
print("=" * 110)
pnl_real = np.where(sub.hit_tp, 2.0, sub.final_pnl)
print(f"  WIN: {(pnl_real > 0).mean()*100:.1f}% | PnL TB {pnl_real.mean():+.2f}% | "
      f"Tổng {pnl_real.sum():+.0f}% | PF {max(0, pnl_real.sum()) / max(0.001, -pnl_real[pnl_real<0].sum()):.2f}")

print()
print("=" * 110)
print("5) LOẠI TRÙNG LẶP: nhiều entry trong cùng 1 bias cycle")
print("=" * 110)
g2 = sub.groupby("slow_cycle_no").size()
print(f"  Số slow cycle có entry: {len(g2)} | entry TB/cycle {g2.mean():.2f} | max {g2.max()}")
# entry ĐẦU TIÊN trong mỗi cycle vs entry sau đó
sub["first_in_cycle"] = ~sub.duplicated("slow_cycle_no")
for lbl, mask in [("entry đầu cycle", sub.first_in_cycle), ("entry sau (nhiễu)", ~sub.first_in_cycle)]:
    s2 = sub[mask]
    print(f"  {lbl:20s} n={len(s2):4d} | hit TP {(s2.hit_tp.mean()*100):5.1f}% | MAE TB {s2.mae.mean():6.2f}% | final TB {s2.final_pnl.mean():+7.2f}%")

print()
print("=" * 110)
print("6) THỜI GIAN TỚI TP (hit TP 2%)")
print("=" * 110)
print(f"  TP bar: TB {w.tp_bar.mean():.0f} nến | median {w.tp_bar.median():.0f} | P90 {w.tp_bar.quantile(0.9):.0f}")
for lo, hi, lbl in [(0, 20, "<=20 nến (1/3 ngày)"), (20, 100, "20-100 (~1 ngày)"), (100, 500, "100-500"), (500, 10**9, ">500")]:
    s2 = w[(w.tp_bar > lo) & (w.tp_bar <= hi)]
    print(f"    {lbl:20s} {len(s2):4d} ({len(s2)/len(w)*100:5.1f}%)")

print()
print("=" * 110)
print("7) CÙNG vs NGƯỢC bias (xác nhận lại biên độ)")
print("=" * 110)
for lbl, mask in [("CÙNG bias", df.bias_agree), ("NGƯỢC bias", ~df.bias_agree)]:
    s2 = df[mask]
    pnl_r = np.where(s2.hit_tp, 2.0, s2.final_pnl)
    print(f"  {lbl:12s} n={len(s2):5d} | hit TP {(s2.hit_tp.mean()*100):5.1f}% | MAE TB {s2.mae.mean():6.2f}% | "
          f"PnL thực thi TB {pnl_r.mean():+6.2f}% | final TB {s2.final_pnl.mean():+7.2f}%")
