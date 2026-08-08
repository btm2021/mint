import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const K_SHORT = 8;  // 2h với timeframe 15m
export const K_LONG = 24;  // 6h với timeframe 15m

const fmtTime = (t) => new Date(t * 1000).toISOString().slice(0, 16).replace("T", " ");
const pct = (x, total) => (total ? `${((100 * x) / total).toFixed(1)}%` : "-");

function avgVolume(bars, idx, windowSize = 20) {
  const start = Math.max(0, idx - windowSize);
  if (idx - start < 1) return NaN;
  let sum = 0, count = 0;
  for (let i = start; i < idx; i++) {
    sum += bars[i].volume;
    count++;
  }
  return count ? sum / count : NaN;
}

// Phân tích vòng đời từng zone VSR:
// - BYPASS : giá chưa từng đóng bên trong zone (zone tạo ra nhưng giá đi luôn)
// - UP/DOWN: lần đầu giá đóng phá ra khỏi zone theo hướng nào
// - NONE   : giá vào zone và ở trong cho tới khi zone bị thay thế/hết dữ liệu
export function analyseZones(bars, zones, trend) {
  const n = bars.length;
  const rows = [];

  for (let zi = 0; zi < zones.length; zi++) {
    const zone = zones[zi];
    if (zone.startIndex >= n - 1) continue;
    const start = zone.startIndex;
    const end = Math.min(zone.endIndex, n - 1);
    const upper = zone.upper;
    const lower = zone.lower;
    if (!(upper > lower)) continue;

    let firstEntry = -1;
    let firstExit = -1;
    let firstExitDir = "";
    let insideRuns = 0;
    let insideBars = 0;
    let prevInside = false;

    for (let i = start; i <= end; i++) {
      const c = bars[i].close;
      const inside = c >= lower && c <= upper;
      if (inside) {
        insideBars++;
        if (firstEntry === -1) firstEntry = i;
        if (!prevInside) insideRuns++;
        prevInside = true;
      } else {
        if (firstEntry !== -1 && firstExit === -1) {
          firstExit = i;
          firstExitDir = c > upper ? "UP" : "DOWN";
          break;
        }
        prevInside = false;
      }
    }

    let outcome, exitIdx, exitDir, decisionIdx;
    if (firstEntry === -1) {
      outcome = "BYPASS";
      exitIdx = undefined;
      decisionIdx = undefined;
    } else if (firstExit === -1) {
      outcome = "NONE";
      exitIdx = undefined;
      decisionIdx = end;
    } else {
      outcome = firstExitDir;
      exitIdx = firstExit;
      decisionIdx = firstExit - 1;
    }

    // Features tại nến quyết định (nến trong zone cuối cùng trước khi thoát)
    let pos = null, age = null, trendAt = null, volRatio = null, wickPoked = null, widthPct = null;
    if (decisionIdx !== undefined) {
      const d = bars[decisionIdx];
      widthPct = ((upper - lower) / d.close) * 100;
      pos = widthPct > 0 ? Math.min(1, Math.max(0, (d.close - lower) / (upper - lower))) : 0.5;
      age = decisionIdx - start;
      trendAt = trend[decisionIdx];
      volRatio = d.volume / avgVolume(bars, decisionIdx);
      wickPoked = false;
      for (let i = start; i <= decisionIdx; i++) {
        if (bars[i].high > upper || bars[i].low < lower) { wickPoked = true; break; }
      }
    }

    // Chất lượng breakout: giá đi xa bao nhiêu và có quay lại zone không
    let extShort = null, extLong = null, revertedShort = null, revertedLong = null;
    if (exitIdx !== undefined) {
      const base = exitDir === "UP" ? upper : lower;
      const endIdx = Math.min(n - 1, exitIdx + K_LONG);
      let maxExtS = 0, maxExtL = 0, revS = false, revL = false;
      for (let i = exitIdx + 1; i <= endIdx; i++) {
        const b = bars[i];
        const ext = exitDir === "UP" ? b.high - upper : lower - b.low;
        if (i - exitIdx <= K_SHORT) maxExtS = Math.max(maxExtS, ext);
        maxExtL = Math.max(maxExtL, ext);
        const backInside = exitDir === "UP" ? b.close <= upper : b.close >= lower;
        if (backInside) {
          if (i - exitIdx <= K_SHORT) revS = true;
          revL = true;
        }
      }
      extShort = (maxExtS / base) * 100;
      extLong = (maxExtL / base) * 100;
      revertedShort = revS;
      revertedLong = revL;
    }

    // Zone kế tiếp nằm đâu so với hướng breakout (kiểm chứng xu hướng tiếp diễn)
    let nextZoneSide = null;
    const nz = zones[zi + 1];
    if (nz) {
      if (nz.lower > upper) nextZoneSide = "ABOVE";
      else if (nz.upper < lower) nextZoneSide = "BELOW";
      else nextZoneSide = "OVERLAP";
    }

    rows.push({
      zoneId: zi,
      startTime: fmtTime(bars[start].time), endTime: fmtTime(bars[end].time),
      startIndex: start, endIndex: end,
      duration: end - start + 1,
      upper: +upper.toFixed(6), lower: +lower.toFixed(6),
      widthPct: +(((upper - lower) / bars[start].close) * 100).toFixed(3),
      merges: zone.merges,
      triggerChange: +zone.triggerChange.toFixed(3),
      triggerSignal: +zone.triggerSignal.toFixed(2),
      outcome,
      insideRuns, insideBars,
      firstEntryIdx: firstEntry === -1 ? "" : firstEntry,
      firstEntryTime: firstEntry === -1 ? "" : fmtTime(bars[firstEntry].time),
      entryLag: firstEntry === -1 ? "" : firstEntry - start,
      decisionIdx: decisionIdx === undefined ? "" : decisionIdx,
      decisionTime: decisionIdx === undefined ? "" : fmtTime(bars[decisionIdx].time),
      decisionClose: decisionIdx === undefined ? "" : +bars[decisionIdx].close.toFixed(6),
      pos: pos === null ? "" : +pos.toFixed(3),
      age: age === null ? "" : age,
      trendAt: trendAt === undefined ? "" : trendAt,
      volRatio: volRatio === null || !Number.isFinite(volRatio) ? "" : +volRatio.toFixed(2),
      wickPoked: wickPoked === null ? "" : wickPoked,
      exitIdx: exitIdx === undefined ? "" : exitIdx,
      exitTime: exitIdx === undefined ? "" : fmtTime(bars[exitIdx].time),
      exitClose: exitIdx === undefined ? "" : +bars[exitIdx].close.toFixed(6),
      extShort: extShort === null ? "" : +extShort.toFixed(2),
      extLong: extLong === null ? "" : +extLong.toFixed(2),
      revertedShort: revertedShort === null ? "" : revertedShort,
      revertedLong: revertedLong === null ? "" : revertedLong,
      nextZoneSide: nextZoneSide || "",
      truncated: zone.endIndex === n - 1,
    });
  }
  return rows;
}

