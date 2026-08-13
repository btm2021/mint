# ============================================================
# analyze_win_fail.py — LỌC WIN vs FAIL, LÝ DO WIN/FAIL,
# và "trước khi fail giá đi được bao nhiêu (MFE)"
#
# Định nghĩa (theo lý thuyết đang kiểm chứng):
#   WIN  = giá từng chạm +2% theo hướng entry trước khi bias đảo
#   FAIL = không chạm +2% tới khi bias đảo
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
    return states, atr, trail1, trail2

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

slow_st, slow_atr, slow_t1, slow_t2 = _core(bars, 10, 55, 2, "vidya")
fast_st, fast_atr, fast_t1, fast_t2 = _core(bars, 10, 21, 4, "ema")
slow_cyc = cycles_of(slow_st)
fast_cyc = cycles_of(fast_st)
slow_cycle_idx = np.zeros(n, dtype=int)
for ci, c in enumerate(slow_cyc):
    slow_cycle_idx[c["start"]:c["end"]+1] = ci

# VSR 10-10
def vsr_arrays(bars, length, threshold):
    nn = len(bars)
    uppers = np.full(nn, np.nan); lowers = np.full(nn, np.nan)
    import math
    prev_volume = prev_high = prev_low = prev_close = prev_stdev = np.nan
    vc = []; upper = lower = np.nan
    for i in range(nn):
        b = bars[i]
        change = 0.0 if (math.isnan(prev_volume) or prev_volume == 0) else b["volume"]/prev_volume - 1
        vc.append(change)
        if len(vc) > length: vc.pop(0)
        stdev = 0.0
        if len(vc) >= 2:
            m = sum(vc)/len(vc)
            stdev = math.sqrt(sum((x-m)**2 for x in vc)/len(vc))
        signal = 0.0
        if not math.isnan(prev_stdev) and prev_stdev != 0 and len(vc) >= 2:
            signal = abs(change/prev_stdev)
        if signal > threshold and not math.isnan(prev_high):
            p_upper = max(prev_high, prev_close); p_lower = min(prev_low, prev_close)
            is_overlap = (not math.isnan(upper)) and (p_lower <= upper and lower <= p_upper)
            if is_overlap:
                upper = max(upper, p_upper); lower = min(lower, p_lower)
            else:
                upper = p_upper; lower = p_lower
        uppers[i] = upper; lowers[i] = lower
        prev_volume = b["volume"]; prev_high = b["high"]; prev_low = b["low"]
        prev_close = b["close"]; prev_stdev = stdev
    return uppers, lowers

import math
us, ls = vsr_arrays(bars, 10, 10)

# ---------------- entries với đầy đủ feature ----------------
rows = []
for c in range(len(fast_cyc) - 1):
    cy = fast_cyc[c]
    cs, ce, S = cy["start"], cy["end"], cy["s"]
    if ce - cs < 1: continue
    if slow_st[cs] != S: continue
    sc = slow_cyc[slow_cycle_idx[cs]]
    exit_idx = min(sc["end"], n - 1)
    if exit_idx <= cs: continue
    entry_price = bars[cs]["close"]
    # MFE tới khi bias đảo
    mfe = 0.0; mfe_bar = -1
    for j in range(cs + 1, exit_idx + 1):
        if S == 1:
            p = (bars[j]["high"] - entry_price) / entry_price * 100
        else:
            p = (entry_price - bars[j]["low"]) / entry_price * 100
        if p > mfe:
            mfe = p; mfe_bar = j - cs
    win = mfe >= 2.0
    # ---- feature tại entry ----
    # tuổi bias cycle tại entry (nến)
    slow_age = cs - sc["start"]
    # bias còn sống tới khi đảo (look-ahead, để hiểu)
    slow_left = sc["end"] - cs
    # số fast flip ĐÃ XẢY RA trong bias cycle trước entry này (nhiễu trước đó)
    flips_before = 0
    for k in range(c + 1):
        if fast_cyc[k]["start"] <= cs and fast_cyc[k]["start"] >= sc["start"]:
            flips_before += 1
    flips_before -= 1  # trừ entry hiện tại
    # vị trí entry so với slow trail2 (ATR đơn vị)
    if S == 1:
        dist_t2 = (entry_price - slow_t2[cs]) / max(1e-9, slow_atr[cs])
    else:
        dist_t2 = (slow_t2[cs] - entry_price) / max(1e-9, slow_atr[cs])
    # khoảng cách trail1-trail2 (sức mạnh bias)
    spread = abs(slow_t1[cs] - slow_t2[cs]) / entry_price * 100
    # ATR tại entry
    atr_pct = fast_atr[cs] / entry_price * 100
    # VSR position
    if math.isnan(us[cs]): vsr_pos = 0
    elif entry_price > us[cs]: vsr_pos = 1
    elif entry_price < ls[cs]: vsr_pos = -1
    else: vsr_pos = 0
    # momentum trước entry (5 nến)
    mom5 = S * (entry_price / bars[max(0, cs-5)]["close"] - 1) * 100
    # fast cycle hiện tại đã dài bao nhiêu nến tại entry (=1 vì entry tại flip)
    prev_fast_len = fast_cyc[c-1]["end"] - fast_cyc[c-1]["start"] + 1 if c > 0 else np.nan
    rows.append(dict(t=bars[cs]["time"], cs=cs, S=S, win=win, mfe=mfe, mfe_bar=mfe_bar,
                     slow_age=slow_age, slow_left=slow_left, flips_before=flips_before,
                     dist_t2=dist_t2, spread=spread, atr_pct=atr_pct, vsr_pos=vsr_pos,
                     mom5=mom5, prev_fast_len=prev_fast_len, hold=exit_idx-cs,
                     final_pnl=S*(bars[exit_idx]["close"]/entry_price-1)*100))

