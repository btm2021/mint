# ============================================================
# analyze_losers.py — NGHIÊN CỨU KỸ LỆNH THUA (không đạt +2%)
#
# Định nghĩa thua: entry cùng bias nhưng giá KHÔNG từng chạm +2%
# trước khi bias đảo.
# Phân tích:
#   1. Feature tại entry: win vs thua khác gì?
#   2. Diễn biến sau entry: MAE, hold, bias còn sống
#   3. Có lọc được trước không?
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
    return states, atr, trail1, trail2

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

rows = []
for sym in ALL:
    bars = load(sym)
    if bars is None: continue
    nn = len(bars)
    slow_st, slow_atr, slow_t1, slow_t2 = _core(bars, 10, 55, 2, "vidya")
    fast_st, fast_atr, _, _ = _core(bars, 10, 21, 4, "ema")
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
        # MFE, MAE, thời điểm đạt MFE
        mfe = 0.0; mae = 0.0; mfe_bar = 0
        for j in range(cs + 1, ex + 1):
            if S == 1:
                up = (bars[j]["high"] - entry) / entry * 100
                dn = (entry - bars[j]["low"]) / entry * 100
            else:
                up = (entry - bars[j]["low"]) / entry * 100
                dn = (bars[j]["high"] - entry) / entry * 100
            if up > mfe: mfe = up; mfe_bar = j - cs
            if dn > mae: mae = dn
        win = mfe >= 2.0
        # feature tại entry
        slow_age = cs - sc["start"]
        bias_left = sc["end"] - cs
        # số fast flip đã xảy ra trong bias cycle trước entry
        flips_before = 0
        for k in range(c):
            if fast_cyc[k]["start"] <= cs and fast_cyc[k]["start"] >= sc["start"]:
                flips_before += 1
        # vị trí entry so với slow trail2 (×ATR)
        dist_t2 = (entry - slow_t2[cs]) / max(1e-9, slow_atr[cs]) if S == 1 else (slow_t2[cs] - entry) / max(1e-9, slow_atr[cs])
        spread = abs(slow_t1[cs] - slow_t2[cs]) / entry * 100
        atr_pct = fast_atr[cs] / entry * 100
        # momentum trước entry
        mom5 = S * (entry / bars[max(0, cs-5)]["close"] - 1) * 100
        mom20 = S * (entry / bars[max(0, cs-20)]["close"] - 1) * 100
        # fast cycle trước dài bao nhiêu (đo "nhiễu" gần đây)
        prev_fast_len = fast_cyc[c-1]["end"] - fast_cyc[c-1]["start"] + 1 if c > 0 else np.nan
        rows.append(dict(sym=sym, win=win, mfe=mfe, mfe_bar=mfe_bar, mae=mae,
                         slow_age=slow_age, bias_left=bias_left, flips_before=flips_before,
                         dist_t2=dist_t2, spread=spread, atr_pct=atr_pct,
                         mom5=mom5, mom20=mom20, prev_fast_len=prev_fast_len,
                         hold=ex-cs))

df = pd.DataFrame(rows)
w = df[df.win]; L = df[~df.win]
print(f"WIN: {len(w)} ({df.win.mean()*100:.1f}%) | THUA: {len(L)} ({100-df.win.mean()*100:.1f}%)")

print()
print("=" * 110)
print("1) FEATURE TẠI ENTRY: THẮNG vs THUA")
print("=" * 110)
feats = ["slow_age", "bias_left", "flips_before", "dist_t2", "spread", "atr_pct",
         "mom5", "mom20", "prev_fast_len", "mae"]
for f in feats:
    wv = w[f].dropna(); lv = L[f].dropna()
    if len(wv) < 10 or len(lv) < 10: continue
    print(f"  {f:14s} THẮNG {wv.mean():8.2f} (med {wv.median():7.2f}) | THUA {lv.mean():8.2f} (med {lv.median():7.2f}) | diff {wv.mean()-lv.mean():+8.2f}")

print()
print("=" * 110)
print("2) LỆNH THUA: MFE (đi được bao nhiêu) + MAE + hold")
print("=" * 110)
print(f"  MFE thua: TB {L.mfe.mean():+.3f}% | median {L.mfe.median():+.3f}% | P75 {L.mfe.quantile(0.75):+.3f}%")
print(f"  MAE thua: TB {L.mae.mean():+.2f}% | median {L.mae.median():+.2f}%")
print(f"  Hold thua: TB {L.hold.mean():.0f} nến | median {L.hold.median():.0f}")
print(f"  → % thua có MFE >= 1%: {(L.mfe >= 1).mean()*100:.1f}% | >=1.5%: {(L.mfe >= 1.5).mean()*100:.1f}%")
print(f"  → % thua có MAE >= 2%: {(L.mae >= 2).mean()*100:.1f}% | >=5%: {(L.mae >= 5).mean()*100:.1f}%")

print()
print("=" * 110)
print("3) LỆNH THUA THEO SYMBOL")
print("=" * 110)
g = L.groupby("sym").agg(n=("win", "count"), mfe=("mfe", "mean"), mae=("mae", "mean"),
                         hold=("hold", "mean"))
g["mfe"] = g["mfe"].round(3); g["mae"] = g["mae"].round(2); g["hold"] = g["hold"].round(0)
print(g.to_string())

print()
print("=" * 110)
print("4) WINRATE THEO BIN — feature nào tách được thua?")
print("=" * 110)
for feat, bins, labels in [
    ("slow_age", [-1, 100, 300, 700, 10**9], ["<100", "100-300", "300-700", ">700"]),
    ("bias_left", [-1, 50, 150, 400, 10**9], ["<50", "50-150", "150-400", ">400"]),
    ("flips_before", [-1, 0, 2, 5, 100], ["0", "1-2", "3-5", ">5"]),
    ("dist_t2", [-100, 2, 4, 6, 100], ["<2", "2-4", "4-6", ">6"]),
    ("spread", [0, 0.5, 1, 2, 100], ["<0.5", "0.5-1", "1-2", ">2"]),
    ("atr_pct", [0, 0.5, 0.8, 1.2, 100], ["<0.5", "0.5-0.8", "0.8-1.2", ">1.2"]),
    ("mom5", [-100, -0.5, 0, 0.5, 100], ["<-0.5", "-0.5..0", "0..0.5", ">0.5"]),
    ("prev_fast_len", [0, 30, 80, 150, 10**9], ["<30", "30-80", "80-150", ">150"]),
]:
    sub = df.copy()
    sub["bin"] = pd.cut(sub[feat], bins, labels=labels)
    g = sub.groupby("bin", observed=True).agg(n=("win", "count"), win=("win", "mean"))
    g["win"] = (g["win"]*100).round(1)
    print(f"\n  -- {feat} --")
    print(g.to_string())

print()
print("=" * 110)
print("5) KẾT HỢP LỌC — giảm thua được không?")
print("=" * 110)
print(f"  BASE:            n={len(df):4d} | win {(df.win.mean()*100):.1f}%")
f1 = df[df.mom5 < 0.5]
print(f"  + mom5 < 0.5%:   n={len(f1):4d} | win {(f1.win.mean()*100):.1f}%")
f2 = df[df.flips_before <= 4]
print(f"  + flips<=4:      n={len(f2):4d} | win {(f2.win.mean()*100):.1f}%")
f3 = df[(df.mom5 < 0.5) & (df.bias_left > 50)]
print(f"  + mom5<0.5 & bias>50: n={len(f3):4d} | win {(f3.win.mean()*100):.1f}%")
