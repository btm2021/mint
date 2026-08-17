// ============================================================
// snd-app.js — BOOTSTRAP + ĐIỀU KHIỂN ỨNG DỤNG SUPPLY & DEMAND
//
// Flow:
//   Binance REST → load historical → detector.detect → render
//   → connect WS: candle đang chạy chỉ update chart;
//                 candle ĐÓNG mới append + incremental detect.
// ============================================================

let sndDetector = null;
let sndAllSymbols = [];
let sndZoneList = [];
let sndDebugLog = [];
let sndCandlesForZones = [];
let sndLastClose = null;

function sndEl(id) {
  return document.getElementById(id);
}

function sndStatus(type, text) {
  const el = sndEl("snd-status");
  if (!el) return;
  if (type === "loading") {
    el.innerHTML = `<span class="snd-loading-spin"></span><span>${text}</span>`;
  } else if (type === "ready") {
    el.innerHTML = `<span class="snd-status-dot"></span><span class="snd-sym-tag">${SND_CFG.symbol}</span><span class="snd-tf-tag">${SND_CFG.interval}</span><span>${text}</span>`;
  } else {
    el.innerHTML = `<span style="color:#ff5252">${text}</span>`;
  }
}

function sndUpdateTicker(price, changePct) {
  const pEl = sndEl("snd-ticker-price");
  const cEl = sndEl("snd-ticker-change");
  if (!pEl || !cEl || !price) return;
  const precision = price >= 10000 ? 1 : price >= 1000 ? 2 : price >= 100 ? 3 : 4;
  const old = parseFloat(pEl.textContent);
  pEl.textContent = price.toFixed(precision);
  pEl.className = old && price > old ? "snd-tick-up" : old && price < old ? "snd-tick-down" : "";
  if (changePct === null || changePct === undefined) {
    if (sndLastClose) changePct = ((price - sndLastClose) / sndLastClose) * 100;
    else changePct = 0;
  }
  sndLastClose = price;
  cEl.textContent = `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`;
  cEl.className = changePct >= 0 ? "snd-badge-up" : "snd-badge-down";
}

// ─── Debug logging ───────────────────────────────────────────
function sndLog(msg) {
  sndDebugLog.unshift(msg);
  if (sndDebugLog.length > 500) sndDebugLog.pop();
  if (SND_CFG.debug) console.log(msg);
  sndRenderDebugPanel();
}

function sndFormatDebug(result) {
  const lines = [];
  for (const d of result.debug.candidates || []) {
    if (d.accepted) {
      const c = d.candidate;
      lines.push(
        `[${c.formation} CANDIDATE]\n` +
        `Base: index ${c.base.startIndex}\u2013${c.base.endIndex}\n` +
        `legIn: ${c.legIn.index}\n` +
        `legOut: ${c.legOut.startIndex}\u2013${c.legOut.endIndex}\n` +
        `baseWidthATR: ${c.base.widthATR.toFixed(2)}\n` +
        `moveOutMultiple: ${c.legOut.moveOutMultiple.toFixed(2)}\n` +
        `status: accepted\n` +
        `score: ${c.score ?? "?"}\n`,
      );
    } else if (d.reason) {
      const r = d;
      lines.push(
        `[${r.formation || (r.type === "leg-scan" ? `LEG-SCAN(${r.direction})` : "?")} REJECTED]\n` +
        `reason: ${r.reason}\n` +
        (r.baseWidthATR !== undefined ? `baseWidthATR: ${r.baseWidthATR.toFixed(2)}\n` : "") +
        (r.score !== undefined ? `score: ${r.score}\n` : "") +
        (r.moveOutMultiple !== undefined ? `moveOutMultiple: ${r.moveOutMultiple.toFixed(2)}\n` : ""),
      );
    }
  }
  for (const r of result.debug.rejections || []) {
    if (r.formation === undefined) continue;
    lines.push(
      `[${r.formation} REJECTED]\n` +
      `reason: ${r.reason}\n` +
      (r.baseWidthATR !== undefined ? `baseWidthATR: ${r.baseWidthATR.toFixed(2)}\n` : "") +
      (r.score !== undefined ? `score: ${r.score}\n` : ""),
    );
  }
  return lines;
}

