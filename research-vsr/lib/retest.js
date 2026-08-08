import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const fmtTime = (t) => new Date(t * 1000).toISOString().slice(0, 16).replace("T", " ");
const pct = (x, total) => (total ? `${((100 * x) / total).toFixed(1)}%` : "-");

function avgVolume(bars, idx, windowSize = 20) {
  const start = Math.max(0, idx - windowSize);
  if (idx - start < 1) return NaN;
  let sum = 0, count = 0;
  for (let i = start; i < idx; i++) { sum += bars[i].volume; count++; }
  return count ? sum / count : NaN;
}

// Phân loại kết quả của một lần test (chạm) zone trong K nến:
// - THROUGH: giá đóng xuyên qua zone sang phía bên kia (zone thất bại — "xuyên qua")
// - BOUNCE : giá đóng văng ra phía tiếp cận (zone giữ — "đỡ trên/đỡ dưới", bật mạnh)
// - HELD   : chưa xuyên qua nhưng cũng chưa bật rõ trong K nến
function classify(bars, T, approach, upper, lower, K, n) {
  const endScan = Math.min(n - 1, T + K);
  const cT = bars[T].close;
  let outcome = null;
  let resolvedIdx = null;
  if (approach === "ABOVE" && cT < lower) { outcome = "THROUGH"; resolvedIdx = T; }
  else if (approach === "BELOW" && cT > upper) { outcome = "THROUGH"; resolvedIdx = T; }
  if (!outcome) {
    for (let i = T + 1; i <= endScan; i++) {
      const c = bars[i].close;
      if (approach === "ABOVE") {
        if (c < lower) { outcome = "THROUGH"; resolvedIdx = i; break; }
        if (c > upper) { outcome = "BOUNCE"; resolvedIdx = i; break; }
      } else {
        if (c > upper) { outcome = "THROUGH"; resolvedIdx = i; break; }
        if (c < lower) { outcome = "BOUNCE"; resolvedIdx = i; break; }
      }
    }
  }
  if (!outcome) outcome = "HELD";

  // Đo độ xa sau sự kiện quyết định (bounce đi xa bao nhiêu / xuyên qua sâu bao nhiêu)
  let ext = 0;
  const extEnd = Math.min(n - 1, (resolvedIdx ?? T) + K);
  for (let i = T + 1; i <= extEnd; i++) {
    const b = bars[i];
    if (approach === "ABOVE") ext = Math.max(ext, outcome === "THROUGH" ? lower - b.low : b.high - upper);
    else ext = Math.max(ext, outcome === "THROUGH" ? b.high - upper : lower - b.low);
  }
  return { outcome, resolvedIdx, ext };
}

