(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) Object.assign(root, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULT_CONFLUENCE_CONFIG = Object.freeze({
    confluenceMode: "both",
    confirmationBarsAfter: 2,
    fvgLookbackBars: 3,
    obLookbackBars: 2,
    requireTargetSwingMatch: true,
    minOrderBlockScore: 6,
    minEvidenceScore: 7,
    showRejected: false,
    neutralColor: "#6F7787",
  });

  function lowerBoundByIndex(items, target, key) {
    let low = 0;
    let high = items.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (items[mid][key] < target) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  function windowItems(items, start, end, key) {
    const result = [];
    for (let index = lowerBoundByIndex(items, start, key); index < items.length; index += 1) {
      const item = items[index];
      if (item[key] > end) break;
      result.push(item);
    }
    return result;
  }

  function calculateConfluentMarketStructure(
    bars,
    swings,
    atrValues = [],
    fvgs = [],
    orderBlocks = [],
    options = {},
  ) {
    const config = { ...DEFAULT_CONFLUENCE_CONFIG, ...options };
    const confirmedByIndex = new Map();
    swings.forEach((swing) => {
      if (!confirmedByIndex.has(swing.confirmedAtIndex)) confirmedByIndex.set(swing.confirmedAtIndex, []);
      confirmedByIndex.get(swing.confirmedAtIndex).push({ ...swing, broken: false });
    });

    const fvgByDirection = {
      bullish: fvgs.filter((gap) => gap.direction === "bullish").sort((a, b) => a.confirmedIndex - b.confirmedIndex),
      bearish: fvgs.filter((gap) => gap.direction === "bearish").sort((a, b) => a.confirmedIndex - b.confirmedIndex),
    };
    const obByDirection = {
      bullish: orderBlocks.filter((ob) => ob.direction === "bullish").sort((a, b) => a.confirmedIndex - b.confirmedIndex),
      bearish: orderBlocks.filter((ob) => ob.direction === "bearish").sort((a, b) => a.confirmedIndex - b.confirmedIndex),
    };

    const candidates = [];
    const confirmed = [];
    const rejected = [];
    let pending = [];
    let lastHigh = null;
    let lastLow = null;
    let confirmedTrend = "neutral";

    const createCandidate = (direction, swing, breakIndex) => {
      const fvgStart = Math.max(0, breakIndex - config.fvgLookbackBars);
      const obStart = Math.max(0, breakIndex - config.obLookbackBars);
      const deadline = breakIndex + config.confirmationBarsAfter;
      const eligibleFvgs = windowItems(fvgByDirection[direction], fvgStart, deadline, "confirmedIndex");
      const eligibleObs = windowItems(obByDirection[direction], obStart, deadline, "confirmedIndex")
        .filter((ob) => ob.score >= config.minOrderBlockScore)
        .filter((ob) => !config.requireTargetSwingMatch || ob.metadata?.targetSwingIndex === swing.index);
      const candidate = {
        id: `candidate-${candidates.length + 1}`,
        status: "pending",
        direction,
        price: swing.price,
        swingIndex: swing.index,
        swingTime: swing.time,
        breakIndex,
        breakTime: bars[breakIndex].time,
        confirmedSwingAtIndex: swing.confirmedAtIndex,
        deadlineIndex: deadline,
        eligibleFvgs,
        eligibleObs,
      };
      candidates.push(candidate);
      pending.push(candidate);
    };

    const evaluateCandidate = (candidate, currentIndex) => {
      const fvg = candidate.eligibleFvgs.find((item) => item.confirmedIndex <= currentIndex) || null;
      const orderBlock = candidate.eligibleObs.find((item) => item.confirmedIndex <= currentIndex) || null;
      const evidenceScore = 2
        + (fvg ? 2 + Math.min(1, Number(fvg.gapATR) || 0) : 0)
        + (orderBlock ? 3 + Math.min(1, (Number(orderBlock.score) || 0) / 10) : 0);
      let passed = false;
      if (config.confluenceMode === "either") passed = !!(fvg || orderBlock);
      else if (config.confluenceMode === "score") passed = evidenceScore >= config.minEvidenceScore;
      else passed = !!(fvg && orderBlock);
      return { passed, fvg, orderBlock, evidenceScore };
    };

    for (let index = 0; index < bars.length; index += 1) {
      const candle = bars[index];
      const buffer = (Number(atrValues[index]) || 0) * (Number(config.breakBufferATR) || 0);
      const bullishBreak = lastHigh && !lastHigh.broken && candle.close > lastHigh.price + buffer;
      const bearishBreak = lastLow && !lastLow.broken && candle.close < lastLow.price - buffer;
      if (bullishBreak) {
        lastHigh.broken = true;
        createCandidate("bullish", lastHigh, index);
      } else if (bearishBreak) {
        lastLow.broken = true;
        createCandidate("bearish", lastLow, index);
      }

      const survivors = [];
      for (const candidate of pending) {
        const evidence = evaluateCandidate(candidate, index);
        if (evidence.passed) {
          const type = confirmedTrend !== "neutral" && confirmedTrend !== candidate.direction ? "CHOCH" : "BOS";
          const event = {
            ...candidate,
            type,
            status: "confirmed",
            confirmedIndex: index,
            confirmedTime: bars[index].time,
            evidenceScore: evidence.evidenceScore,
            evidence: {
              fvgId: evidence.fvg?.id || null,
              fvgConfirmedIndex: evidence.fvg?.confirmedIndex ?? null,
              orderBlockId: evidence.orderBlock?.id || null,
              orderBlockConfirmedIndex: evidence.orderBlock?.confirmedIndex ?? null,
              orderBlockScore: evidence.orderBlock?.score ?? null,
            },
          };
          delete event.eligibleFvgs;
          delete event.eligibleObs;
          confirmed.push(event);
          candidate.status = "confirmed";
          candidate.confirmedIndex = index;
          confirmedTrend = candidate.direction;
        } else if (index >= candidate.deadlineIndex) {
          const event = {
            ...candidate,
            type: "RAW",
            status: "rejected",
            rejectedIndex: index,
            rejectedTime: bars[index].time,
            evidenceScore: evidence.evidenceScore,
            evidence: {
              hasFVG: !!evidence.fvg,
              hasOrderBlock: !!evidence.orderBlock,
            },
          };
          delete event.eligibleFvgs;
          delete event.eligibleObs;
          rejected.push(event);
          candidate.status = "rejected";
        } else {
          survivors.push(candidate);
        }
      }
      pending = survivors;

      const newlyConfirmed = confirmedByIndex.get(index) || [];
      newlyConfirmed.forEach((swing) => {
        if (swing.type === "high") lastHigh = swing;
        else lastLow = swing;
      });
    }

    pending.forEach((candidate) => {
      const evidence = evaluateCandidate(candidate, bars.length - 1);
      candidate.evidenceScore = evidence.evidenceScore;
    });

    const rejectionReasons = rejected.reduce((summary, event) => {
      const hasFVG = event.evidence.hasFVG;
      const hasOrderBlock = event.evidence.hasOrderBlock;
      if (hasFVG && hasOrderBlock) summary.bothButInsufficient += 1;
      else if (hasFVG) summary.fvgOnly += 1;
      else if (hasOrderBlock) summary.orderBlockOnly += 1;
      else summary.noEvidence += 1;
      return summary;
    }, { fvgOnly: 0, orderBlockOnly: 0, noEvidence: 0, bothButInsufficient: 0 });

    return {
      confirmed,
      rejected,
      pending: pending.map((candidate) => ({
        ...candidate,
        eligibleFvgs: undefined,
        eligibleObs: undefined,
      })),
      candidates: candidates.map((candidate) => ({
        id: candidate.id,
        direction: candidate.direction,
        swingIndex: candidate.swingIndex,
        breakIndex: candidate.breakIndex,
        deadlineIndex: candidate.deadlineIndex,
        status: candidate.status,
      })),
      metrics: {
        rawBreaks: candidates.length,
        confirmed: confirmed.length,
        rejected: rejected.length,
        pending: pending.length,
        confirmationRate: candidates.length ? confirmed.length / candidates.length : 0,
        rejectionReasons,
      },
    };
  }

  return { DEFAULT_CONFLUENCE_CONFIG, calculateConfluentMarketStructure };
});