function sndRenderDebugPanel() {
  const panel = sndEl("snd-debug-body");
  if (!panel) return;
  panel.innerHTML = sndDebugLog.map((l) => `<pre>${l}</pre>`).join("");
}

// ─── Apply detection result ──────────────────────────────────
function sndApplyZones(result, bars) {
  if (bars) sndCandlesForZones = bars;
  const visibleZones = result.zones.filter((z) => {
    if (!SND_CFG.formations[z.formation]) return false;
    if (z.status === "invalidated" && !SND_CFG.showInvalidated) return false;
    if (z.status === "tested" && !SND_CFG.showTested) return false;
    return true;
  });

  sndZoneList = visibleZones;
  sndSetZones(visibleZones, sndCandlesForZones);
  sndSetClassified(result.classifiedCandles);
  sndRedrawOverlay();
  sndRenderZoneList();
  sndRenderLegend(result.zones);

  if (SND_CFG.debug) {
    const lines = sndFormatDebug(result);
    if (lines.length) lines.forEach(sndLog);
    sndLog(`[SCAN] ${result.zones.length} zones accepted (${SND_CFG.symbol} ${SND_CFG.interval} ${SND_CFG.preset})`);
  }

  const fresh = result.zones.filter((z) => z.status === "fresh").length;
  const tested = result.zones.filter((z) => z.status === "tested").length;
  const invalidated = result.zones.filter((z) => z.status === "invalidated").length;
  sndStatus("ready", `${result.zones.length} zones · ${fresh} fresh · ${tested} tested · ${invalidated} invalidated`);
}

// ─── Realtime ────────────────────────────────────────────────
function sndConnectRealtime() {
  sndConnectKlineWS(
    SND_CFG.symbol,
    SND_CFG.interval,
    (bar) => {
      // Candle đang chạy: chỉ update chart + buffer + ticker, KHÔNG detect
      sndUpdateCandle(bar);
      sndDetector.updateCandle(bar);
      sndUpdateTicker(bar.close, null);
      if (sndCandlesForZones.length) {
        const last = sndCandlesForZones[sndCandlesForZones.length - 1];
        if (last.time === bar.time) sndCandlesForZones[sndCandlesForZones.length - 1] = bar;
        else sndCandlesForZones.push(bar);
      }
    },
    (closedBar) => {
      // Nến đã đóng: append + incremental detection
      sndUpdateCandle(closedBar);
      const result = sndDetector.onCandleClosed(closedBar);
      sndCandlesForZones = sndDetector.candles;
      sndApplyZones(result, sndDetector.candles);
    },
  );
}

// ─── Load data ───────────────────────────────────────────────
async function sndLoadSymbol() {
  sndStatus("loading", `Loading ${SND_CFG.symbol} ${SND_CFG.interval}...`);
  try {
    const bars = await sndFetchKlines(SND_CFG.symbol, SND_CFG.interval, SND_CFG.lookback);
    if (!bars.length) {
      sndStatus("error", `No data for ${SND_CFG.symbol}`);
      return;
    }
    sndSetCandles(bars);
    sndCandlesForZones = bars;

    sndDetector.config = sndBuildAlgorithmConfig();
    sndDetector.debug = SND_CFG.debug;
    const result = sndDetector.detect(bars);
    sndApplyZones(result, bars);
    sndConnectRealtime();
  } catch (e) {
    console.error("snd-app: load failed", e);
    sndStatus("error", `Failed to load ${SND_CFG.symbol}: ${e.message}`);
  }
}

