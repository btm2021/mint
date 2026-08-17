// ============================================================
// snd-zone-detector.js — DETECTOR SUPPLY & DEMAND
// Port trung thành detectZones() của ForexFlow (Base Isolation Technique):
//
//   LEG-IN → BASE → LEG-OUT (EXPLOSIVE) → FORMATION → ZONE
//
// Hai pass quét:
//   Pass 1 — leg-first: quét phải→trái, mỗi nến LEG tìm explosive move
//            rồi tách base ngay trước nó.
//   Pass 2 — displacement: quét trái→phải trên các cluster BASE, đo độ
//            rời giá sau cluster (bắt các move nhiều nến vừa không phải LEG).
//
// Zones sau đó được chấm điểm, lọc theo minScore và dedup overlap.
// ============================================================

// Formation từ hướng leg-in + leg-out:
//   drop  + rally = DBR (demand)
//   rally + rally = RBR (demand)
//   rally + drop  = RBD (supply)
//   drop  + drop  = DBD (supply)
function sndDetermineFormation(legInBullish, legOutBullish) {
  if (!legInBullish && legOutBullish) return { formation: "DBR", type: "demand" };
  if (legInBullish && legOutBullish) return { formation: "RBR", type: "demand" };
  if (legInBullish && !legOutBullish) return { formation: "RBD", type: "supply" };
  return { formation: "DBD", type: "supply" };
}

// Proximal/distal CHỈ từ các nến BASE (không lấy toàn bộ rally/drop).
//   Demand: proximal = body edge cao nhất, distal = wick thấp nhất
//   Supply: proximal = body edge thấp nhất, distal = wick cao nhất
function sndPlaceLines(zoneType, baseCandles) {
  if (baseCandles.length === 0) return null;

  let proximal, distal;
  if (zoneType === "demand") {
    proximal = -Infinity;
    distal = Infinity;
    for (const c of baseCandles) {
      proximal = Math.max(proximal, Math.max(c.open, c.close));
      distal = Math.min(distal, c.low);
    }
  } else {
    proximal = Infinity;
    distal = -Infinity;
    for (const c of baseCandles) {
      proximal = Math.min(proximal, Math.min(c.open, c.close));
      distal = Math.max(distal, c.high);
    }
  }

  if (proximal === distal) return null;
  if (zoneType === "demand" && proximal <= distal) return null;
  if (zoneType === "supply" && proximal >= distal) return null;

  return { proximal, distal };
}

// Quét ngược chuỗi nến LEG cùng hướng trước base → leg-in run.
function sndFindLegInRun(classified, legInIdx) {
  let startIdx = legInIdx;
  const dir = classified[legInIdx].isBullish;
  for (let i = legInIdx - 1; i >= 0; i--) {
    const c = classified[i];
    if (c.classification !== "leg" || c.isBullish !== dir) break;
    startIdx = i;
  }
  return { startIndex: startIdx, endIndex: legInIdx, candles: classified.slice(startIdx, legInIdx + 1) };
}

function sndZoneId(symbol, timeframe, formation, baseStartTime) {
  return `${symbol}_${timeframe}_${formation}_${baseStartTime}`;
}

