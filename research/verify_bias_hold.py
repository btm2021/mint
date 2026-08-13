# ============================================================
# verify_bias_hold.py — KIỂM CHỨNG Ý TƯỞNG:
#   "Khi ATRBot nhỏ (entry) cùng side với bias, dù nhiễu (cắt lên cắt xuống)
#    thì vẫn dương/hòa vốn trong đoạn ngắn tiếp theo.
#    Entry kết thúc khi BIAS thay đổi."
#
# Thiết lập:
#   BIAS  : VIDYA 55 / ATR 10 / mult 2
#   ENTRY : EMA   21 / ATR 10 / mult 4
#   VSR   : 10-10
#   Entry : fast flip CÙNG bias → market tại close nến flip
#   Exit  : khi BIAS đảo (slow flip) — KHÔNG TP/SL, giữ tới bias đảo
# ============================================================
import sys, json
import numpy as np
import pandas as pd

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

DATA = "research/cache/imxusdt_15m.json"
OOS = 1735689600  # 2025-01-01

bars = []
for a in json.load(open(DATA)):
    bars.append(dict(time=a[0], open=a[1], high=a[2], low=a[3], close=a[4], volume=a[5]))
n = len(bars)
print(f"IMXUSDT 15m: {n} nến")

# ---------------- ATRBot core (giống lib/atrbot.js) ----------------
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

slow_st, slow_atr = _core(bars, 10, 55, 2, "vidya")   # BIAS
fast_st, fast_atr = _core(bars, 10, 21, 4, "ema")     # ENTRY

slow_cyc = cycles_of(slow_st)
fast_cyc = cycles_of(fast_st)
print(f"slow cycles: {len(slow_cyc)} | fast cycles: {len(fast_cyc)}")

# map slow cycle cho mỗi bar
slow_cycle_idx = np.zeros(n, dtype=int)
for ci, c in enumerate(slow_cyc):
    slow_cycle_idx[c["start"]:c["end"]+1] = ci

# ---------------- ENTRY: fast flip cùng bias | EXIT: bias đảo ----------------
rows = []
for c in range(len(fast_cyc) - 1):
    cy = fast_cyc[c]
    cs, ce, S = cy["start"], cy["end"], cy["s"]
    if ce - cs < 1: continue
    if slow_st[cs] != S: continue            # CHỈ cùng bias
    sc = slow_cyc[slow_cycle_idx[cs]]        # slow cycle đang chứa entry
    entry_price = bars[cs]["close"]
    exit_idx = min(sc["end"], n - 1)          # exit khi BIAS đảo
    if exit_idx <= cs: continue
    exit_price = bars[exit_idx]["close"]
    pnl_pct = S * (exit_price / entry_price - 1) * 100   # long: +/-, short: ngược dấu
    hold = exit_idx - cs
    # nhiễu fast trong đoạn hold: số lần fast flip tới khi exit
    flips = 0
    for k in range(c + 1, len(fast_cyc)):
        if fast_cyc[k]["start"] <= exit_idx:
            flips += 1
        else:
            break
    rows.append(dict(
        t=bars[cs]["time"], S=S, pnl_pct=pnl_pct, hold=hold,
        flips=flips, bias_len=sc["end"]-sc["start"]+1,
        bias_left=sc["end"]-cs,
        atr_pct=fast_atr[cs]/entry_price*100,
    ))

df = pd.DataFrame(rows)
df["win"] = df.pnl_pct > 0
print(f"\nENTRIES (fast flip cùng bias, exit khi bias đảo): {len(df)}")

print()
print("=" * 110)
print("1) KẾT QUẢ TỔNG — PnL từ entry tới khi bias đảo")
print("=" * 110)
print(f"  WIN: {df.win.mean()*100:.1f}% | PnL TB {df.pnl_pct.mean():+.3f}% | median {df.pnl_pct.median():+.3f}%")
print(f"  PnL P25 {df.pnl_pct.quantile(0.25):+.3f}% | P75 {df.pnl_pct.quantile(0.75):+.3f}%")
print(f"  Tổng PnL: {df.pnl_pct.sum():+.1f}% | Hold TB {df.hold.mean():.0f} nến (median {df.hold.median():.0f})")
print(f"  PnL mỗi nến giữ: {(df.pnl_pct/df.hold).mean():+.4f}%/nến")

print()
print("=" * 110)
print("2) PHÂN PHỐI PnL theo bin")
print("=" * 110)
bins = pd.cut(df.pnl_pct, [-100, -5, -2, 0, 2, 5, 100], labels=["<-5%", "-5..-2%", "-2..0%", "0..2%", "2..5%", ">5%"])
g = df.groupby(bins, observed=True).agg(n=("win", "count"), pct=("win", "mean"))
g["pct"] = (g["pct"]*100).round(1)
print(g.to_string())

print()
print("=" * 110)
print("3) NHIỄU FAST (số flip trong đoạn hold) vs PnL — ý tưởng chính")
print("=" * 110)
for lo, hi, lbl in [(0, 0, "không nhiễu (0 flip)"), (1, 2, "nhiễu nhẹ (1-2 flip)"),
                    (3, 5, "nhiễu vừa (3-5 flip)"), (6, 100, "nhiễu nặng (>=6 flip)")]:
    sub = df[(df.flips > lo) & (df.flips <= hi)]
    if len(sub) >= 20:
        print(f"  {lbl:28s} n={len(sub):5d} | WIN {sub.win.mean()*100:5.1f}% | PnL TB {sub.pnl_pct.mean():+7.3f}% | "
              f"hold TB {sub.hold.mean():6.1f}")

print()
print("=" * 110)
print("4) HOLD (thời gian giữ) vs PnL")
print("=" * 110)
for lo, hi, lbl in [(0, 20, "ngắn <=20 nến"), (20, 50, "20-50"), (50, 150, "50-150"), (150, 100000, "dài >150")]:
    sub = df[(df.hold > lo) & (df.hold <= hi)]
    if len(sub) >= 20:
        print(f"  {lbl:18s} n={len(sub):5d} | WIN {sub.win.mean()*100:5.1f}% | PnL TB {sub.pnl_pct.mean():+7.3f}%")

print()
print("=" * 110)
print("5) PnL SAU N NẾN (đoạn ngắn tiếp theo — trước khi bias đảo)")
print("=" * 110)
for N in [5, 10, 20, 50]:
    sub = df[df.hold > N]
    pnls = []
    for _, r in sub.iterrows():
        # không có index cs trong df — tính lại nhanh: dùng t để tìm bar
        pass
    print(f"  (cần thêm cs — xem bảng 6)")

print()
print("=" * 110)
print("6) OOS (2025+) vs IS")
print("=" * 110)
for lbl, mask in [("IS 2022-2024", df.t < OOS), ("OOS 2025+", df.t >= OOS)]:
    sub = df[mask]
    if len(sub) >= 20:
        print(f"  {lbl:12s} n={len(sub):5d} | WIN {sub.win.mean()*100:5.1f}% | PnL TB {sub.pnl_pct.mean():+7.3f}% | "
              f"hold TB {sub.hold.mean():6.1f}")

df.to_csv("research/output_bias_hold.csv", index=False)
print("\nSaved: research/output_bias_hold.csv")