df = pd.DataFrame(rows)
w = df[df.win]; f = df[~df.win]
print(f"WIN: {len(w)} ({df.win.mean()*100:.1f}%) | FAIL: {len(f)}")

print()
print("=" * 110)
print("1) FEATURE TẠI ENTRY: WIN vs FAIL")
print("=" * 110)
feats = ["slow_age", "slow_left", "flips_before", "dist_t2", "spread", "atr_pct",
         "vsr_pos", "mom5", "prev_fast_len"]
for feat in feats:
    wv = w[feat].dropna(); fv = f[feat].dropna()
    if len(wv) < 10 or len(fv) < 10: continue
    print(f"  {feat:16s} WIN {wv.mean():8.2f} (med {wv.median():7.2f}) | FAIL {fv.mean():8.2f} (med {fv.median():7.2f}) | diff {wv.mean()-fv.mean():+8.2f}")

print()
print("=" * 110)
print("2) WINRATE THEO BIN — feature mạnh nhất")
print("=" * 110)
for feat, bins, labels in [
    ("slow_age", [0, 50, 100, 300, 10**9], ["<50", "50-100", "100-300", ">300"]),
    ("flips_before", [-1, 0, 2, 5, 100], ["0", "1-2", "3-5", ">5"]),
    ("dist_t2", [-100, 1, 2, 4, 100], ["<1", "1-2", "2-4", ">4"]),
    ("spread", [0, 0.5, 1, 2, 100], ["<0.5", "0.5-1", "1-2", ">2"]),
    ("mom5", [-100, -0.3, 0, 0.3, 100], ["<-0.3", "-0.3..0", "0..0.3", ">0.3"]),
    ("atr_pct", [0, 0.3, 0.6, 1.0, 100], ["<0.3", "0.3-0.6", "0.6-1.0", ">1.0"]),
]:
    sub = df.copy()
    sub["bin"] = pd.cut(sub[feat], bins, labels=labels)
    g = sub.groupby("bin", observed=True).agg(n=("win", "count"), win=("win", "mean"))
    g["win"] = (g["win"]*100).round(1)
    print(f"\n  -- {feat} --")
    print(g.to_string())

print()
print("=" * 110)
print("3) TRƯỚC KHI FAIL — giá đi được bao nhiêu? (MFE của lệnh fail)")
print("=" * 110)
print(f"  MFE FAIL: TB {f.mfe.mean():+.2f}% | median {f.mfe.median():+.2f}% | "
      f"P25 {f.mfe.quantile(0.25):+.2f}% | P75 {f.mfe.quantile(0.75):+.2f}% | max {f.mfe.max():+.2f}%")
bins = pd.cut(f.mfe, [-0.01, 0.5, 1.0, 1.5, 2.0], labels=["0-0.5%", "0.5-1%", "1-1.5%", "1.5-2%"])
g = f.groupby(bins, observed=True).size()
print("  Phân bố MFE lệnh fail:")
print(g.to_string())
print(f"\n  → % fail mà MFE >= 1%: {(f.mfe >= 1).mean()*100:.1f}% | >=1.5%: {(f.mfe >= 1.5).mean()*100:.1f}%")
print(f"  → nếu TP = 1% thay vì 2%: winrate = {((df.mfe >= 1).mean())*100:.1f}%")
print(f"  → nếu TP = 1.5%: winrate = {((df.mfe >= 1.5).mean())*100:.1f}%")

print()
print("=" * 110)
print("4) LỆNH FAIL ĐẶC ĐIỂM: hold tới bias đảo + final PnL")
print("=" * 110)
print(f"  Hold FAIL: TB {f.hold.mean():.0f} nến | median {f.hold.median():.0f}")
print(f"  Final PnL FAIL: TB {f.final_pnl.mean():+.2f}% | median {f.final_pnl.median():+.2f}%")
# fail nhanh vs fail chậm
for lo, hi, lbl in [(0, 50, "fail nhanh (bias đảo <=50n)"), (50, 300, "fail vừa"), (300, 10**9, "fail chậm")]:
    s2 = f[(f.hold > lo) & (f.hold <= hi)]
    if len(s2) >= 10:
        print(f"    {lbl:28s} n={len(s2):3d} | MFE TB {s2.mfe.mean():+.2f}% | final {s2.final_pnl.mean():+.2f}%")

print()
print("=" * 110)
print("5) KẾT HỢP 2-3 FEATURE — tìm nhóm winrate cao/thấp")
print("=" * 110)
df["old_bias"] = df.slow_age > df.slow_age.median()
df["far_t2"] = df.dist_t2 > df.dist_t2.median()
for lbl, mask in [
    ("bias trẻ + cách xa t2", df.old_bias & df.far_t2),
    ("bias trẻ + gần t2", df.old_bias & ~df.far_t2),
    ("bias già + cách xa t2", ~df.old_bias & df.far_t2),
    ("bias già + gần t2", ~df.old_bias & ~df.far_t2),
]:
    s2 = df[mask]
    print(f"  {lbl:24s} n={len(s2):4d} | win {s2.win.mean()*100:5.1f}% | MFE TB {s2.mfe.mean():+6.2f}%")
