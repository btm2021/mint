# ============================================================
# verify_bias_hold3.py — MFE/MAE trong đoạn ngắn + so sánh cùng/ngược bias
# ============================================================
import sys, json
import numpy as np
import pandas as pd

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

DATA = "research/cache/imxusdt_15m.json"
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
    bias_agree = (slow_st[cs] == S)
    entry_price = bars[cs]["close"]
    sc = slow_cyc[slow_cycle_idx[cs]]
    exit_idx = min(sc["end"], n - 1)
    if exit_idx <= cs: continue
    # MFE/MAE trong 20 và 50 nến (hoặc tới exit nếu sớm hơn)
    for N in [20, 50]:
        jmax = min(cs + N, exit_idx)
        mfe = 0.0; mae = 0.0
        for j in range(cs, jmax + 1):
            if S == 1:
                mfe = max(mfe, (bars[j]["high"] - entry_price) / entry_price * 100)
                mae = min(mae, (bars[j]["low"] - entry_price) / entry_price * 100)
            else:
                mfe = max(mfe, (entry_price - bars[j]["low"]) / entry_price * 100)
                mae = min(mae, (entry_price - bars[j]["high"]) / entry_price * 100)
        rows.append(dict(cs=cs, S=S, bias_agree=bias_agree, N=N, mfe=mfe, mae=mae))
df = pd.DataFrame(rows)

print("=" * 110)
print("MFE/MAE trong đoạn ngắn — entry CÙNG bias (ý tưởng của bạn)")
print("=" * 110)
sub = df[df.bias_agree]
for N in [20, 50]:
    s = sub[sub.N == N]
    print(f"  {N:3d} nến: MFE TB {s.mfe.mean():+.3f}% | MAE TB {s.mae.mean():+.3f}% | "
          f"% đạt MFE>=0.5%: {(s.mfe>=0.5).mean()*100:.1f}% | % đạt MFE>=1%: {(s.mfe>=1).mean()*100:.1f}% | "
          f"% chạm MAE<=-1%: {(s.mae<=-1).mean()*100:.1f}% | E = MFE/|MAE| {abs(s.mfe.mean()/s.mae.mean()):.2f}")

print()
print("=" * 110)
print("SO SÁNH: cùng bias vs ngược bias (20 nến)")
print("=" * 110)
for lbl, mask in [("CÙNG bias", df.bias_agree), ("NGƯỢC bias", ~df.bias_agree)]:
    s = df[mask & (df.N == 20)]
    print(f"  {lbl:12s} n={len(s):5d} | MFE TB {s.mfe.mean():+.3f}% | MAE TB {s.mae.mean():+.3f}% | "
          f"% MFE>=0.5%: {(s.mfe>=0.5).mean()*100:5.1f}% | % MFE>=1%: {(s.mfe>=1).mean()*100:5.1f}%")

print()
print("=" * 110)
print("PHÂN TÍCH 'NHIỄU NHƯNG KHÔNG HẠI': entry cùng bias, fast flip ngay sau đó")
print("=" * 110)
# entry có fast flip lại trong 10 nến (nhiễu nhanh) vs không
rows2 = []
for c in range(len(fast_cyc) - 1):
    cy = fast_cyc[c]
    cs, ce, S = cy["start"], cy["end"], cy["s"]
    if ce - cs < 1: continue
    if slow_st[cs] != S: continue
    entry_price = bars[cs]["close"]
    sc = slow_cyc[slow_cycle_idx[cs]]
    exit_idx = min(sc["end"], n - 1)
    if exit_idx <= cs: continue
    # flip lại trong 10 nến?
    flip_back = False
    for k in range(c + 1, min(c + 4, len(fast_cyc))):
        if fast_cyc[k]["start"] <= cs + 10:
            flip_back = True
            break
    pnl20 = S * (bars[min(cs + 20, exit_idx)]["close"] / entry_price - 1) * 100
    pnl_end = S * (bars[exit_idx]["close"] / entry_price - 1) * 100
    rows2.append(dict(flip_back=flip_back, pnl20=pnl20, pnl_end=pnl_end))
d2 = pd.DataFrame(rows2)
for lbl, mask in [("không flip lại trong 10n", ~d2.flip_back), ("flip lại trong 10n (nhiễu nhanh)", d2.flip_back)]:
    s = d2[mask]
    if len(s) >= 20:
        print(f"  {lbl:34s} n={len(s):5d} | pnl20 TB {s.pnl20.mean():+7.3f}% | "
              f"win20 {(s.pnl20>0).mean()*100:5.1f}% | pnl tới bias đảo {s.pnl_end.mean():+7.3f}%")