// ─── Controls ────────────────────────────────────────────────
function sndSetupControls() {
  // Interval pills
  const pills = sndEl("snd-interval-pills");
  if (pills) {
    SND_INTERVALS.forEach((iv) => {
      const b = document.createElement("button");
      b.className = "snd-iv-btn" + (iv === SND_CFG.interval ? " active" : "");
      b.textContent = iv === "1d" ? "1D" : iv;
      b.dataset.iv = iv;
      b.addEventListener("click", async () => {
        if (iv === SND_CFG.interval) return;
        SND_CFG.interval = iv;
        sndSaveConfig();
        pills.querySelectorAll(".snd-iv-btn").forEach((el) => el.classList.toggle("active", el.dataset.iv === iv));
        await sndLoadSymbol();
      });
      pills.appendChild(b);
    });
  }

  // Preset
  const preset = sndEl("snd-preset-select");
  if (preset) {
    preset.value = SND_CFG.preset;
    preset.addEventListener("change", () => {
      SND_CFG.preset = preset.value;
      sndSaveConfig();
      sndReloadDetection();
    });
  }

  // Min score
  const minScore = sndEl("snd-min-score");
  if (minScore) {
    minScore.value = SND_CFG.minScore;
    minScore.addEventListener("change", () => {
      SND_CFG.minScore = Number(minScore.value) || 70;
      sndSaveConfig();
      sndReloadDetection();
    });
  }

  // Lookback
  const lookback = sndEl("snd-lookback-select");
  if (lookback) {
    lookback.value = String(SND_CFG.lookback);
    lookback.addEventListener("change", async () => {
      SND_CFG.lookback = Number(lookback.value) || 1000;
      sndSaveConfig();
      await sndLoadSymbol();
    });
  }

  // Formation toggles
  ["RBR", "DBD", "RBD", "DBR"].forEach((f) => {
    const el = sndEl(`snd-tf-${f}`);
    if (!el) return;
    el.checked = !!SND_CFG.formations[f];
    el.addEventListener("change", () => {
      SND_CFG.formations[f] = el.checked;
      sndSaveConfig();
      sndReloadDetection();
    });
  });

  // Show tested / invalidated
  const showTested = sndEl("snd-show-tested");
  if (showTested) {
    showTested.checked = SND_CFG.showTested;
    showTested.addEventListener("change", () => {
      SND_CFG.showTested = showTested.checked;
      sndSaveConfig();
      sndReloadRender();
    });
  }
  const showInvalidated = sndEl("snd-show-invalidated");
  if (showInvalidated) {
    showInvalidated.checked = SND_CFG.showInvalidated;
    showInvalidated.addEventListener("change", () => {
      SND_CFG.showInvalidated = showInvalidated.checked;
      sndSaveConfig();
      sndReloadRender();
    });
  }

  // Debug toggle
  const debugToggle = sndEl("snd-debug-toggle");
  if (debugToggle) {
    debugToggle.checked = SND_CFG.debug;
    debugToggle.addEventListener("change", () => {
      SND_CFG.debug = debugToggle.checked;
      sndSaveConfig();
      sndSetDebug(SND_CFG.debug);
      sndEl("snd-debug-panel").classList.toggle("open", SND_CFG.debug);
      if (SND_CFG.debug) {
        sndRenderDebugPanel();
        sndReloadDetection();
      }
      sndRedrawOverlay();
    });
  }

  // Zone info panel close
  const closeInfo = sndEl("snd-zone-info-close");
  if (closeInfo) {
    closeInfo.addEventListener("click", () => {
      sndEl("snd-zone-info").classList.remove("visible");
    });
  }
}

// Re-detect từ candles hiện tại (đổi preset / minScore / formation)
function sndReloadDetection() {
  if (!sndDetector || sndCandlesForZones.length === 0) return;
  sndDetector.config = sndBuildAlgorithmConfig();
  sndDetector.debug = SND_CFG.debug;
  const result = sndDetector.detect(sndCandlesForZones);
  sndApplyZones(result, sndDetector.candles);
}

// Chỉ render lại theo checkbox status (không detect lại)
function sndReloadRender() {
  if (!sndDetector) return;
  sndApplyZones({ zones: sndDetector.getZones(), classifiedCandles: sndDetector.classified, debug: { candidates: [], rejections: [] } }, sndDetector.candles);
}

