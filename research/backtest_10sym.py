# ============================================================
# backtest_10sym.py — BACKTEST 10 SYMBOL × 3 CẤU HÌNH
#
# Indicator: BIAS VIDYA 55/ATR 10/mult 2 | ENTRY EMA 21/ATR 10/mult 4
# Entry: fast flip CÙNG bias → market tại close nến flip
#
# Cấu hình:
#   A) TP 2% + SL 8% cứng
#   B) TP 2% + SL = bias đảo (không SL cứng, exit khi bias flip)
#   C) TP 1% + SL 5%
#
# Nhóm volume: TOP {BTC,SOL,DOGE} MID {IMX,LTC,1000SHIB,ETC} LOW {SUSHI,AR,MAV}
# ============================================================
import sys, json, os
import numpy as np
import pandas as pd

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

CACHE = "research/cache"
OOS_MS = 1735689600 * 1000

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

# ---------------- backtest 1 symbol với cấu hình ----------------
def backtest_sym(bars, tp_pct, sl_pct, sl_is_bias_flip):
    nn = len(bars)
    slow_st, _ = _core(bars, 10, 55, 2, "vidya")
    fast_st, _ = _core(bars, 10, 21, 4, "ema")
    slow_cyc = cycles_of(slow_st)
    fast_cyc = cycles_of(fast_st)
    slow_cycle_idx = np.zeros(nn, dtype=int)
    for ci, c in enumerate(slow_cyc):
        slow_cycle_idx[c["start"]:c["end"]+1] = ci
    trades = []
    for c in range(len(fast_cyc) - 1):
        cy = fast_cyc[c]
        cs, ce, S = cy["start"], cy["end"], cy["s"]
        if ce - cs < 1: continue
        if slow_st[cs] != S: continue
        sc = slow_cyc[slow_cycle_idx[cs]]
        bias_end = min(sc["end"], nn - 1)
        if bias_end <= cs: continue
        entry = bars[cs]["close"]
        tp = entry * (1 + tp_pct/100) if S == 1 else entry * (1 - tp_pct/100)
        if sl_is_bias_flip:
            sl = None
        else:
            sl = entry * (1 - sl_pct/100) if S == 1 else entry * (1 + sl_pct/100)
        exit_idx = bias_end; exit_type = "BIAS"; pnl = 0.0
        for t in range(cs + 1, bias_end + 1):
            # SL trước TP (bảo thủ như research)
            if sl is not None and (S == 1 and bars[t]["low"] <= sl or S == -1 and bars[t]["high"] >= sl):
                pnl = -sl_pct; exit_type = "SL"; exit_idx = t; break
            if S == 1 and bars[t]["high"] >= tp or S == -1 and bars[t]["low"] <= tp:
                pnl = tp_pct; exit_type = "TP"; exit_idx = t; break
        if exit_type == "BIAS":
            pnl = S * (bars[bias_end]["close"]/entry - 1) * 100
        trades.append(dict(t=bars[cs]["time"], S=S, pnl=pnl, exit_type=exit_type,
                           hold=exit_idx-cs))
    return trades

# ---------------- chạy ----------------
CONFIGS = [
    ("A: TP2% + SL8%", 2.0, 8.0, False),
    ("B: TP2% + SL=bias", 2.0, 0.0, True),
    ("C: TP1% + SL5%", 1.0, 5.0, False),
]

results = []
for sym in ALL:
    bars = load(sym)
    if bars is None:
        print(f"{sym}: NO DATA")
        continue
    for name, tp, sl, bias_flip in CONFIGS:
        tr = backtest_sym(bars, tp, sl, bias_flip)
        df = pd.DataFrame(tr)
        w = df.pnl > 0
        gw = df.loc[w, "pnl"].sum(); gl = abs(df.loc[~w, "pnl"].sum())
        oos = df.t >= OOS_MS
        results.append(dict(sym=sym, cfg=name, n=len(df), win=w.mean()*100,
                            pnl=df.pnl.mean(), total=df.pnl.sum(),
                            pf=gw/gl if gl > 0 else float("inf"),
                            oos_win=oos.mean()*100 if oos.sum() > 0 else None,
                            oos_pnl=df.loc[oos, "pnl"].mean() if oos.sum() > 0 else None))

res = pd.DataFrame(results)
res.to_csv("research/output_10sym.csv", index=False)

print("=" * 120)
print("TỔNG HỢP 10 SYMBOL × 3 CẤU HÌNH")
print("=" * 120)
for sym in ALL:
    sub = res[res.sym == sym]
    print(f"\n{sym:12s}:")
    for _, r in sub.iterrows():
        oos = f"| OOS {r.oos_win:5.1f}%/{r.oos_pnl:+6.2f}R" if r.oos_win is not None else ""
        print(f"   {r.cfg:22s} n={r.n:4d} WIN {r.win:5.1f}% PnL {r.pnl:+6.3f}% Tổng {r.total:+8.1f}% PF {r.pf:5.2f} {oos}")

print()
print("=" * 120)
print("THEO NHÓM VOLUME (trung bình mỗi lệnh)")
print("=" * 120)
for grp, syms in GROUPS.items():
    sub = res[res.sym.isin(syms)]
    print(f"\n  {grp} ({', '.join(syms)}):")
    for cfg in [c[0] for c in CONFIGS]:
        s = sub[sub.cfg == cfg]
        print(f"    {cfg:22s} n={s.n.sum():5d} WIN {s.win.mean():5.1f}% PnL TB/lệnh {s.pnl.mean():+6.3f}% "
              f"PF TB {s.pf.mean():5.2f} OOS WIN {s.oos_win.mean():5.1f}%")

print()
print("=" * 120)
print("TỔNG 10 SYMBOL")
print("=" * 120)
for cfg in [c[0] for c in CONFIGS]:
    s = res[res.cfg == cfg]
    tot_n = s.n.sum(); tot_pnl = s.total.sum()
    print(f"  {cfg:22s} n={tot_n:5d} | WIN TB {s.win.mean():5.1f}% | PnL TB/lệnh {s.pnl.mean():+6.3f}% | "
          f"Tổng {tot_pnl:+9.0f}% | PF TB {s.pf.mean():5.2f} | OOS WIN TB {s.oos_win.mean():5.1f}%")
