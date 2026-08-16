(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) Object.assign(root, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULT_FVG_CONFIG = Object.freeze({
    enabled: true,
    minGapATR: 0.1,
    mitigationMode: "midpoint",
    maxActiveBars: 500,
  });

  const DEFAULT_MARKET_STRUCTURE_CONFIG = Object.freeze({
    enabled: true,
    breakBufferATR: 0.05,
  });

  function calculateFVGs(bars, atrValues = [], options = {}) {
    const config = { ...DEFAULT_FVG_CONFIG, ...options };
    const gaps = [];
    const active = [];
    let nextId = 1;

    for (let index = 0; index < bars.length; index += 1) {
      const candle = bars[index];
      for (let cursor = active.length - 1; cursor >= 0; cursor -= 1) {
        const gap = active[cursor];
        if (index <= gap.confirmedIndex) continue;
        if (index - gap.confirmedIndex > config.maxActiveBars) {
          gap.status = "expired";
          gap.endIndex = index;
          gap.endTime = candle.time;
          active.splice(cursor, 1);
          continue;
        }

        const intersects = candle.high >= gap.low && candle.low <= gap.high;
        if (intersects && gap.status === "active") {
          gap.status = "touched";
          gap.touchIndex = index;
          gap.touchTime = candle.time;
        }

        const mitigated = config.mitigationMode === "midpoint" && (
          gap.direction === "bullish" ? candle.low <= gap.midpoint : candle.high >= gap.midpoint
        );
        if (mitigated && gap.status !== "mitigated") {
          gap.status = "mitigated";
          gap.mitigatedIndex = index;
          gap.mitigatedTime = candle.time;
        }

        const filled = gap.direction === "bullish" ? candle.low <= gap.low : candle.high >= gap.high;
        if (filled) {
          gap.status = "filled";
          gap.filledIndex = index;
          gap.filledTime = candle.time;
          gap.endIndex = index;
          gap.endTime = candle.time;
          active.splice(cursor, 1);
        }
      }

      if (index < 2) continue;
      const twoBack = bars[index - 2];
      const atr = Number(atrValues[index]) || Math.max(candle.high - candle.low, Number.EPSILON);
      let direction = null;
      let low = NaN;
      let high = NaN;
      if (candle.low > twoBack.high) {
        direction = "bullish";
        low = twoBack.high;
        high = candle.low;
      } else if (candle.high < twoBack.low) {
        direction = "bearish";
        low = candle.high;
        high = twoBack.low;
      }
      if (!direction || (high - low) / atr < config.minGapATR) continue;

      const gap = {
        id: `fvg-${nextId++}`,
        direction,
        low,
        high,
        midpoint: (low + high) / 2,
        originIndex: index - 2,
        originTime: twoBack.time,
        confirmedIndex: index,
        confirmedTime: candle.time,
        endIndex: null,
        endTime: null,
        status: "active",
        gapATR: (high - low) / atr,
      };
      gaps.push(gap);
      active.push(gap);
    }
    return gaps;
  }

  function calculateMarketStructure(bars, swings, atrValues = [], options = {}) {
    const config = { ...DEFAULT_MARKET_STRUCTURE_CONFIG, ...options };
    const confirmedByIndex = new Map();
    swings.forEach((swing) => {
      if (!confirmedByIndex.has(swing.confirmedAtIndex)) confirmedByIndex.set(swing.confirmedAtIndex, []);
      confirmedByIndex.get(swing.confirmedAtIndex).push({ ...swing, broken: false });
    });

    const events = [];
    let lastHigh = null;
    let lastLow = null;
    let trend = "neutral";

    for (let index = 0; index < bars.length; index += 1) {
      const candle = bars[index];
      const buffer = (Number(atrValues[index]) || 0) * config.breakBufferATR;
      const bullishBreak = lastHigh && !lastHigh.broken && candle.close > lastHigh.price + buffer;
      const bearishBreak = lastLow && !lastLow.broken && candle.close < lastLow.price - buffer;

      if (bullishBreak) {
        const type = trend === "bearish" ? "CHOCH" : "BOS";
        lastHigh.broken = true;
        events.push({
          id: `ms-${events.length + 1}`,
          type,
          direction: "bullish",
          price: lastHigh.price,
          swingIndex: lastHigh.index,
          swingTime: lastHigh.time,
          breakIndex: index,
          breakTime: candle.time,
          confirmedSwingAtIndex: lastHigh.confirmedAtIndex,
        });
        trend = "bullish";
      } else if (bearishBreak) {
        const type = trend === "bullish" ? "CHOCH" : "BOS";
        lastLow.broken = true;
        events.push({
          id: `ms-${events.length + 1}`,
          type,
          direction: "bearish",
          price: lastLow.price,
          swingIndex: lastLow.index,
          swingTime: lastLow.time,
          breakIndex: index,
          breakTime: candle.time,
          confirmedSwingAtIndex: lastLow.confirmedAtIndex,
        });
        trend = "bearish";
      }

      const newlyConfirmed = confirmedByIndex.get(index) || [];
      newlyConfirmed.forEach((swing) => {
        if (swing.type === "high") lastHigh = swing;
        else lastLow = swing;
      });
    }
    return events;
  }

  return {
    DEFAULT_FVG_CONFIG,
    DEFAULT_MARKET_STRUCTURE_CONFIG,
    calculateFVGs,
    calculateMarketStructure,
  };
});