// ─── Zone list ───────────────────────────────────────────────
function sndRenderZoneList() {
  const list = sndEl("snd-zone-list");
  if (!list) return;
  list.innerHTML = sndZoneList.map((z) => {
    const color = z.type === "demand" ? "#00E676" : "#FF5252";
    return `<div class="snd-zone-row" data-id="${z.id}">
      <span class="snd-zone-f" style="color:${color}">${z.formation}</span>
      <span class="snd-zone-score">${z.score}</span>
      <span class="snd-zone-status ${z.status}">${z.status}</span>
      <span class="snd-zone-prices">${z.proximal.toFixed(2)} / ${z.distal.toFixed(2)}</span>
    </div>`;
  }).join("") || `<div class="snd-zone-empty">No zones match current filters</div>`;

  list.querySelectorAll(".snd-zone-row").forEach((row) => {
    row.addEventListener("click", () => {
      const z = sndZoneList.find((zz) => zz.id === row.dataset.id);
      if (z) sndShowZoneInfo(z);
    });
  });
}

function sndRenderLegend(zones) {
  const el = sndEl("snd-legend");
  if (!el) return;
  const fmt = (f) => {
    const arr = zones.filter((z) => z.formation === f);
    const fresh = arr.filter((z) => z.status === "fresh").length;
    const tested = arr.filter((z) => z.status === "tested").length;
    return `<span class="snd-legend-item ${f === "RBR" || f === "DBR" ? "demand" : "supply"}">
      <i></i>${f}: <b>${fresh}</b><span class="dim">+${tested}</span></span>`;
  };
  el.innerHTML = ["RBR", "DBD", "RBD", "DBR"].filter((f) => SND_CFG.formations[f]).map(fmt).join("");
}