// Snapshot dự đoán sớm: tại L nến sau khi zone hình thành, nếu giá còn trong zone,
// thì lần thoát zone tiếp theo theo hướng nào?
export function lagSnapshots(bars, zones, trend, lags = [1, 4, 12]) {
  const out = [];
  for (const zone of zones) {
    const upper = zone.upper;
    const lower = zone.lower;
    if (!(upper > lower)) continue;
    for (const L of lags) {
      const s = zone.startIndex + L;
      if (s > zone.endIndex) continue;
      const c = bars[s].close;
      if (c < lower || c > upper) continue;
      let exitDir = null;
      for (let i = s + 1; i <= zone.endIndex; i++) {
        const cc = bars[i].close;
        if (cc > upper) { exitDir = "UP"; break; }
        if (cc < lower) { exitDir = "DOWN"; break; }
      }
      let wickPoked = false;
      for (let i = zone.startIndex; i <= s; i++) {
        if (bars[i].high > upper || bars[i].low < lower) { wickPoked = true; break; }
      }
      out.push({
        lag: L,
        pos: ((upper - lower) / c) > 0 ? Math.min(1, Math.max(0, (c - lower) / (upper - lower))) : 0.5,
        trend: trend[s],
        wickPoked,
        outcome: exitDir || "NONE",
        time: fmtTime(bars[s].time),
      });
    }
  }
  return out;
}

