# ============================================================
# verify_sl_sweep.py — QUÉT SL: SL nào tối ưu cho TP2%?
# Lý do: lệnh thắng MAE median 1.44% nhưng lệnh thua lỗ TB -8.46%
# → đặt SL vừa phải có thể giữ winrate cao mà cắt được lỗ sâu
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

# thu thập các entry cùng bias
entries = []
for c in range(len(fast_cyc) - 1):
    cy = fast_cyc[c]
    cs, ce, S = cy["start"], cy["end"], cy["s"]
    if ce - cs < 1: continue
    if slow_st[cs] != S: continue
    sc = slow_cyc[slow_cycle_idx[cs]]
    exit_idx = min(sc["end"], n - 1)
    if exit_idx <= cs: continue
    entries.append((cs, S, exit_idx, bars[cs]["time"]))

print(f"Entries cùng bias: {len(entries)}")

def sim(tp_pct, sl_pct):
    wins, losses, total = 0, 0, 0.0
    pnls = []
    for cs, S, exit_idx, t in entries:
        entry_price = bars[cs]["close"]
        tp = entry_price * (1 + tp_pct / 100) if S == 1 else entry_price * (1 - tp_pct / 100)
        sl = entry_price * (1 - sl_pct / 100) if S == 1 else entry_price * (1 + sl_pct / 100)
        pnl = None
        for j in range(cs + 1, exit_idx + 1):
            if S == 1:
                if bars[j]["high"] >= tp:
                    pnl = tp_pct; break
                if bars[j]["low"] <= sl:
                    pnl = -sl_pct; break
            else:
                if bars[j]["low"] <= tp:
                    pnl = tp_pct; break
                if bars[j]["high"] >= sl:
                    pnl = -sl_pct; break
        if pnl is None:
            pnl = S * (bars[exit_idx]["close"] / entry_price - 1) * 100
        pnls.append(pnl)
    pnls = np.array(pnls)
    return dict(win=(pnls > 0).mean() * 100, pnl=pnls.mean(), total=pnls.sum(),
                pf=pnls[pnls > 0].sum() / max(0.001, -pnls[pnls < 0].sum()))

print()
print("=" * 110)
print("QUÉT SL × TP (entry cùng bias, exit sớm nhất giữa TP/SL/bias-đảo)")
print("=" * 110)
print(f"{'SL':>6} | {'TP 2%':>28} | {'TP 3%':>28} | {'TP 5%':>28}")
for sl in [1.0, 1.5, 2.0, 3.0, 5.0, 8.0, 99.0]:
    row = f"{sl:5.1f}%"
    for tp in [2.0, 3.0, 5.0]:
        r = sim(tp, sl)
        row += f" | W {r['win']:5.1f}% P {r['pnl']:+6.2f}%"
    print(row)

print()
print("=" * 110)
print("CHI TIẾT — TP2% + các SL (có OOS)")
print("=" * 110)
def sim_oos(tp_pct, sl_pct):
    out = {}
    for tag, mask in [("IS", None), ("OOS", None)]:
        pass
    is_p, oos_p = [], []
    for cs, S, exit_idx, t in entries:
        entry_price = bars[cs]["close"]
        tp = entry_price * (1 + tp_pct / 100) if S == 1 else entry_price * (1 - tp_pct / 100)
        sl = entry_price * (1 - sl_pct / 100) if S == 1 else entry_price * (1 + sl_pct / 100)
        pnl = None
        for j in range(cs + 1, exit_idx + 1):
            if S == 1:
                if bars[j]["high"] >= tp: pnl = tp_pct; break
                if bars[j]["low"] <= sl: pnl = -sl_pct; break
            else:
                if bars[j]["low"] <= tp: pnl = tp_pct; break
                if bars[j]["high"] >= sl: pnl = -sl_pct; break
        if pnl is None:
            pnl = S * (bars[exit_idx]["close"] / entry_price - 1) * 100
        (is_p if t < OOS_MS else oos_p).append(pnl)
    return np.array(is_p), np.array(oos_p)

for sl in [1.5, 2.0, 3.0, 5.0, 99.0]:
    is_p, oos_p = sim_oos(2.0, sl)
    print(f"  SL {sl:4.1f}%: IS  n={len(is_p):4d} W {(is_p>0).mean()*100:5.1f}% PnL {is_p.mean():+6.2f}% | "
          f"OOS n={len(oos_p):4d} W {(oos_p>0).mean()*100:5.1f}% PnL {oos_p.mean():+6.2f}%")