// ─── Zone info (hover / click) ───────────────────────────────
function sndShowZoneInfo(z) {
  const panel = sndEl("snd-zone-info");
  if (!panel) return;
  const color = z.type === "demand" ? "#00E676" : "#FF5252";
  const fmtTime = (t) => t ? new Date(t * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "—";
  panel.innerHTML = `
    <div class="snd-zone-info-head" style="border-color:${color}">
      <span style="color:${color};font-weight:700">${z.formation}</span>
      <span class="snd-zone-score-big">${z.score}</span>
      <button id="snd-zone-info-close" class="snd-zone-info-x">✕</button>
    </div>
    <div class="snd-zone-info-body">
      ${sndInfoRow("Status", `<span class="snd-zone-status ${z.status}">${z.status}</span>`)}
      ${sndInfoRow("Type", z.type)}
      ${sndInfoRow("Proximal", z.proximal.toFixed(2))}
      ${sndInfoRow("Distal", z.distal.toFixed(2))}
      ${sndInfoRow("Base candles", `${z.base.startIndex}\u2013${z.base.endIndex} (${z.base.candles})`)}
      ${sndInfoRow("Base width", `${z.base.width.toFixed(1)} (${z.base.widthATR.toFixed(2)}×ATR)`)}
      ${sndInfoRow("ATR local", z.base.widthATR > 0 ? (z.base.width / z.base.widthATR).toFixed(1) : "—")}
      ${sndInfoRow("Leg-in", `${z.legIn.direction} (${z.legIn.startIndex}\u2013${z.legIn.endIndex})`)}
      ${sndInfoRow("Leg-out", `${z.legOut.direction} · ${z.legOut.candles} candle(s)`)}
      ${sndInfoRow("Departure", `${z.legOut.move.toFixed(1)} · ${z.legOut.moveATR.toFixed(2)}×ATR`)}
      ${sndInfoRow("Move-out mult", `${z.legOut.moveOutMultiple.toFixed(2)}×`)}
      ${sndInfoRow("Test count", z.testCount)}
      ${sndInfoRow("Penetration", `${Math.round(z.penetrationPercent * 100)}%`)}
      ${sndInfoRow("Score breakdown", `S${z.scores.strength.value.toFixed(1)}/2 · T${z.scores.time.value}/1 · F${z.scores.freshness.value}/2`)}
      ${sndInfoRow("Created", fmtTime(z.createdAt))}
      ${sndInfoRow("Invalidated", fmtTime(z.invalidatedAt))}
    </div>`;
  panel.classList.add("visible");
  const closeBtn = panel.querySelector("#snd-zone-info-close");
  if (closeBtn) closeBtn.addEventListener("click", () => panel.classList.remove("visible"));
}

function sndInfoRow(label, value) {
  return `<div class="snd-info-row"><span class="snd-info-label">${label}</span><span class="snd-info-value">${value}</span></div>`;
}

// ─── Symbol search ───────────────────────────────────────────
async function sndSetupSymbolSearch() {
  const input = sndEl("snd-symbol-input");
  const modal = sndEl("snd-symbol-modal");
  const searchInput = sndEl("snd-symbol-search-input");
  const results = sndEl("snd-symbol-results");
  if (!input || !modal) return;

  const open = () => {
    modal.classList.add("open");
    searchInput.value = "";
    render("");
    setTimeout(() => searchInput.focus(), 50);
  };
  const close = () => modal.classList.remove("open");

  function render(q) {
    const query = q.trim().toUpperCase();
    const filtered = query
      ? sndAllSymbols.filter((s) => s.includes(query))
      : sndAllSymbols.slice(0, 200);
    results.innerHTML = filtered.slice(0, 200).map((s) =>
      `<button class="snd-symbol-result" data-sym="${s}">${s}</button>`,
    ).join("") || `<div class="snd-symbol-empty">No match</div>`;

    results.querySelectorAll(".snd-symbol-result").forEach((b) => {
      b.addEventListener("click", async () => {
        const sym = b.dataset.sym;
        if (sym !== SND_CFG.symbol) {
          SND_CFG.symbol = sym;
          sndSaveConfig();
          input.value = sym;
          close();
          await sndLoadSymbol();
        } else {
          close();
        }
      });
    });
  }

  input.value = SND_CFG.symbol;
  input.addEventListener("click", open);
  searchInput.addEventListener("input", (e) => render(e.target.value));
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });
  const closeBtn = sndEl("snd-symbol-modal-close");
  if (closeBtn) closeBtn.addEventListener("click", close);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  try {
    sndAllSymbols = await sndFetchSymbols();
  } catch (e) {
    console.warn("snd-app: fetch symbols failed", e);
    sndAllSymbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT"];
  }
}

// ─── Boot ────────────────────────────────────────────────────
async function sndBoot() {
  sndDetector = new SupplyDemandDetector({
    symbol: SND_CFG.symbol,
    timeframe: SND_CFG.interval,
    formations: Object.keys(SND_CFG.formations).filter((f) => SND_CFG.formations[f]),
    minScore: SND_CFG.minScore,
    debug: SND_CFG.debug,
    config: sndBuildAlgorithmConfig(),
  });

  sndInitChart("snd-chart-container", "snd-overlay-canvas");
  sndInitResizeObserver();
  sndSetDebug(SND_CFG.debug);
  sndSetHoverCallback((zone, param) => {
    if (zone) sndShowZoneInfo(zone);
    else if (param && !param.point) sndEl("snd-zone-info").classList.remove("visible");
  });
  sndSetupControls();
  await sndSetupSymbolSearch();
  sndEl("snd-debug-panel").classList.toggle("open", SND_CFG.debug);
  const debugClear = sndEl("snd-debug-clear");
  if (debugClear) {
    debugClear.addEventListener("click", () => {
      sndDebugLog = [];
      sndRenderDebugPanel();
    });
  }
  await sndLoadSymbol();
  const loading = sndEl("snd-loading");
  if (loading) loading.classList.add("hidden");
}

window.addEventListener("DOMContentLoaded", sndBoot);