// ============================================================
// final-strategy.js — MÔ PHỎNG CHIẾN LƯỢC ENTRY / TP / SL & XÁC NHẬN CẤU TRÚC
// ============================================================

function calculateFinalTrades(bars, cfg, bot1, bot2, vsr1, vsr2, vsrOverlap, zonesData, smcData) {
  if (!bars || bars.length < 50 || !cfg.strategy.enabled) return [];
  const n = bars.length;
  const strat = cfg.strategy;
  const signals = [];

  const fastCycles = bot2.cycles || [];
  const slowStates = bot1.states || [];
  const demandZones = zonesData?.demandZones || [];
  const supplyZones = zonesData?.supplyZones || [];

  for (let c = 0; c < fastCycles.length; c++) {
    const cy = fastCycles[c];
    const cs = cy.startIndex;
    const ce = cy.endIndex;
    const S = cy.state; // 1 = Long, -1 = Short
    if (!bars[cs]) continue;
    const entryPrice = bars[cs].close;

    if (cs >= n - 1) continue;

    // Filter theo Mode
    if (strat.mode === "statOriginal") {
      if (slowStates[cs] !== S) continue;
    } else if (strat.mode === "vsrFilter") {
      const ovU = vsrOverlap?.upperArr?.[cs];
      const ovL = vsrOverlap?.lowerArr?.[cs];
      if (!Number.isFinite(ovU) || !Number.isFinite(ovL)) continue;
    } else if (strat.mode === "zoneConfluence") {
      // Long phải chạm Demand zone, Short phải chạm Supply zone
      if (S === 1) {
        const inDemand = demandZones.some((z) => entryPrice >= z.distalLine && entryPrice <= z.proximalLine * 1.005);
        if (!inDemand) continue;
      } else {
        const inSupply = supplyZones.some((z) => entryPrice <= z.distalLine && entryPrice >= z.proximalLine * 0.995);
        if (!inSupply) continue;
      }
    } else if (strat.mode === "smcConfluence") {
      // Cần có OB hoặc FVG cùng chiều gần điểm vào lệnh
      const obs = smcData?.orderBlocks || [];
      const fvgs = smcData?.fvgs || [];
      const targetType = S === 1 ? "bullish" : "bearish";
      const hasOB = obs.some((o) => o.type === targetType && Math.abs(cs - o.index) <= 20);
      const hasFVG = fvgs.some((f) => f.type === targetType && !f.mitigated && Math.abs(cs - f.index) <= 20);
      if (!hasOB && !hasFVG) continue;
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
  const useStructBE = strat.useStructuralBE || cfg.structural?.applyToBE;

  for (let sIdx = 0; sIdx < signals.length; sIdx++) {
    const s = signals[sIdx];
    const entryIdx = s.entryIdx;
    if (!bars[entryIdx]) continue;
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
    let structConfirmed = false;
    let confirmReason = "";

    for (let t = entryIdx + 1; t <= maxEnd; t++) {
      const b = bars[t];
      if (!b) continue;

      // Kiểm tra Structural Confirmation nếu được bật
      if (useStructBE && !structConfirmed) {
        const slice = bars.slice(entryIdx, t + 1);
        const stCheck = ffxCheckStructuralConfirmation(S === 1 ? "long" : "short", entry, slice, cfg.structural?.lookback || 3);
        if (stCheck.confirmed) {
          structConfirmed = true;
          confirmReason = stCheck.reason;
        }
      }

      // Xác định SL hiện tại
      const canMoveToBE = !useStructBE || structConfirmed;
      const effectiveBeActive = beActive && canMoveToBE;

      const slCur = S === 1
        ? (effectiveBeActive ? entry * (1 - (sl2Pct ?? sl1Pct) / 100) : sl1Lv)
        : (effectiveBeActive ? entry * (1 + (sl2Pct ?? sl1Pct) / 100) : sl1Lv);

      // 1. Kiểm tra dính SL
      const hitSl = S === 1 ? (b.low ?? 0) <= slCur : (b.high ?? 0) >= slCur;
      if (hitSl) {
        pnlPct += rem * (S * (slCur / entry - 1) * 100 - feePct);
        rem = 0;
        exitType = effectiveBeActive ? "SL2" : "SL1";
        exitIdx = t;
        break;
      }

      // 2. Kiểm tra TP1
      if (rem > 0 && frac1 < 1.0 && !tp1Done) {
        const hitTp1 = S === 1 ? (b.high ?? 0) >= tp1Lv : (b.low ?? 0) <= tp1Lv;
        if (hitTp1) {
          pnlPct += frac1 * (S * (tp1Lv / entry - 1) * 100 - feePct);
          rem -= frac1;
          beActive = true;
          tp1Done = true;
        }
      }

      // 3. Kiểm tra TP2 (nếu có)
      if (rem > 0 && tp2Lv != null) {
        const hitTp2 = S === 1 ? (b.high ?? 0) >= tp2Lv : (b.low ?? 0) <= tp2Lv;
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
        const hitTp1 = S === 1 ? (b.high ?? 0) >= tp1Lv : (b.low ?? 0) <= tp1Lv;
        if (hitTp1) {
          pnlPct += rem * (S * (tp1Lv / entry - 1) * 100 - feePct);
          rem = 0;
          exitType = "TP1";
          exitIdx = t;
          break;
        }
      }
    }

    if (rem > 0) {
      const exitClose = bars[maxEnd]?.close || entry;
      pnlPct += rem * (S * (exitClose / entry - 1) * 100 - feePct);
      exitIdx = maxEnd;
      exitType = "TIMEOUT";
    }

    const pnlR = sl1Pct > 0 ? pnlPct / sl1Pct : 0;
    const exitPrice = bars[exitIdx] ? bars[exitIdx].close : entry;

    trades.push({
      id: `tr_${sIdx}_${entryIdx}`,
      S,
      entryIdx,
      exitIdx,
      entry,
      exit: exitPrice,
      entryTime: bars[entryIdx].time,
      exitTime: bars[exitIdx] ? bars[exitIdx].time : bars[entryIdx].time,
      pnlPct,
      pnlR,
      exitType,
      hold: exitIdx - entryIdx,
      sl1Lv,
      tp1Lv,
      tp2Lv,
      slowState: slowStates[entryIdx] ?? 0,
      fastState: S,
      vsr1Upper: vsr1?.upperArr?.[entryIdx] ?? NaN,
      vsr1Lower: vsr1?.lowerArr?.[entryIdx] ?? NaN,
      vsr2Upper: vsr2?.upperArr?.[entryIdx] ?? NaN,
      vsr2Lower: vsr2?.lowerArr?.[entryIdx] ?? NaN,
      overlapUpper: vsrOverlap?.upperArr?.[entryIdx] ?? NaN,
      overlapLower: vsrOverlap?.lowerArr?.[entryIdx] ?? NaN,
      structConfirmed,
      confirmReason,
    });
  }

  return trades;
}

function computeFinalSummary(trades) {
  if (!trades || trades.length === 0) return null;
  const n = trades.length;
  let wins = 0, totalR = 0, grossGain = 0, grossLoss = 0;
  const exits = { TP1: 0, TP2: 0, SL1: 0, SL2: 0, TIMEOUT: 0 };

  for (const t of trades) {
    if (t.pnlR > 0) {
      wins++;
      grossGain += t.pnlR;
    } else {
      grossLoss += Math.abs(t.pnlR);
    }
    totalR += t.pnlR;
    if (exits[t.exitType] !== undefined) exits[t.exitType]++;
    else exits.TIMEOUT++;
  }

  const winRate = (wins / n) * 100;
  const expR = totalR / n;
  const pf = grossLoss > 0 ? grossGain / grossLoss : grossGain > 0 ? Infinity : 0;

  return {
    n,
    wins,
    winRate,
    expR,
    pf,
    exits,
    totalR,
  };
}