export function countOutcomes(rows) {
  const c = { UP: 0, DOWN: 0, NONE: 0, BYPASS: 0 };
  for (const r of rows) c[r.outcome]++;
  return c;
}

export function bucketTable(rows, bucketFn, labels) {
  const groups = labels.map((label) => ({ label, rows: [] }));
  for (const r of rows) {
    const idx = bucketFn(r);
    if (idx >= 0 && idx < groups.length) groups[idx].rows.push(r);
  }
  return groups.map((g) => {
    const c = countOutcomes(g.rows);
    const total = g.rows.length;
    return {
      label: g.label, total,
      pUp: pct(c.UP, total), pDown: pct(c.DOWN, total),
      pNone: pct(c.NONE, total), pBypass: pct(c.BYPASS, total),
    };
  });
}

export function ruleEval(rows, label, pred) {
  const matched = rows.filter(pred.cond);
  const total = matched.length;
  if (!total) return null;
  const c = countOutcomes(matched);
  const hit = c[pred.dir];
  const opp = pred.dir === "UP" ? "DOWN" : "UP";
  return { label, total, hitRate: pct(hit, total), oppRate: pct(c[opp], total), noneRate: pct(c.NONE, total) };
}

// Thống kê tổng ở mức nến: bao nhiêu % thời gian có zone, bao nhiêu % đóng trong zone
export function barLevelStats(bars, uppers, lowers) {
  let zoneBars = 0, insideBars = 0;
  for (let i = 0; i < bars.length; i++) {
    if (Number.isFinite(uppers[i])) {
      zoneBars++;
      if (bars[i].close >= lowers[i] && bars[i].close <= uppers[i]) insideBars++;
    }
  }
  return {
    total: bars.length,
    zoneBars,
    insideBars,
    outsideBars: zoneBars - insideBars,
    pctZoneBars: pct(zoneBars, bars.length),
    pctInsideOfZoneBars: pct(insideBars, zoneBars),
  };
}

const SEP = "-".repeat(96);

