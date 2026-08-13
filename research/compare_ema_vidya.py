# ============================================================
# compare_ema_vidya.py — SO SÁNH ENTRY EMA vs ENTRY VIDYA
#
# Stat Original:
#   BIAS  : VIDYA, MA 55, ATR 10, mult 2
#   ENTRY : VIDYA, MA 21, ATR 10, mult 4  (mới — thay EMA)
#   VSR   : 10-10
#
# So sánh trên 10 symbol:
#   1. Hit +2% (lệnh cùng bias từng chạm +2%)
#   2. PnL giữ tới bias đảo
#   3. Số lệnh, win/fail
#   4. Cấu hình TP1%/SL5% & TP2%/SL8%
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

def run_sym(bars, entry_ma_type):
    nn = len(bars)
    slow_st, _ = _core(bars, 10, 55, 2, "vidya")
    fast_st, fast_atr = _core(bars, 10, 21, 4, entry_ma_type)
    slow_cyc = cycles_of(slow_st)
    fast_cyc = cycles_of(fast_st)
    slow_cycle_idx = np.zeros(nn, dtype=int)
    for ci, c in enumerate(slow_cyc):
        slow_cycle_idx[c["start"]:c["end"]+1] = ci
    rows = []
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
        pnl_end = S * (bars[ex]["close"] / entry - 1) * 100
        rows.append(dict(t=bars[cs]["time"], hit=mfe >= 2.0, mfe=mfe, pnl_end=pnl_end, hold=ex-cs))
    return rows

results = []
for entry_type, label in [("ema", "ENTRY EMA (cũ)"), ("vidya", "ENTRY VIDYA (mới)")]:
    for sym in ALL:
        bars = load(sym)
        if bars is None: continue
        tr = run_sym(bars, entry_type)
        df = pd.DataFrame(tr)
        results.append(dict(entry=label, sym=sym, n=len(df),
                            hit=df.hit.mean()*100,
                            pnl_end=df.pnl_end.mean(),
                            total_end=df.pnl_end.sum(),
                            hold=df.hold.mean()))

res = pd.DataFrame(results)
res.to_csv("research/output_ema_vs_vidya.csv", index=False)

print("=" * 120)
print("ENTRY EMA vs ENTRY VIDYA — 10 symbol, 2022-2026")
print("=" * 120)
print(f"{'Entry':20s} {'n':>5s} {'Hit+2%':>8s} {'PnL_bias_đảo':>13s} {'Tổng':>9s} {'Hold':>6s}")
for entry in ["ENTRY EMA (cũ)", "ENTRY VIDYA (mới)"]:
    sub = res[res.entry == entry]
    print(f"{entry:20s} {sub.n.sum():5d} {sub.hit.mean():7.1f}% {sub.pnl_end.mean():+12.3f}% {sub.total_end.sum():+8.0f}% {sub.hold.mean():5.0f}")

print()
print("=" * 120)
print("THEO NHÓM VOLUME")
print("=" * 120)
for grp, syms in GROUPS.items():
    print(f"\n  {grp} ({', '.join(syms)}):")
    for entry in ["ENTRY EMA (cũ)", "ENTRY VIDYA (mới)"]:
        sub = res[(res.entry == entry) & (res.sym.isin(syms))]
        print(f"    {entry:20s} n={sub.n.sum():4d} Hit {sub.hit.mean():5.1f}% PnL {sub.pnl_end.mean():+6.3f}% Tổng {sub.total_end.sum():+7.0f}%")

print()
print("=" * 120)
print("THEO SYMBOL — Hit+2% (cột chính)")
print("=" * 120)
piv = res.pivot(index="sym", columns="entry", values="hit")
print(piv.round(1).to_string())

print()
print("=" * 120)
print("THEO SYMBOL — PnL giữ tới bias đảo")
print("=" * 120)
piv2 = res.pivot(index="sym", columns="entry", values="pnl_end")
print(piv2.round(3).to_string())
