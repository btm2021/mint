// ============================================================
// strategy-statoriginal.js — STAT ORIGINAL
// 2 ATRBot:
//   BIAS  : VIDYA, MA 55, ATR 10, mult 2
//   ENTRY : EMA,   MA 21, ATR 10, mult 4
//   VSR   : 10-10
// Rule: ATRBot ENTRY flip state + ATRBot BIAS đồng thuận
//       → market tại close nến flip
// Exit: TP/SL + time-stop hết fast cycle
// ============================================================

STRATEGY.register({
  key: "statOriginal",
  name: "Stat Original",
  defaults: {
    name: "Stat Original",
    slow: { atrLen: 10, mult: 2, maLen: 55, maType: "vidya" },   // BIAS
    fast: { atrLen: 10, mult: 4, maLen: 21, maType: "ema" },     // ENTRY
    vsrLen: 10, vsrThr: 10,
    vsr2Len: 0, vsr2Thr: 10, showVsr2: false,
    emaLen: 20, showEma: false,
    tp1: 2.0, frac1: 1.0, tp2: null, sl1: 2.0, sl2: 0.0,
    feePct: 0.14, strict: false,
    showBiasCloud: 1, showEntryCloud: 1, showVsr: 1, showEntries: 1,
    colors: {
      vsr1: "#FFEB3B", vsr2: "#2196F3",
      slowUp: "#00E676", slowDown: "#FF5252",
      fastUp: "#00BCD4", fastDown: "#FF9800",
      ema: "#FF9800",
      entry: "#9AA0A6", sl: "#FF5252", tp1: "#FFC107", tp2: "#00E676",
    },
  },

  // CHỈ TÍNH TOÁN — flip + bias
  calculate(bars, cfg) {
    if (!bars || bars.length < 300) return [];
    const n = bars.length;
    const I = computeStrategyIndicators(bars, cfg);
    globalStratIndicators = I;
    const { atrF, slowStates, fastStates, fastCycles } = I;
    const finite = (arr, i) => Number.isFinite(arr[i]);
    const signals = [];

    for (let c = 0; c < fastCycles.length - 1; c++) {
      const cy = fastCycles[c];
      const cs = cy.startIndex, ce = cy.endIndex, S = cy.state;
      if (ce - cs < 1) continue;
      if (slowStates[cs] !== S) continue; // BIAS phải đồng thuận
      signals.push({ S, cf: cs, entryIdx: cs, end: Math.min(ce, n - 1), volConfirm: 1, cycleAge: 1 });
    }

    const trades = [];
    for (const s of signals) {
      const entryIdx = s.entryIdx;
      const entry = bars[entryIdx].close;
      const S = s.S;
      const r = strategyExitSim(bars, s, cfg);
      trades.push({
        strategy: "statOriginal",
        S, cf: s.cf, entryIdx, exitIdx: r.exitIdx, entry, exit: r.exit,
        entryTime: bars[entryIdx].time, exitTime: bars[r.exitIdx].time,
        sl1Lv: r.sl1Lv, tp1Lv: r.tp1Lv, tp2Lv: r.tp2Lv,
        exitType: r.exitType, pnlPct: r.pnlPct, pnlR: r.pnlR, hold: r.hold,
        cycleAge: 1, evz: 0, pdC: 0, volConfirm: 1,
        atrPct: +(atrF[entryIdx] / entry * 100).toFixed(3),
        slowState: slowStates[entryIdx], fastState: fastStates[entryIdx],
        vsrUpper: finite(I.uppers, entryIdx) ? I.uppers[entryIdx] : null,
        vsrLower: finite(I.lowers, entryIdx) ? I.lowers[entryIdx] : null,
        ema20Val: I.ema20[entryIdx], distEma: 0,
      });
    }
    trades.sort((a, b) => a.entryIdx - b.entryIdx);
    return trades;
  },

  // Modal — thông tin lệnh
  modalSections(trade, h) {
    const { row, stTxt, pf, fmtDate } = h;
    return `
        <div class="stm-section">
          <div class="stm-section-title">① Lý do vào lệnh — Stat Original</div>
          ${row("Thời điểm", fmtDate(trade.entryTime) + " → " + fmtDate(trade.exitTime))}
          ${row("1. BIAS — ATRBot VIDYA (55/10/2)", stTxt(trade.slowState), trade.slowState === trade.S ? "ok" : "no")}
          ${row("2. ENTRY — ATRBot EMA (21/10/4) vừa FLIP", stTxt(trade.fastState) + " (nến mở cycle)", "ok")}
          ${row("3. Vào lệnh", "market tại close nến flip", "ok")}
        </div>

        <div class="stm-section">
          <div class="stm-section-title">② Bộ lọc</div>
          ${row("BIAS đồng thuận (slow = fast)", stTxt(trade.slowState) + " = " + stTxt(trade.fastState), trade.slowState === trade.fastState ? "ok" : "no")}
          ${row("ATR nhanh", trade.atrPct + "%", "")}
          ${row("Vị trí vs VSR", `VSR ${pf(trade.vsrLower)}–${pf(trade.vsrUpper)}`, "")}
        </div>`;
  },
});