function sndBuildCandidate(move, base, direction, classified, config, atrValues, opts) {
  const legInCandle = classified[base.legInIdx];
  const legInRun = sndFindLegInRun(classified, base.legInIdx);
  const { formation, type } = sndDetermineFormation(legInCandle.isBullish, direction === "up");

  // Lọc formation theo danh sách cho phép (mặc định RBR + DBD)
  if (!opts.formations.includes(formation)) {
    return { rejected: true, reason: "FORMATION_DISABLED", formation };
  }

  const lines = sndPlaceLines(type, base.candles);
  if (!lines) return { rejected: true, reason: "INVALID_LINES", formation };

  const zoneWidth = Math.abs(lines.proximal - lines.distal);
  const localAtr = atrValues[base.endIdx] ?? atrValues[atrValues.length - 1] ?? 0;

  // Width filter: zone quá rộng so với ATR cục bộ → reject
  const maxBaseWidthAtr = config.maxBaseWidthAtr ?? 1.5;
  if (localAtr > 0 && zoneWidth > localAtr * maxBaseWidthAtr) {
    return { rejected: true, reason: "BASE_TOO_WIDE", formation, baseWidthATR: zoneWidth / localAtr };
  }

  // Move-out extreme & distance
  let moveOutExtreme;
  if (type === "demand") {
    moveOutExtreme = -Infinity;
    for (let i = move.startIdx; i <= move.endIdx; i++) moveOutExtreme = Math.max(moveOutExtreme, classified[i].high);
  } else {
    moveOutExtreme = Infinity;
    for (let i = move.startIdx; i <= move.endIdx; i++) moveOutExtreme = Math.min(moveOutExtreme, classified[i].low);
  }
  const moveDistance = type === "demand" ? moveOutExtreme - lines.proximal : lines.proximal - moveOutExtreme;
  const moveATR = localAtr > 0 ? moveDistance / localAtr : 0;
  const moveOutMultiple = zoneWidth > 0 ? moveDistance / zoneWidth : 0;

  // Hard filter: departure phải thật sự explosive (≥ minMoveOutMultiple × zone width)
  if (moveOutMultiple < config.minMoveOutMultiple) {
    return { rejected: true, reason: "DEPARTURE_TOO_WEAK", formation, moveOutMultiple };
  }

  return {
    rejected: false,
    candidate: {
      formation,
      type,
      proximal: lines.proximal,
      distal: lines.distal,
      base: {
        startIndex: base.startIdx,
        endIndex: base.endIdx,
        candles: base.candles.length,
        width: zoneWidth,
        widthATR: localAtr > 0 ? zoneWidth / localAtr : 0,
      },
      legIn: {
        index: base.legInIdx,
        startIndex: legInRun.startIndex,
        endIndex: legInRun.endIndex,
        candles: legInRun.candles.length,
        direction: legInCandle.isBullish ? "up" : "down",
        bodyVsAtr: legInCandle.bodyVsAtr,
        bodyRatio: legInCandle.bodyRatio,
      },
      legOut: {
        startIndex: move.startIdx,
        endIndex: move.endIdx,
        candles: move.endIdx - move.startIdx + 1,
        direction,
        legCandles: move.consecutiveLegs,
        move: moveDistance,
        moveATR,
        moveOutMultiple,
      },
    },
  };
}