export function buildReport({ len, thr, symbol, interval, bars, zones, uppers, lowers, rows, snaps }) {
  const n = bars.length;
  const bls = barLevelStats(bars, uppers, lowers);
  const c = countOutcomes(rows);
  const total = rows.length;

  const withDecision = rows.filter((r) => r.pos !== "");
  const exited = rows.filter((r) => r.outcome === "UP" || r.outcome === "DOWN");
  const c2 = countOutcomes(withDecision);

  const lines = [];
  lines.push(SEP);
  lines.push(`VSR (Length=${len}, Threshold=${thr}) — ${symbol} ${interval}, ${n.toLocaleString()} nến (${fmtTime(bars[0].time)} → ${fmtTime(bars[n - 1].time)})`);
  lines.push(SEP);

  lines.push(`\n[1] TỔNG QUAN ZONE (${total} zone):`);
  lines.push(`  - Nến có zone hoạt động        : ${bls.zoneBars.toLocaleString()} / ${bls.total.toLocaleString()} (${bls.pctZoneBars})`);
  lines.push(`  - Trong đó nến đóng TRONG zone  : ${bls.insideBars.toLocaleString()} (${bls.pctInsideOfZoneBars} của số nến có zone)`);
  lines.push(`  - Tuổi thọ zone TB (nến)        : ${rows.length ? (rows.reduce((a, r) => a + r.duration, 0) / rows.length).toFixed(1) : "-"}`);
  lines.push(`  - Độ rộng zone TB (% giá)       : ${rows.length ? (rows.reduce((a, r) => a + r.widthPct, 0) / rows.length).toFixed(2) + "%" : "-"}`);

  lines.push(`\n[2] KẾT QUẢ VÒNG ĐỜI ZONE (giá đóng phá zone bằng nến đóng cửa):`);
  lines.push(`  UP    (đóng trên upper)   : ${c.UP} (${pct(c.UP, total)})`);
  lines.push(`  DOWN  (đóng dưới lower)   : ${c.DOWN} (${pct(c.DOWN, total)})`);
  lines.push(`  NONE  (ở trong tới khi zone bị thay) : ${c.NONE} (${pct(c.NONE, total)})`);
  lines.push(`  BYPASS (giá chưa từng vào zone)       : ${c.BYPASS} (${pct(c.BYPASS, total)})`);
  lines.push(`  - Trong ${exited.length} zone có breakout: nến TB ở trong zone trước khi breakout = ${exited.length ? (exited.reduce((a, r) => a + r.age + 1, 0) / exited.length).toFixed(1) : "-"}`);

  const upExit = exited.filter((r) => r.outcome === "UP");
  const dnExit = exited.filter((r) => r.outcome === "DOWN");
  lines.push(`\n[3] CHẤT LƯỢNG BREAKOUT (trong ${K_SHORT} nến đầu / ${K_LONG} nến sau khi phá):`);
  lines.push(`  UP breakout  (${upExit.length}): quay lại zone trong 8 nến: ${pct(upExit.filter((r) => r.revertedShort).length, upExit.length)} | trong 24 nến: ${pct(upExit.filter((r) => r.revertedLong).length, upExit.length)} | giá đi xa TB (max): +${upExit.length ? (upExit.reduce((a, r) => a + r.extLong, 0) / upExit.length).toFixed(2) : "-"}%`);
  lines.push(`  DOWN breakout (${dnExit.length}): quay lại zone trong 8 nến: ${pct(dnExit.filter((r) => r.revertedShort).length, dnExit.length)} | trong 24 nến: ${pct(dnExit.filter((r) => r.revertedLong).length, dnExit.length)} | giá đi xa TB (max): -${dnExit.length ? (dnExit.reduce((a, r) => a + r.extLong, 0) / dnExit.length).toFixed(2) : "-"}%`);

  const nextSide = (dir, side) => exited.filter((r) => r.outcome === dir && r.nextZoneSide === side).length;
  lines.push(`\n[4] KIỂM CHỨC XU HƯỚNG QUA ZONE KẾ TIẾP (zone mới nằm đâu so với zone cũ):`);
  lines.push(`  Sau breakout UP   : zone kế tiếp ABOVE ${nextSide("UP", "ABOVE")} (${pct(nextSide("UP", "ABOVE"), upExit.length)}), BELOW ${nextSide("UP", "BELOW")}, OVERLAP ${nextSide("UP", "OVERLAP")}`);
  lines.push(`  Sau breakout DOWN : zone kế tiếp BELOW ${nextSide("DOWN", "BELOW")} (${pct(nextSide("DOWN", "BELOW"), dnExit.length)}), ABOVE ${nextSide("DOWN", "ABOVE")}, OVERLAP ${nextSide("DOWN", "OVERLAP")}`);

  lines.push(`\n[5] DỰ ĐOÁN HƯỚNG BREAKOUT — điểm quyết định = nến trong zone cuối cùng (${withDecision.length} mẫu, base rate: UP ${pct(c2.UP, withDecision.length)}, DOWN ${pct(c2.DOWN, withDecision.length)}, NONE ${pct(c2.NONE, withDecision.length)}):`);
  lines.push(`  ${"Nhóm".padEnd(22)} ${"N".padStart(6)} ${"P(UP)".padStart(8)} ${"P(DOWN)".padStart(8)} ${"P(NONE)".padStart(8)} ${"P(BYPASS)".padStart(9)}`);
  for (const g of bucketTable(withDecision, (r) => (r.pos < 0.34 ? 0 : r.pos > 0.66 ? 1 : 2), ["pos: đáy zone (<0.34)", "pos: giữa zone", "pos: đỉnh zone (>0.66)"])) {
    lines.push(`  ${g.label.padEnd(22)} ${String(g.total).padStart(6)} ${g.pUp.padStart(8)} ${g.pDown.padStart(8)} ${g.pNone.padStart(8)} ${g.pBypass.padStart(9)}`);
  }
  for (const g of bucketTable(withDecision, (r) => (r.trendAt === 1 ? 0 : 1), ["ATRBOT trend: UPTREND", "ATRBOT trend: DOWNTREND"])) {
    lines.push(`  ${g.label.padEnd(22)} ${String(g.total).padStart(6)} ${g.pUp.padStart(8)} ${g.pDown.padStart(8)} ${g.pNone.padStart(8)} ${g.pBypass.padStart(9)}`);
  }
  for (const g of bucketTable(withDecision, (r) => (r.wickPoked === true ? 0 : 1), ["wick đã chọc ra ngoài zone", "wick chưa chọc ra ngoài"])) {
    lines.push(`  ${g.label.padEnd(22)} ${String(g.total).padStart(6)} ${g.pUp.padStart(8)} ${g.pDown.padStart(8)} ${g.pNone.padStart(8)} ${g.pBypass.padStart(9)}`);
  }
  for (const g of bucketTable(withDecision, (r) => (r.age <= 4 ? 0 : r.age <= 12 ? 1 : 2), ["tuổi zone: <=4 nến", "tuổi zone: 5-12 nến", "tuổi zone: >12 nến"])) {
    lines.push(`  ${g.label.padEnd(22)} ${String(g.total).padStart(6)} ${g.pUp.padStart(8)} ${g.pDown.padStart(8)} ${g.pNone.padStart(8)} ${g.pBypass.padStart(9)}`);
  }

  const rules = [
    ["R1: trend UP + giá nửa trên zone → UP", { cond: (r) => r.trendAt === 1 && r.pos >= 0.5, dir: "UP" }],
    ["R2: trend DOWN + giá nửa dưới zone → DOWN", { cond: (r) => r.trendAt === -1 && r.pos <= 0.5, dir: "DOWN" }],
    ["R3: wick chọc ngoài + giá nửa trên → UP", { cond: (r) => r.wickPoked === true && r.pos >= 0.5, dir: "UP" }],
    ["R4: wick chọc ngoài + giá nửa dưới → DOWN", { cond: (r) => r.wickPoked === true && r.pos <= 0.5, dir: "DOWN" }],
    ["R5: trend UP + giá nửa dưới zone → DOWN (ngược)", { cond: (r) => r.trendAt === 1 && r.pos < 0.5, dir: "DOWN" }],
    ["R6: trend DOWN + giá nửa trên zone → UP (ngược)", { cond: (r) => r.trendAt === -1 && r.pos > 0.5, dir: "UP" }],
  ];
  lines.push(`\n[6] ĐÁNH GIÁ LUẬT GIAO DỊCH ĐƠN GIẢN (hit rate = % đúng hướng dự đoán, so với base rate):`);
  lines.push(`  ${"Luật".padEnd(42)} ${"N".padStart(5)} ${"HIT".padStart(8)} ${"Ngược".padStart(8)} ${"NONE".padStart(8)}`);
  for (const [label, pred] of rules) {
    const e = ruleEval(withDecision, label, pred);
    if (!e) continue;
    lines.push(`  ${e.label.padEnd(42)} ${String(e.total).padStart(5)} ${e.hitRate.padStart(8)} ${e.oppRate.padStart(8)} ${e.noneRate.padStart(8)}`);
  }

  lines.push(`\n[7] DỰ ĐOÁN SỚM NGAY KHI ZONE HÌNH THÀNH (L nến sau khi tạo zone, giá còn trong zone):`);
  for (const lag of [1, 4, 12]) {
    const s = snaps.filter((x) => x.lag === lag);
    const cs = countOutcomes(s);
    lines.push(`  L=${String(lag).padStart(2)}: ${s.length} mẫu → UP ${pct(cs.UP, s.length)}, DOWN ${pct(cs.DOWN, s.length)}, NONE ${pct(cs.NONE, s.length)}`);
    const sUp = s.filter((x) => x.pos >= 0.5);
    const sDn = s.filter((x) => x.pos < 0.5);
    const csUp = countOutcomes(sUp);
    const csDn = countOutcomes(sDn);
    if (sUp.length) lines.push(`       - giá nửa trên: UP ${pct(csUp.UP, sUp.length)} / DOWN ${pct(csUp.DOWN, sUp.length)}`);
    if (sDn.length) lines.push(`       - giá nửa dưới: UP ${pct(csDn.UP, sDn.length)} / DOWN ${pct(csDn.DOWN, sDn.length)}`);
  }
  lines.push("");
  return lines.join("\n");
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
