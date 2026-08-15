// ============================================================
// stat2-strategy.js — MÔ PHỎNG CHIẾN LƯỢC ENTRY / TP / SL
// ============================================================

function calculateStat2Trades(bars, cfg, bot1, bot2, vsr1, vsr2, vsrOverlap) {
  if (!bars || bars.length < 50 || !cfg.strategy.enabled) return [];
  const n = bars.length;
  const strat = cfg.strategy;
  const signals = [];

  const fastCycles = bot2.cycles || [];
  const slowStates = bot1.states || [];

  for (let c = 0; c < fastCycles.length; c++) {
    const cy = fastCycles[c];
    const cs = cy.startIndex;
    const ce = cy.endIndex;
    const S = cy.state; // 1 = Long, -1 = Short

    if (cs >= n - 1) continue;

    // Filter theo Mode
    if (strat.mode === "statOriginal") {
      // ATRBot 1 BIAS phải đồng thuận tại nến vào lệnh
      if (slowStates[cs] !== S) continue;
    } else if (strat.mode === "vsrFilter") {
      // Chỉ vào lệnh khi giá nằm trong hoặc chạm vùng chồng lấn 2 VSR
      const ovU = vsrOverlap.upperArr[cs];
      const ovL = vsrOverlap.lowerArr[cs];
      if (!Number.isFinite(ovU) || !Number.isFinite(ovL)) continue;
    }

    signals.push({
      S,
      entryIdx: cs,
      endIdx: Math.min(ce, n - 1),
    });
  }

  const trades = [];
  const sl1Pct = strat.sl1;
  const tp1Pct = strat.tp1;
  const tp2Pct = strat.hasTp2 && strat.tp2 ? strat.tp2 : null;
  const frac1 = strat.frac1;
  const sl2Pct = strat.sl2;
  const feePct = strat.feePct;

  for (const s of signals) {
    const entryIdx = s.entryIdx;
    const entry = bars[entryIdx].close;
    const S = s.S;
    const maxEnd = s.endIdx;

    const sl1Lv = S === 1 ? entry * (1 - sl1Pct / 100) : entry * (1 + sl1Pct / 100);
    const tp1Lv = S === 1 ? entry * (1 + tp1Pct / 100) : entry * (1 - tp1Pct / 100);
    const tp2Lv = tp2Pct != null ? (S === 1 ? entry * (1 + tp2Pct / 100) : entry * (1 - tp2Pct / 100)) : null;

    let rem = 1.0;
    let pnlPct = 0;
    let beActive = false;
    let tp1Done = false;
    let exitIdx = maxEnd;
    let exitType = "TIMEOUT";

    for (let t = entryIdx + 1; t <= maxEnd; t++) {
      const b = bars[t];
      const slCur = S === 1
        ? (beActive ? entry * (1 - (sl2Pct ?? sl1Pct) / 100) : sl1Lv)
        : (beActive ? entry * (1 + (sl2Pct ?? sl1Pct) / 100) : sl1Lv);

      // 1. Kiểm tra dính SL
      const hitSl = S === 1 ? b.low <= slCur : b.high >= slCur;
      if (hitSl) {
        pnlPct += rem * (S * (slCur / entry - 1) * 100 - feePct);
        rem = 0;
        exitType = beActive ? "SL2" : "SL1";
        exitIdx = t;
        break;
      }

      // 2. Kiểm tra TP1
      if (rem > 0 && frac1 < 1.0 && !tp1Done) {
        const hitTp1 = S === 1 ? b.high >= tp1Lv : b.low <= tp1Lv;
        if (hitTp1) {
          pnlPct += frac1 * (S * (tp1Lv / entry - 1) * 100 - feePct);
          rem -= frac1;
          beActive = true;
          tp1Done = true;
        }
      }

      // 3. Kiểm tra TP2 (nếu có)
      if (rem > 0 && tp2Lv != null) {
        const hitTp2 = S === 1 ? b.high >= tp2Lv : b.low <= tp2Lv;
        if (hitTp2) {
          pnlPct += rem * (S * (tp2Lv / entry - 1) * 100 - feePct);
          rem = 0;
          exitType = "TP2";
          exitIdx = t;
          break;
        }
      }

      // 4. Nếu đóng 100% tại TP1
      if (rem > 0 && frac1 >= 1.0 && tp2Lv == null) {
        const hitTp1 = S === 1 ? b.high >= tp1Lv : b.low <= tp1Lv;
        if (hitTp1) {
          pnlPct += rem * (S * (tp1Lv / entry - 1) * 100 - feePct);
          rem = 0;
          exitType = "TP1";
          exitIdx = t;
          break;
        }
      }
    }

    // Nếu hết cycle mà chưa đóng hết lệnh -> đóng theo giá close nến cuối
    if (rem > 0) {
      const exitClose = bars[maxEnd].close;
      pnlPct += rem * (S * (exitClose / entry - 1) * 100 - feePct);
    }

    const pnlR = sl1Pct > 0 ? pnlPct / sl1Pct : 0;
    const exitPrice = bars[exitIdx].close;

    trades.push({
      S,
      entryIdx,
      exitIdx,
      entry,
      exit: exitPrice,
      entryTime: bars[entryIdx].time,
      exitTime: bars[exitIdx].time,
      sl1Lv,
      tp1Lv,
      tp2Lv,
      exitType,
      pnlPct: +pnlPct.toFixed(3),
      pnlR: +pnlR.toFixed(3),
      hold: exitIdx - entryIdx + 1,
      slowState: slowStates[entryIdx] || 0,
      fastState: S,
      vsr1Upper: vsr1.upperArr ? vsr1.upperArr[entryIdx] : null,
      vsr1Lower: vsr1.lowerArr ? vsr1.lowerArr[entryIdx] : null,
      vsr2Upper: vsr2.upperArr ? vsr2.upperArr[entryIdx] : null,
      vsr2Lower: vsr2.lowerArr ? vsr2.lowerArr[entryIdx] : null,
      overlapUpper: vsrOverlap.upperArr ? vsrOverlap.upperArr[entryIdx] : null,
      overlapLower: vsrOverlap.lowerArr ? vsrOverlap.lowerArr[entryIdx] : null,
    });
  }

  trades.sort((a, b) => a.entryIdx - b.entryIdx);
  return trades;
}

function computeStat2Summary(trades) {
  if (!trades || trades.length === 0) return null;
  const n = trades.length;
  const w = trades.filter((t) => t.pnlPct > 0).length;
  const grossWin = trades.reduce((acc, t) => acc + Math.max(0, t.pnlPct), 0);
  const grossLoss = Math.abs(trades.reduce((acc, t) => acc + Math.min(0, t.pnlPct), 0));
  const expR = trades.reduce((acc, t) => acc + t.pnlR, 0) / n;
  const pf = grossLoss > 0 ? grossWin / grossLoss : Infinity;

  const exits = {};
  for (const t of trades) {
    exits[t.exitType] = (exits[t.exitType] || 0) + 1;
  }

  return {
    n,
    winRate: (w / n) * 100,
    expR,
    pf,
    exits,
  };
}