// ─── API chính ───────────────────────────────────────────────
// detectSupplyDemandZones(candles, config, opts)
//   candles: [{ time, open, high, low, close, volume }]
//   config : sndBuildAlgorithmConfig() → { preset..., maxBaseWidthAtr }
//   opts   : { symbol, timeframe, formations, minScore, debug }
// returns  : { zones, classifiedCandles, atrValues, debug }
function detectSupplyDemandZones(candles, config, opts = {}) {
  const symbol = opts.symbol || "";
  const timeframe = opts.timeframe || "";
  const formations = opts.formations || ["RBR", "DBD"];
  const minScore = opts.minScore ?? 70;
  const debug = !!opts.debug;

  const empty = { zones: [], classifiedCandles: [], atrValues: [], debug: { candidates: [], rejections: [], accepted: [] } };
  if (candles.length < config.atrPeriod + 3) return empty;

  const classified = sndClassifyCandles(candles, config);
  const atrValues = sndComputeATR(candles, config.atrPeriod);

  const candidates = [];
  const usedIndices = new Set();
  const debugCandidates = [];
  const debugRejections = [];
  const reject = (payload) => {
    if (debug) debugRejections.push(payload);
    return { rejected: true, ...payload };
  };

  // Helper tạo candidate từ move + base
  const tryAddCandidate = (move, base, direction) => {
    const result = sndBuildCandidate(move, base, direction, classified, config, atrValues, {
      formations,
      debug,
    });
    if (result.rejected) {
      if (debug) debugCandidates.push({ direction, baseStart: base.startIdx, baseEnd: base.endIdx, ...result });
      return false;
    }
    const cand = result.candidate;
    candidates.push(cand);
    for (let j = base.legInIdx; j <= move.endIdx; j++) usedIndices.add(j);
    if (debug) debugCandidates.push({ direction, baseStart: base.startIdx, baseEnd: base.endIdx, accepted: true, formation: cand.formation, candidate: cand });
    return true;
  };

  // ── Pass 1: Leg-first scan (phải → trái) ──────────────────
  for (let i = classified.length - 1; i >= config.atrPeriod + 2; i--) {
    if (usedIndices.has(i)) continue;
    const c = classified[i];
    if (c.classification !== "leg") continue;

    const direction = c.isBullish ? "up" : "down";
    const move = sndDetectExplosiveMove(classified, i, direction, config.minLegCandles);
    if (!move.isExplosive) {
      if (debug) debugCandidates.push({ type: "leg-scan", index: i, rejected: true, reason: "MOVE_NOT_EXPLOSIVE", direction, legCandles: move.consecutiveLegs });
      continue;
    }
    const base = sndFindBaseCluster(classified, move.startIdx, config.maxBaseCandles);
    if (!base) {
      if (debug) debugCandidates.push({ type: "leg-scan", index: i, rejected: true, reason: "BASE_NOT_FOUND", direction });
      continue;
    }
    tryAddCandidate(move, base, direction);
  }

  // ── Pass 2: Displacement-based scan (trái → phải) ──────────
  // Bắt các move gồm nhiều nến vừa (không riêng lẻ đủ điều kiện LEG)
  // nhưng cộng lại tạo displacement rõ ràng sau một cluster base.
  const MIN_DISPLACEMENT_ATR = 1.5;

  for (let i = config.atrPeriod + 1; i < classified.length - 2; i++) {
    if (usedIndices.has(i)) continue;
    const c = classified[i];
    if (c.classification !== "base") continue;

    let clusterEnd = i;
    for (let j = i + 1; j < classified.length && clusterEnd - i + 1 < config.maxBaseCandles; j++) {
      if (usedIndices.has(j)) break;
      if (classified[j].classification !== "base") break;
      clusterEnd = j;
    }

    const baseLength = clusterEnd - i + 1;
    if (baseLength > config.maxBaseCandles) {
      i = clusterEnd;
      continue;
    }

    const legInIdx = i - 1;
    if (legInIdx < config.atrPeriod || usedIndices.has(legInIdx)) continue;
    const legIn = classified[legInIdx];
    if (legIn.bodyVsAtr < 0.5 || legIn.bodyRatio < 0.3) continue;

    const legOutStart = clusterEnd + 1;
    if (legOutStart >= classified.length) continue;

    const localAtr = atrValues[clusterEnd] ?? atrValues[atrValues.length - 1] ?? 0;
    if (localAtr === 0) continue;
    const minDisplacement = localAtr * MIN_DISPLACEMENT_ATR;

    const baseCandles = classified.slice(i, clusterEnd + 1);
    const baseHigh = Math.max(...baseCandles.map((bc) => bc.high));
    const baseLow = Math.min(...baseCandles.map((bc) => bc.low));

    let maxUpDisp = 0, upEndIdx = legOutStart;
    for (let j = legOutStart; j < Math.min(legOutStart + 5, classified.length); j++) {
      if (usedIndices.has(j)) break;
      const high = classified[j].high;
      if (high - baseHigh > maxUpDisp) { maxUpDisp = high - baseHigh; upEndIdx = j; }
    }
    let maxDownDisp = 0, downEndIdx = legOutStart;
    for (let j = legOutStart; j < Math.min(legOutStart + 5, classified.length); j++) {
      if (usedIndices.has(j)) break;
      const low = classified[j].low;
      if (baseLow - low > maxDownDisp) { maxDownDisp = baseLow - low; downEndIdx = j; }
    }

    if (maxUpDisp >= minDisplacement && maxUpDisp >= maxDownDisp) {
      const base = { legInIdx, startIdx: i, endIdx: clusterEnd, candles: baseCandles };
      const move = { startIdx: legOutStart, endIdx: upEndIdx, consecutiveLegs: 1 };
      if (tryAddCandidate(move, base, "up")) { i = clusterEnd; continue; }
    }
    if (maxDownDisp >= minDisplacement && maxDownDisp > maxUpDisp) {
      const base = { legInIdx, startIdx: i, endIdx: clusterEnd, candles: baseCandles };
      const move = { startIdx: legOutStart, endIdx: downEndIdx, consecutiveLegs: 1 };
      if (tryAddCandidate(move, base, "down")) { i = clusterEnd; continue; }
    }
  }

  // ── Score: cần opposing zones nên quét 2 pass ──────────────
  const demandCandidates = candidates.filter((z) => z.type === "demand");
  const supplyCandidates = candidates.filter((z) => z.type === "supply");

  const allZones = [];
  for (const cand of candidates) {
    const opposing = cand.type === "demand" ? supplyCandidates : demandCandidates;
    const { scores, score, testCount, penetrationPercent } = sndScoreZone(cand, classified, opposing, config);
    cand.score = score; // expose cho debug output

    const freshness = sndComputeFreshness(cand.type, cand.proximal, cand.distal, classified, cand.legOut.endIndex + 1);

    if (score < minScore) {
      if (debug) debugRejections.push({ formation: cand.formation, reason: "BELOW_MIN_SCORE", score, baseStartIndex: cand.base.startIndex });
      continue;
    }

    allZones.push({
      id: sndZoneId(symbol, timeframe, cand.formation, classified[cand.base.startIndex].time),
      symbol,
      timeframe,
      formation: cand.formation,
      type: cand.type,
      proximal: cand.proximal,
      distal: cand.distal,
      base: { ...cand.base, startTime: classified[cand.base.startIndex].time, endTime: classified[cand.base.endIndex].time },
      legIn: cand.legIn,
      legOut: cand.legOut,
      status: freshness.status,
      testCount,
      penetrationPercent,
      score,
      scores,
      createdAt: classified[cand.legOut.endIndex].time,
      invalidatedAt: freshness.invalidatedAt,
      invalidatedIndex: freshness.invalidatedIndex,
    });
  }

  // ── Dedup: 2 zone CÙNG FORMATION chồng lấn > 20% → giữ zone score cao hơn ──
  const deduped = [];
  const sorted = [...allZones].sort((a, b) => b.score - a.score || a.base.startIndex - b.base.startIndex);
  for (const zone of sorted) {
    const isDuplicate = deduped.some(
      (accepted) =>
        accepted.formation === zone.formation &&
        Math.abs(accepted.base.startIndex - zone.base.startIndex) <= Math.max(config.maxBaseCandles, 4) &&
        sndZonesOverlap(accepted, zone) > 0.2,
    );
    if (isDuplicate) {
      if (debug) debugRejections.push({ formation: zone.formation, reason: "DEDUP_OVERLAP", score: zone.score, baseStartIndex: zone.base.startIndex });
      continue;
    }
    deduped.push(zone);
  }

  // Sắp theo thời gian tạo (mới nhất trước) rồi theo score
  deduped.sort((a, b) => b.createdAt - a.createdAt || b.score - a.score);

  return {
    zones: deduped,
    classifiedCandles: classified,
    atrValues,
    debug: { candidates: debugCandidates, rejections: debugRejections },
  };
}

