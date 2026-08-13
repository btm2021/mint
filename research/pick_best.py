# ============================================================
# pick_best.py — CHỌN 1 CẤU HÌNH TỐI ƯU DUY NHẤT
# So sánh sâu 5 ứng viên hàng đầu:
#   - PnL/symbol (bao nhiêu symbol dương)
#   - OOS 2025+ ổn định?
#   - TP/SL thực tế (TP1%/SL5%, TP2%/SL8%)
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
OOS_MS = 1735689600 * 1000

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

# 5 ứng viên từ grid: (bias_len, bias_mult, etype, elen, emult)
CANDIDATES = [
    ("C1: B200/m3+Vid34/m3", 200, 3, "vidya", 34, 3),
    ("C2: B55/m3+Ema55/m2", 55, 3, "ema", 55, 2),
    ("C3: B89/m2+Vid14/m3", 89, 2, "vidya", 14, 3),
    ("C4: B55/m3+Vid14/m2", 55, 3, "vidya", 14, 2),
    ("C5: B89/m2+Vid14/m2", 89, 2, "vidya", 14, 2),
]

def run_cfg(bars, bl, bm, et, el, em, tp, sl, use_sl):
    nn = len(bars)
    slow_st = _core(bars, 10, bl, bm, "ema")
    fast_st = _core(bars, 10, el, em, et)
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
        bend = min(sc["end"], nn - 1)
        if bend <= cs: continue
        entry = bars[cs]["close"]
        tp_lv = entry * (1 + tp/100) if S == 1 else entry * (1 - tp/100)
        sl_lv = entry * (1 - sl/100) if S == 1 else entry * (1 + sl/100)
        pnl = None
        for j in range(cs + 1, bend + 1):
            if S == 1:
                if use_sl and bars[j]["low"] <= sl_lv: pnl = -sl; break
                if bars[j]["high"] >= tp_lv: pnl = tp; break
            else:
                if use_sl and bars[j]["high"] >= sl_lv: pnl = -sl; break
                if bars[j]["low"] <= tp_lv: pnl = tp; break
        if pnl is None:
            pnl = S * (bars[bend]["close"]/entry - 1) * 100
        trades.append(dict(t=bars[cs]["time"], pnl=pnl))
    return pd.DataFrame(trades)

print("=" * 130)
print("SO SÁNH 5 ỨNG VIÊN — 10 symbol")
print("=" * 130)
summary = []
for name, bl, bm, et, el, em in CANDIDATES:
    rows = []
    for sym in ALL:
        bars = load(sym)
        if bars is None: continue
        df = run_cfg(bars, bl, bm, et, el, em, 0, 0, False)
        df["sym"] = sym
        rows.append(df)
    d = pd.concat(rows)
    oos = d.t >= OOS_MS
    pos_syms = d.groupby("sym")["pnl"].sum()
    n_pos = (pos_syms > 0).sum()
    summary.append(dict(cfg=name, n=len(d), hit=(d.pnl>0).mean()*100, pnl=d.pnl.mean(),
                        total=d.pnl.sum(), pos_syms=n_pos,
                        oos_pnl=d.loc[oos,"pnl"].mean() if oos.sum()>0 else None,
                        oos_win=(d.loc[oos,"pnl"]>0).mean()*100 if oos.sum()>0 else None))
    print(f"  {name:22s} n={len(d):5d} | Hit+2% {(d.pnl>0).mean()*100:5.1f}% | PnL {d.pnl.mean():+6.3f}% | "
          f"Tổng {d.pnl.sum():+8.0f}% | symbol dương {n_pos}/10 | OOS PnL {d.loc[oos,'pnl'].mean():+.3f}% | OOS win {(d.loc[oos,'pnl']>0).mean()*100:.1f}%")

print()
print("=" * 130)
print("BACKTEST TP/SL THỰC TẾ — 2 cấu hình mạnh nhất × 3 exit")
print("=" * 130)
def test_exits(bl, bm, et, el, em):
    out = {}
    for tag, tp, sl, use in [("TP1/SL5", 1.0, 5.0, True), ("TP2/SL8", 2.0, 8.0, True), ("TP1/SL=bias", 1.0, 0.0, False)]:
        rows = []
        for sym in ALL:
            bars = load(sym)
            if bars is None: continue
            df = run_cfg(bars, bl, bm, et, el, em, tp, sl, use)
            df["sym"] = sym
            rows.append(df)
        d = pd.concat(rows)
        oos = d.t >= OOS_MS
        out[tag] = dict(n=len(d), win=(d.pnl>0).mean()*100, pnl=d.pnl.mean(), total=d.pnl.sum(),
                        oos_pnl=d.loc[oos,"pnl"].mean() if oos.sum()>0 else None)
    return out

for name, bl, bm, et, el, em in [CANDIDATES[0], CANDIDATES[3]]:
    print(f"\n  {name}:")
    r = test_exits(bl, bm, et, el, em)
    for tag, v in r.items():
        print(f"    {tag:14s} n={v['n']:5d} | WIN {v['win']:5.1f}% | PnL TB {v['pnl']:+6.3f}% | Tổng {v['total']:+8.0f}% | OOS {v['oos_pnl']:+.3f}%")