// Phân tích LẦN TEST ĐẦU TIÊN của từng zone:
// - approach = ABOVE (giá từ trên đi xuống chạm zone → zone đóng vai trò HỖ TRỢ/đáy)
// - approach = BELOW (giá từ dưới đi lên chạm zone → zone đóng vai trò KHÁNG CỰ/đỉnh)
// - NO_TEST: zone tồn tại trọn đời mà giá chưa từng chạm lại
export function analyseZoneTests(bars, zones, trend, Ks = [8, 24], contextWindow = 20) {
  const n = bars.length;
  const rows = [];

  for (let zi = 0; zi < zones.length; zi++) {
    const zone = zones[zi];
    const start = zone.startIndex;
    const end = Math.min(zone.endIndex, n - 1);
    const upper = zone.upper;
    const lower = zone.lower;
    if (!(upper > lower)) continue;
    if (start >= n - 2) continue;

    // Context: zone nằm ở vị trí nào trong 20 nến TRƯỚC khi tạo (đáy/đỉnh/giữa biên độ)
    const wStart = Math.max(0, start - contextWindow);
    let minLow = Infinity, maxHigh = -Infinity;
    for (let i = wStart; i < start; i++) {
      if (bars[i].low < minLow) minLow = bars[i].low;
      if (bars[i].high > maxHigh) maxHigh = bars[i].high;
    }
    const range = maxHigh - minLow;
    let ctx = "MIDDLE";
    if (range > 0) {
      const nearBottom = lower <= minLow + range * 0.2;
      const nearTop = upper >= maxHigh - range * 0.2;
      if (nearBottom && !nearTop) ctx = "BOTTOM";
      else if (nearTop && !nearBottom) ctx = "TOP";
    }

    const cs = bars[start].close;
    const firstMove = cs > upper ? "UP" : cs < lower ? "DOWN" : "IN";

    const base = {
      zoneId: zi,
      startTime: fmtTime(bars[start].time),
      endTime: fmtTime(bars[end].time),
      startIndex: start,
      upper: +upper.toFixed(6),
      lower: +lower.toFixed(6),
      widthPct: +(((upper - lower) / cs) * 100).toFixed(3),
      merges: zone.merges,
      triggerSignal: +zone.triggerSignal.toFixed(2),
      firstMove,
      ctx,
      truncated: zone.endIndex === n - 1,
    };

    // Tìm lần chạm đầu tiên: nến overlap zone sau khi giá đã nằm ngoài zone
    let T = -1;
    for (let i = start + 1; i <= end; i++) {
      const prevInside = bars[i - 1].close >= lower && bars[i - 1].close <= upper;
      if (prevInside) continue;
      if (bars[i].high >= lower && bars[i].low <= upper) { T = i; break; }
    }
    if (T === -1) {
      rows.push({ ...base, outcome: "NO_TEST", outcome8: "NO_TEST", outcome24: "NO_TEST" });
      continue;
    }

    const approach = bars[T - 1].close > upper ? "ABOVE" : "BELOW";

    // Khoảng cách giá chạy xa nhất trước khi quay lại (độ hồi)
    let maxDist = 0;
    const refPrice = approach === "ABOVE" ? upper : lower;
    for (let i = start; i < T; i++) {
      const d = approach === "ABOVE" ? bars[i].close - upper : lower - bars[i].close;
      if (d > maxDist) maxDist = d;
    }

    const row = {
      ...base,
      touchIdx: T,
      touchTime: fmtTime(bars[T].time),
      approach,
      ageAtTest: T - start,
      distAwayPct: +((maxDist / refPrice) * 100).toFixed(2),
      volRatio: +((bars[T].volume / avgVolume(bars, T)) || 0).toFixed(2),
      testSpreadPct: +(((bars[T].high - bars[T].low) / bars[T].close) * 100).toFixed(3),
      trendAt: trend[T],
    };

    for (const K of Ks) {
      const r = classify(bars, T, approach, upper, lower, K, n);
      const basePx = approach === "ABOVE" ? upper : lower;
      row[`outcome${K}`] = r.outcome;
      row[`resolvedIdx${K}`] = r.resolvedIdx ?? "";
      row[`ext${K}Pct`] = +((r.ext / basePx) * 100).toFixed(3);
    }
    rows.push(row);
  }
  return rows;
}

export function countOutcomes8(rows) {
  const c = { THROUGH: 0, BOUNCE: 0, HELD: 0, NO_TEST: 0 };
  for (const r of rows) c[r.outcome8] = (c[r.outcome8] || 0) + 1;
  return c;
}

export function bucketTable(rows, bucketFn, labels) {
  const groups = labels.map((label) => ({ label, rows: [] }));
  for (const r of rows) {
    const idx = bucketFn(r);
    if (idx >= 0 && idx < groups.length) groups[idx].rows.push(r);
  }
  return groups.map((g) => {
    const c = countOutcomes8(g.rows);
    const total = g.rows.length;
    return {
      label: g.label, total, rows: g.rows,
      pThr: pct(c.THROUGH, total), pBnc: pct(c.BOUNCE, total), pHeld: pct(c.HELD, total),
    };
  });
}

export function ruleEval(rows, label, pred) {
  const matched = rows.filter(pred.cond);
  const total = matched.length;
  if (!total) return null;
  const c = countOutcomes8(matched);
  const hit = c[pred.dir];
  const opp = pred.dir === "THROUGH" ? "BOUNCE" : "THROUGH";
  return {
    label, total,
    hitRate: pct(hit, total), oppRate: pct(c[opp], total), heldRate: pct(c.HELD, total),
  };
}

export function writeCsv(file, rows) {
  if (!rows.length) return;
  mkdirSync(dirname(file), { recursive: true });
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(headers.map((h) => {
      const v = r[h];
      if (v === "" || v === null || v === undefined) return "";
      if (typeof v === "boolean") return v ? "true" : "false";
      return String(v);
    }).join(","));
  }
  writeFileSync(file, lines.join("\n"), "utf8");
}