// ─── Detector có trạng thái cho realtime ────────────────────
// Chỉ chạy detection trên CLOSED candles (lastClosedIndex). Candle realtime
// đang chạy chỉ cập nhật buffer + chart, KHÔNG được dùng để xác nhận formation.
class SupplyDemandDetector {
  constructor(opts = {}) {
    this.symbol = opts.symbol || "";
    this.timeframe = opts.timeframe || "";
    this.formations = opts.formations || ["RBR", "DBD"];
    this.minScore = opts.minScore ?? 70;
    this.debug = !!opts.debug;
    this.config = opts.config || {};
    this.candles = [];
    this.zones = [];
    this.classified = [];
    this.lastDebug = { candidates: [], rejections: [] };
    this.lastClosedIndex = -1;
  }

  setSymbol(symbol) { this.symbol = symbol; }
  setTimeframe(tf) { this.timeframe = tf; }

  // Full scan (lúc load historical data — mọi nến đều đã đóng)
  detect(candles) {
    this.candles = candles.slice();
    this.lastClosedIndex = this.candles.length - 1;
    return this._run();
  }

  // Re-detect trên dữ liệu hiện tại (chỉ dùng phần closed) — dùng khi
  // user đổi preset/minScore/formations.
  reDetect() {
    return this._run();
  }

  // Cập nhật nến realtime đang chạy (không re-detect)
  updateCandle(candle) {
    if (this.candles.length === 0) return;
    const last = this.candles[this.candles.length - 1];
    if (last.time === candle.time) {
      this.candles[this.candles.length - 1] = candle;
    } else {
      this.candles.push(candle);
      this.lastClosedIndex = this.candles.length - 2;
    }
  }

  // Nến đã ĐÓNG → append + incremental scan
  onCandleClosed(candle) {
    if (this.candles.length > 0) {
      const last = this.candles[this.candles.length - 1];
      if (last.time === candle.time) this.candles[this.candles.length - 1] = candle;
      else this.candles.push(candle);
    } else {
      this.candles.push(candle);
    }
    this.lastClosedIndex = this.candles.length - 1;
    return this._run();
  }

  _run() {
    const closed = this.lastClosedIndex >= 0 ? this.candles.slice(0, this.lastClosedIndex + 1) : this.candles;
    const result = detectSupplyDemandZones(closed, this.config, {
      symbol: this.symbol,
      timeframe: this.timeframe,
      formations: this.formations,
      minScore: this.minScore,
      debug: this.debug,
    });
    this.zones = result.zones;
    this.classified = result.classifiedCandles;
    this.lastDebug = result.debug;
    return result;
  }

  getZones() {
    return this.zones;
  }
}