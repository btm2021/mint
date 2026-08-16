(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) Object.assign(root, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULT_ORDER_BLOCK_CONFIG = Object.freeze({
    mode: "strict",
    atrPeriod: 14,
    swingLeft: 3,
    swingRight: 3,
    sweepBufferATR: 0.05,
    sweepRecoveryBars: 2,
    displacementWindow: 3,
    minDisplacementATR: 1.5,
    minBodyATR: 0.8,
    minDirectionalBodyRatio: 0.65,
    breakBufferATR: 0.05,
    maxBarsSweepToBreak: 12,
    originLookback: 6,
    zoneMode: "full",
    invalidationMode: "close",
    invalidationBufferATR: 0,
    mitigationMode: "midpoint",
    maxActiveBars: 500,
    mergeOverlapRatio: 0.7,
    mergeOriginDistance: 3,
    minScoreToRender: 6,
  });

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

  function normalizeCandle(raw) {
    const candle = {
      time: finite(raw.time),
      open: finite(raw.open),
      high: finite(raw.high),
      low: finite(raw.low),
      close: finite(raw.close),
      volume: finite(raw.volume),
      buyVolume: finite(raw.buyVolume),
    };
    if (!candle.time || candle.high < candle.low) throw new Error("Invalid closed candle");
    return candle;
  }

  function trueRange(candle, previousClose) {
    if (!Number.isFinite(previousClose)) return candle.high - candle.low;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    );
  }

  function isSwingHigh(candles, center, left, right) {
    if (center < left || center + right >= candles.length) return false;
    const price = candles[center].high;
    for (let i = center - left; i <= center + right; i += 1) {
      if (i !== center && candles[i].high >= price) return false;
    }
    return true;
  }

  function isSwingLow(candles, center, left, right) {
    if (center < left || center + right >= candles.length) return false;
    const price = candles[center].low;
    for (let i = center - left; i <= center + right; i += 1) {
      if (i !== center && candles[i].low <= price) return false;
    }
    return true;
  }

  function detectDisplacement(candles, atrValues, startIndex, endIndex, direction, config) {
    if (startIndex < 0 || endIndex < startIndex || !candles[endIndex]) return { valid: false };
    const atr = atrValues[startIndex] || atrValues[endIndex];
    if (!Number.isFinite(atr) || atr <= 0) return { valid: false };

    const start = candles[startIndex];
    const end = candles[endIndex];
    const signedMove = direction === "bullish" ? end.close - start.open : start.open - end.close;
    const moveATR = signedMove / atr;
    let directionalBody = 0;
    let totalBody = 0;
    let maxBodyATR = 0;
    let hasFVG = false;

    for (let i = startIndex; i <= endIndex; i += 1) {
      const candle = candles[i];
      const body = Math.abs(candle.close - candle.open);
      totalBody += body;
      const aligned = direction === "bullish" ? candle.close > candle.open : candle.close < candle.open;
      if (aligned) directionalBody += body;
      maxBodyATR = Math.max(maxBodyATR, body / atr);
      if (i >= startIndex + 2) {
        const twoBack = candles[i - 2];
        if (direction === "bullish" && candle.low > twoBack.high) hasFVG = true;
        if (direction === "bearish" && candle.high < twoBack.low) hasFVG = true;
      }
    }

    const directionalRatio = totalBody > 0 ? directionalBody / totalBody : 0;
    return {
      valid: moveATR >= config.minDisplacementATR
        && maxBodyATR >= config.minBodyATR
        && directionalRatio >= config.minDirectionalBodyRatio,
      moveATR,
      maxBodyATR,
      directionalRatio,
      hasFVG,
      startIndex,
      endIndex,
    };
  }

  function findOrigin(candles, displacementStart, lookback, direction) {
    const first = Math.max(0, displacementStart - lookback);
    for (let i = displacementStart; i >= first; i -= 1) {
      const candle = candles[i];
      const opposite = direction === "bullish" ? candle.close < candle.open : candle.close > candle.open;
      if (opposite) return i;
    }
    return Math.max(0, displacementStart - 1);
  }

  function zoneFromCandle(candle, direction, mode) {
    if (mode === "body") {
      return { low: Math.min(candle.open, candle.close), high: Math.max(candle.open, candle.close) };
    }
    if (mode === "hybrid") {
      return direction === "bullish"
        ? { low: candle.low, high: Math.max(candle.open, candle.close) }
        : { low: Math.min(candle.open, candle.close), high: candle.high };
    }
    return { low: candle.low, high: candle.high };
  }

  function overlapRatio(a, b) {
    const overlap = Math.max(0, Math.min(a.high, b.high) - Math.max(a.low, b.low));
    const smaller = Math.min(a.high - a.low, b.high - b.low);
    return smaller > 0 ? overlap / smaller : 0;
  }

  class OrderBlockEngine {
    constructor(options = {}) {
      this.config = { ...DEFAULT_ORDER_BLOCK_CONFIG, ...options };
      this.listeners = new Map();
      this.reset();
    }

    reset() {
      this.candles = [];
      this.atr = [];
      this.trueRanges = [];
      this.swings = [];
      this.liquidityLevels = [];
      this.activeHighLevels = [];
      this.activeLowLevels = [];
      this.pendingSweeps = [];
      this.candidates = [];
      this.orderBlocks = [];
      this.debugEvents = [];
      this.eventKeys = new Set();
      this.nextId = 1;
    }

    on(eventName, listener) {
      if (!this.listeners.has(eventName)) this.listeners.set(eventName, new Set());
      this.listeners.get(eventName).add(listener);
      return () => this.listeners.get(eventName)?.delete(listener);
    }

    emit(eventName, payload) {
      (this.listeners.get(eventName) || []).forEach((listener) => listener(payload));
    }

    processCandles(candles) {
      this.reset();
      candles.forEach((candle) => this.onClosedCandle(candle));
      return this.getResult();
    }

    onClosedCandle(rawCandle) {
      const candle = normalizeCandle(rawCandle);
      const previous = this.candles[this.candles.length - 1];
      if (previous && candle.time <= previous.time) {
        throw new Error("OrderBlockEngine accepts strictly increasing closed candles only");
      }

      const index = this.candles.length;
      this.candles.push(candle);
      this._appendATR(candle, previous);
      this._updateLifecycle(index);
      this._updatePendingSweeps(index);
      this._detectSweeps(index);
      this._updateCandidates(index);
      this._confirmSwing(index);
      return this.orderBlocks;
    }

    getOrderBlocks({ includeExpired = true, minScore = 0 } = {}) {
      return this.orderBlocks
        .filter((ob) => (includeExpired || ob.status !== "expired") && ob.score >= minScore)
        .map((ob) => ({ ...ob, metadata: { ...ob.metadata } }));
    }

    getDebugEvents() {
      return this.debugEvents.map((event) => ({ ...event }));
    }

    getResult() {
      return {
        orderBlocks: this.getOrderBlocks(),
        debugEvents: this.getDebugEvents(),
        swings: this.swings.map((swing) => ({ ...swing })),
      };
    }

    _appendATR(candle, previous) {
      const tr = trueRange(candle, previous?.close);
      const period = Math.max(1, this.config.atrPeriod);
      this.trueRanges.push(tr);
      const previousATR = this.atr[this.atr.length - 1];
      if (this.trueRanges.length <= period) {
        const warmupAverage = this.trueRanges.reduce((sum, value) => sum + value, 0) / this.trueRanges.length;
        this.atr.push(warmupAverage);
      } else {
        this.atr.push(((previousATR * (period - 1)) + tr) / period);
      }
    }

    _addDebug(type, index, direction, price, extra = {}) {
      const candle = this.candles[index];
      if (!candle) return;
      this.debugEvents.push({ type, index, time: candle.time, direction, price, ...extra });
    }

    _confirmSwing(currentIndex) {
      const { swingLeft: left, swingRight: right } = this.config;
      const center = currentIndex - right;
      if (center < left) return;

      if (isSwingHigh(this.candles, center, left, right)) {
        const swing = {
          type: "high",
          index: center,
          time: this.candles[center].time,
          price: this.candles[center].high,
          confirmedAtIndex: currentIndex,
        };
        this.swings.push(swing);
        this.liquidityLevels.push({ ...swing, swept: false });
        this._insertActiveLevel(this.liquidityLevels[this.liquidityLevels.length - 1]);
        this._addDebug("swing-high", center, "bearish", swing.price, { confirmedAtIndex: currentIndex });
      }

      if (isSwingLow(this.candles, center, left, right)) {
        const swing = {
          type: "low",
          index: center,
          time: this.candles[center].time,
          price: this.candles[center].low,
          confirmedAtIndex: currentIndex,
        };
        this.swings.push(swing);
        this.liquidityLevels.push({ ...swing, swept: false });
        this._insertActiveLevel(this.liquidityLevels[this.liquidityLevels.length - 1]);
        this._addDebug("swing-low", center, "bullish", swing.price, { confirmedAtIndex: currentIndex });
      }
    }

    _insertActiveLevel(level) {
      const levels = level.type === "high" ? this.activeHighLevels : this.activeLowLevels;
      let low = 0;
      let high = levels.length;
      while (low < high) {
        const mid = (low + high) >> 1;
        if (levels[mid].price <= level.price) low = mid + 1;
        else high = mid;
      }
      levels.splice(low, 0, level);
    }

    _updatePendingSweeps(index) {
      const candle = this.candles[index];
      const survivors = [];
      for (const pending of this.pendingSweeps) {
        const recovered = pending.direction === "bullish"
          ? candle.close > pending.level.price
          : candle.close < pending.level.price;
        if (recovered && index <= pending.expiresAt) {
          this._registerSweep({ ...pending, recoveryIndex: index });
        } else if (index < pending.expiresAt) {
          survivors.push(pending);
        }
      }
      this.pendingSweeps = survivors;
    }

    _detectSweeps(index) {
      if (index < this.config.atrPeriod - 1) return;
      const candle = this.candles[index];
      const buffer = this.config.sweepBufferATR * (this.atr[index] || 0);
      let highCutoff = 0;
      const highThreshold = candle.high - buffer;
      while (highCutoff < this.activeHighLevels.length && this.activeHighLevels[highCutoff].price < highThreshold) {
        highCutoff += 1;
      }
      const sweptHighs = this.activeHighLevels.splice(0, highCutoff);

      let lowCutoff = this.activeLowLevels.length;
      const lowThreshold = candle.low + buffer;
      while (lowCutoff > 0 && this.activeLowLevels[lowCutoff - 1].price > lowThreshold) {
        lowCutoff -= 1;
      }
      const sweptLows = this.activeLowLevels.splice(lowCutoff);

      const registerBreach = (level, direction) => {
        level.swept = true;
        level.sweptAtIndex = index;
        const pending = {
          direction,
          level,
          sweepIndex: index,
          extremePrice: direction === "bullish" ? candle.low : candle.high,
          expiresAt: index + this.config.sweepRecoveryBars,
        };
        const recovered = direction === "bullish" ? candle.close > level.price : candle.close < level.price;
        if (recovered) this._registerSweep({ ...pending, recoveryIndex: index });
        else this.pendingSweeps.push(pending);
      };

      sweptHighs.forEach((level) => registerBreach(level, "bearish"));
      sweptLows.forEach((level) => registerBreach(level, "bullish"));
    }

    _registerSweep(sweep) {
      const exists = this.candidates.some((candidate) => (
        candidate.sweepIndex === sweep.sweepIndex
        && candidate.level.index === sweep.level.index
        && candidate.direction === sweep.direction
      ));
      if (exists) return;
      this._addDebug("sweep", sweep.sweepIndex, sweep.direction, sweep.level.price, {
        recoveryIndex: sweep.recoveryIndex,
      });
      this.candidates.push({
        ...sweep,
        state: "waiting-displacement",
        displacement: null,
        targetSwing: null,
      });
    }

    _nearestTargetSwing(direction, beforeIndex) {
      const targetType = direction === "bullish" ? "high" : "low";
      for (let i = this.swings.length - 1; i >= 0; i -= 1) {
        const swing = this.swings[i];
        if (swing.type === targetType && swing.index < beforeIndex && swing.confirmedAtIndex <= beforeIndex) {
          return swing;
        }
      }
      return null;
    }

    _updateCandidates(index) {
      const survivors = [];
      for (const candidate of this.candidates) {
        const displacementDeadline = candidate.recoveryIndex + this.config.displacementWindow - 1;
        const breakDeadline = candidate.sweepIndex + this.config.maxBarsSweepToBreak;

        if (candidate.state === "waiting-displacement" && index <= displacementDeadline) {
          const displacement = detectDisplacement(
            this.candles,
            this.atr,
            candidate.recoveryIndex,
            index,
            candidate.direction,
            this.config,
          );
          if (displacement.valid) {
            const targetSwing = this._nearestTargetSwing(candidate.direction, candidate.recoveryIndex);
            if (targetSwing) {
              candidate.state = "waiting-break";
              candidate.displacement = displacement;
              candidate.targetSwing = targetSwing;
              this._addDebug("displacement-start", displacement.startIndex, candidate.direction, this.candles[displacement.startIndex].open);
              this._addDebug("displacement-end", displacement.endIndex, candidate.direction, this.candles[displacement.endIndex].close);
            }
          }
        }

        if (candidate.state === "waiting-break" && index <= breakDeadline) {
          const target = candidate.targetSwing.price;
          const buffer = this.config.breakBufferATR * (this.atr[index] || 0);
          const broken = candidate.direction === "bullish"
            ? this.candles[index].close > target + buffer
            : this.candles[index].close < target - buffer;
          if (broken) {
            this._addDebug("structure-break", index, candidate.direction, target);
            this._createOrderBlock(candidate, index);
            continue;
          }
        }

        if (index <= breakDeadline && !(candidate.state === "waiting-displacement" && index >= displacementDeadline)) {
          survivors.push(candidate);
        } else if (candidate.state === "waiting-break" && index < breakDeadline) {
          survivors.push(candidate);
        }
      }
      this.candidates = survivors;
    }

    _createOrderBlock(candidate, confirmedIndex) {
      const originIndex = findOrigin(
        this.candles,
        candidate.displacement.startIndex,
        this.config.originLookback,
        candidate.direction,
      );
      const eventKey = `${candidate.direction}:${candidate.sweepIndex}:${originIndex}`;
      if (this.eventKeys.has(eventKey)) return null;
      this.eventKeys.add(eventKey);

      const origin = this.candles[originIndex];
      const zone = zoneFromCandle(origin, candidate.direction, this.config.zoneMode);
      const move = candidate.displacement.moveATR;
      const displacementScore = move >= 2.5 ? 3 : move >= 2 ? 2.5 : move >= 1.5 ? 2 : 1;
      const score = Math.min(10, displacementScore + 3 + 2 + 1 + (candidate.displacement.hasFVG ? 1 : 0));
      const ob = {
        id: `ob-${this.nextId++}`,
        eventKey,
        direction: candidate.direction,
        low: zone.low,
        high: zone.high,
        midpoint: (zone.low + zone.high) / 2,
        originIndex,
        originTime: origin.time,
        confirmedIndex,
        confirmedTime: this.candles[confirmedIndex].time,
        endIndex: null,
        endTime: null,
        invalidatedIndex: null,
        invalidatedTime: null,
        status: "active",
        score,
        metadata: {
          sweepIndex: candidate.sweepIndex,
          recoveryIndex: candidate.recoveryIndex,
          displacementStartIndex: candidate.displacement.startIndex,
          displacementEndIndex: candidate.displacement.endIndex,
          breakIndex: confirmedIndex,
          targetSwingIndex: candidate.targetSwing.index,
          displacementATR: candidate.displacement.moveATR,
          directionalBodyRatio: candidate.displacement.directionalRatio,
          hasFVG: candidate.displacement.hasFVG,
          touchCount: 0,
          inside: false,
        },
      };

      const mergeTarget = this.orderBlocks.find((existing) => (
        existing.direction === ob.direction
        && existing.status !== "invalidated"
        && existing.status !== "expired"
        && Math.abs(existing.originIndex - ob.originIndex) <= this.config.mergeOriginDistance
        && overlapRatio(existing, ob) >= this.config.mergeOverlapRatio
      ));
      if (mergeTarget && mergeTarget.score >= ob.score) return mergeTarget;
      if (mergeTarget) {
        mergeTarget.status = "expired";
        mergeTarget.endIndex = confirmedIndex;
        mergeTarget.endTime = ob.confirmedTime;
        mergeTarget.metadata.replacedBy = ob.id;
      }

      this.orderBlocks.push(ob);
      this._addDebug("anchor", originIndex, ob.direction, ob.direction === "bullish" ? ob.low : ob.high, { orderBlockId: ob.id });
      this.emit("created", { ...ob, metadata: { ...ob.metadata } });
      return ob;
    }

    _updateLifecycle(index) {
      const candle = this.candles[index];
      const atr = this.atr[index] || 0;
      for (const ob of this.orderBlocks) {
        if (["invalidated", "expired"].includes(ob.status) || index <= ob.confirmedIndex) continue;
        if (index - ob.confirmedIndex > this.config.maxActiveBars) {
          ob.status = "expired";
          ob.endIndex = index;
          ob.endTime = candle.time;
          this.emit("expired", { ...ob });
          continue;
        }

        const buffer = this.config.invalidationBufferATR * atr;
        const invalidationValue = this.config.invalidationMode === "wick"
          ? (ob.direction === "bullish" ? candle.low : candle.high)
          : candle.close;
        const invalidated = ob.direction === "bullish"
          ? invalidationValue < ob.low - buffer
          : invalidationValue > ob.high + buffer;
        if (invalidated) {
          ob.status = "invalidated";
          ob.invalidatedIndex = index;
          ob.invalidatedTime = candle.time;
          ob.endIndex = index;
          ob.endTime = candle.time;
          ob.metadata.inside = false;
          this.emit("invalidated", { ...ob });
          continue;
        }

        const intersects = candle.high >= ob.low && candle.low <= ob.high;
        if (intersects && !ob.metadata.inside) {
          ob.metadata.touchCount += 1;
          if (ob.status === "active") ob.status = "touched";
          this.emit("touched", { ...ob });
        }
        ob.metadata.inside = intersects;

        const mitigated = this.config.mitigationMode === "midpoint" && (
          ob.direction === "bullish" ? candle.low <= ob.midpoint : candle.high >= ob.midpoint
        );
        if (mitigated && ob.status !== "mitigated") {
          ob.status = "mitigated";
          ob.mitigatedIndex = index;
          ob.mitigatedTime = candle.time;
          this.emit("mitigated", { ...ob });
        }
      }
    }
  }

  return {
    DEFAULT_ORDER_BLOCK_CONFIG,
    OrderBlockEngine,
    detectDisplacement,
    findOrigin,
    isSwingHigh,
    isSwingLow,
    overlapRatio,
    trueRange,
    zoneFromCandle,
  };
});
