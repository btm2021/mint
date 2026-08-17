// ============================================================
// stat5-app.js — BOOTSTRAP & ĐIỀU KHIỂN STAT5
// Kết hợp: Supply & Demand (ForexFlow) + 2 ATRBot + 2 VSR +
//          VSR Overlap + hệ thống symbol đa nguồn + cache IndexedDB.
//
// Realtime: mỗi WS tick chỉ update chart + nến đang chạy.
//           Nến ĐÓNG được phát hiện bằng sự đổi thời gian (bar.time) →
//           chạy incremental S&D detection trên closed candles.
// ============================================================

let stat5Detector = null;
let stat5ZoneList = [];
let stat5DebugLog = [];
let stat5LastBarTime = null;
let stat5LastPrice = null;
let stat5SymbolsCache = {};
let stat5ActiveSourceFilter = "all";
let stat5CachedSet = new Set();

function stat5El(id) {
  return document.getElementById(id);
}

function stat5Status(type, text) {
  const el = stat5El("stat5-status");
  if (!el) return;
  if (type === "loading") {
    el.innerHTML = `<span class="stat5-loading-spin"></span><span>${text}</span>`;
  } else if (type === "ready") {
    el.innerHTML = `<span class="stat5-status-dot"></span><span class="stat5-sym-tag">${STAT5_CFG.symbol}</span><span class="stat5-src-tag">${getSourceInfo(STAT5_CFG.dataSource).shortName}</span><span>${text}</span>`;
  } else {
    el.innerHTML = `<span style="color:#ff5252">${text}</span>`;
  }
}

function stat5Ticker(price, changePct) {
  const pEl = stat5El("stat5-ticker-price");
  const cEl = stat5El("stat5-ticker-change");
  if (!pEl || !cEl || !price) return;
  const precision = price >= 10000 ? 1 : price >= 1000 ? 2 : price >= 100 ? 3 : 4;
  const old = parseFloat(pEl.textContent);
  pEl.textContent = price.toFixed(precision);
  pEl.className = old && price > old ? "stat5-tick-up" : old && price < old ? "stat5-tick-down" : "";
  if (changePct === undefined || changePct === null) {
    changePct = stat5LastPrice ? ((price - stat5LastPrice) / stat5LastPrice) * 100 : 0;
  }
  stat5LastPrice = price;
  cEl.textContent = `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`;
  cEl.className = changePct >= 0 ? "stat5-badge-up" : "stat5-badge-down";
}

// ─── Active formations từ config ─────────────────────────────
function stat5ActiveFormations() {
  return Object.keys(STAT5_CFG.snd.formations).filter((f) => STAT5_CFG.snd.formations[f]);
}

// ─── Debug logging ───────────────────────────────────────────
function stat5Log(msg) {
  stat5DebugLog.unshift(msg);
  if (stat5DebugLog.length > 500) stat5DebugLog.pop();
  if (STAT5_CFG.snd.debug) console.log(msg);
  stat5RenderDebug();
}

function stat5FormatDebug(result) {
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
      lines.push(
        `[${d.formation || (d.type === "leg-scan" ? `LEG-SCAN(${d.direction})` : "?")} REJECTED]\n` +
        `reason: ${d.reason}\n` +
        (d.baseWidthATR !== undefined ? `baseWidthATR: ${d.baseWidthATR.toFixed(2)}\n` : "") +
        (d.score !== undefined ? `score: ${d.score}\n` : "") +
        (d.moveOutMultiple !== undefined ? `moveOutMultiple: ${d.moveOutMultiple.toFixed(2)}\n` : ""),
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

function stat5RenderDebug() {
  const panel = stat5El("stat5-debug-body");
  if (panel) panel.innerHTML = stat5DebugLog.map((l) => `<pre>${l}</pre>`).join("");
}

// ─── Indicators + S&D detection ──────────────────────────────
function stat5RecalcIndicators() {
  if (!globalStat5Bars.length) return;
  const C = STAT5_CFG;
  globalStat5Bot1 = C.atr1.enabled ? calculateStat2ATRBot(globalStat5Bars, C.atr1.atrLen, C.atr1.maLen, C.atr1.mult, C.atr1.maType, C.atr1.source) : null;
  globalStat5Bot2 = C.atr2.enabled ? calculateStat2ATRBot(globalStat5Bars, C.atr2.atrLen, C.atr2.maLen, C.atr2.mult, C.atr2.maType, C.atr2.source) : null;
  globalStat5Vsr1 = C.vsr1.enabled ? calculateStat2VSR(globalStat5Bars, C.vsr1.len, C.vsr1.thr) : null;
  globalStat5Vsr2 = C.vsr2.enabled ? calculateStat2VSR(globalStat5Bars, C.vsr2.len, C.vsr2.thr) : null;
  globalStat5VsrOverlap = C.vsrOverlap.enabled && globalStat5Vsr1 && globalStat5Vsr2
    ? calculateStat2VSROverlap(globalStat5Bars, globalStat5Vsr1, globalStat5Vsr2)
    : null;
  stat5UpdateHUD();
}

function stat5ApplyZones(zones) {
  const visible = zones.filter((z) => {
    if (!STAT5_CFG.snd.formations[z.formation]) return false;
    if (z.status === "invalidated" && !STAT5_CFG.snd.showInvalidated) return false;
    if (z.status === "tested" && !STAT5_CFG.snd.showTested) return false;
    return true;
  });
  stat5ZoneList = visible;
  stat5SetZones(visible, stat5Detector.candles);
  stat5SetClassified(stat5Detector.classified);
  requestAnimationFrame(drawStat5Overlay);
  stat5RenderZoneList();
  stat5RenderLegend(zones);

  if (STAT5_CFG.snd.debug) {
    const lines = stat5FormatDebug({ debug: stat5Detector.lastDebug });
    if (lines.length) lines.forEach(stat5Log);
    stat5Log(`[SCAN] ${zones.length} zones accepted (${STAT5_CFG.symbol} ${STAT5_CFG.interval} ${STAT5_CFG.snd.preset})`);
  }

  const fresh = zones.filter((z) => z.status === "fresh").length;
  const tested = zones.filter((z) => z.status === "tested").length;
  const inv = zones.filter((z) => z.status === "invalidated").length;
  stat5Status("ready", `${zones.length} zones · ${fresh} fresh · ${tested} tested · ${inv} inval`);
}

function stat5RecalculateAndRedraw() {
  if (!stat5Detector || !globalStat5Bars.length) return;
  // Đồng bộ detector với config hiện tại
  stat5Detector.config = stat5BuildAlgorithmConfig();
  stat5Detector.formations = stat5ActiveFormations();
  stat5Detector.minScore = STAT5_CFG.snd.minScore;
  stat5Detector.debug = STAT5_CFG.snd.debug;
  stat5Detector.symbol = STAT5_CFG.symbol;
  stat5Detector.timeframe = STAT5_CFG.interval;

  stat5RecalcIndicators();
  const result = stat5Detector.reDetect();
  stat5ApplyZones(result.zones);
  requestAnimationFrame(drawStat5Overlay);
}

// ─── Realtime ────────────────────────────────────────────────
function stat5AppendBar(bar) {
  if (globalStat5Bars.length && globalStat5Bars[globalStat5Bars.length - 1].time === bar.time) {
    globalStat5Bars[globalStat5Bars.length - 1] = bar;
  } else {
    globalStat5Bars.push(bar);
    if (globalStat5Bars.length > STAT5_CFG.barLimit) globalStat5Bars.shift();
  }
}

function stat5OnBarUpdate(bar) {
  // Phát hiện nến đóng: khi thời gian đổi, nến trước đã CLOSED
  if (stat5LastBarTime !== null && bar.time !== stat5LastBarTime) {
    const closedBar = stat5Detector.candles[stat5Detector.candles.length - 1];
    if (closedBar && closedBar.time === stat5LastBarTime) {
      const result = stat5Detector.onCandleClosed(closedBar);
      stat5ApplyZones(result.zones);
    }
  }
  stat5LastBarTime = bar.time;

  stat5UpdateCandle(bar);
  stat5Detector.updateCandle(bar);
  stat5AppendBar(bar);
  stat5RecalcIndicators();
  stat5Ticker(bar.close, null);
}

function stat5SetupRealtime() {
  setupSourceTickerStream(STAT5_CFG.dataSource, STAT5_CFG.symbol, ({ price, changePct }) => {
    stat5Ticker(price, changePct);
  });
  setupSourceKlineStream(STAT5_CFG.dataSource, STAT5_CFG.symbol, STAT5_CFG.interval, stat5OnBarUpdate);
}

// ─── Data loading (với cache IndexedDB) ─────────────────────
async function stat5LoadSymbolData() {
  const src = getSourceInfo(STAT5_CFG.dataSource);
  const progContainer = stat5El("stat5-progress-bar-container");
  const progFill = stat5El("stat5-progress-bar-fill");
  const setProgress = (pct) => {
    if (progContainer && progFill) {
      progContainer.classList.add("active");
      progFill.style.width = `${Math.min(100, Math.max(5, pct))}%`;
    }
  };
  const endProgress = () => {
    if (progContainer && progFill) {
      progFill.style.width = "100%";
      setTimeout(() => {
        progContainer.classList.remove("active");
        setTimeout(() => { progFill.style.width = "0%"; }, 250);
      }, 300);
    }
  };

  setProgress(8);
  stat5Status("loading", `Đang nạp [${src.shortName}] ${STAT5_CFG.symbol} ${STAT5_CFG.interval}...`);
  closeAllSourceStreams();
  stat5LastBarTime = null;

  const bars = await fetchSourceKlines(STAT5_CFG.dataSource, STAT5_CFG.symbol, STAT5_CFG.interval, STAT5_CFG.barLimit, (msg, pct = 0) => {
    if (pct > 0) setProgress(pct);
    stat5Status("loading", msg);
  });
  endProgress();

  if (!bars || bars.length === 0) {
    stat5Status("error", `Lỗi tải dữ liệu ${STAT5_CFG.symbol}`);
    return;
  }

  stat5SetBars(bars);
  globalStat5Bars = bars;

  // Detector full scan (mọi nến historical đều đã đóng)
  stat5Detector.config = stat5BuildAlgorithmConfig();
  stat5Detector.formations = stat5ActiveFormations();
  stat5Detector.symbol = STAT5_CFG.symbol;
  stat5Detector.timeframe = STAT5_CFG.interval;
  const result = stat5Detector.detect(bars);
  stat5RecalcIndicators();
  stat5ApplyZones(result.zones);
  requestAnimationFrame(drawStat5Overlay);

  stat5Status("ready", `${bars.length.toLocaleString()} nến`);
  stat5Chart.timeScale().scrollToRealTime();
  stat5SetupRealtime();
}

// ─── Zone list ───────────────────────────────────────────────
function stat5RenderZoneList() {
  const list = stat5El("stat5-zone-list");
  if (!list) return;
  list.innerHTML = stat5ZoneList.map((z) => {
    const color = z.type === "demand" ? "#00E676" : "#FF5252";
    return `<div class="stat5-zone-row" data-id="${z.id}">
      <span class="stat5-zone-f" style="color:${color}">${z.formation}</span>
      <span class="stat5-zone-score">${z.score}</span>
      <span class="stat5-zone-status ${z.status}">${z.status}</span>
      <span class="stat5-zone-prices">${z.proximal.toFixed(2)} / ${z.distal.toFixed(2)}</span>
    </div>`;
  }).join("") || `<div class="stat5-zone-empty">No zones match filters</div>`;

  list.querySelectorAll(".stat5-zone-row").forEach((row) => {
    row.addEventListener("click", () => {
      const z = stat5ZoneList.find((zz) => zz.id === row.dataset.id);
      if (z) stat5ShowZoneInfo(z);
    });
  });
}

function stat5RenderLegend(zones) {
  const el = stat5El("stat5-legend");
  if (!el) return;
  const fmt = (f) => {
    const arr = zones.filter((z) => z.formation === f);
    const fresh = arr.filter((z) => z.status === "fresh").length;
    const tested = arr.filter((z) => z.status === "tested").length;
    return `<span class="stat5-legend-item ${f === "RBR" || f === "DBR" ? "demand" : "supply"}"><i></i>${f}: <b>${fresh}</b><span class="dim">+${tested}</span></span>`;
  };
  el.innerHTML = ["RBR", "DBD", "RBD", "DBR"].filter((f) => STAT5_CFG.snd.formations[f]).map(fmt).join("") || "";
}

// ─── Zone info (hover / click) ───────────────────────────────
function stat5ShowZoneInfo(z) {
  const panel = stat5El("stat5-zone-info");
  if (!panel) return;
  const color = z.type === "demand" ? "#00E676" : "#FF5252";
  const fmtTime = (t) => t ? new Date(t * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "—";
  const row = (label, value) => `<div class="stat5-info-row"><span class="stat5-info-label">${label}</span><span class="stat5-info-value">${value}</span></div>`;
  panel.innerHTML = `
    <div class="stat5-zone-info-head" style="border-color:${color}">
      <span style="color:${color};font-weight:700">${z.formation}</span>
      <span class="stat5-zone-score-big">${z.score}</span>
      <button id="stat5-zone-info-close" class="stat5-zone-info-x">✕</button>
    </div>
    <div class="stat5-zone-info-body">
      ${row("Status", `<span class="stat5-zone-status ${z.status}">${z.status}</span>`)}
      ${row("Type", z.type)}
      ${row("Proximal", z.proximal.toFixed(2))}
      ${row("Distal", z.distal.toFixed(2))}
      ${row("Base candles", `${z.base.startIndex}\u2013${z.base.endIndex} (${z.base.candles})`)}
      ${row("Base width", `${z.base.width.toFixed(1)} (${z.base.widthATR.toFixed(2)}×ATR)`)}
      ${row("Leg-in", `${z.legIn.direction} (${z.legIn.startIndex}\u2013${z.legIn.endIndex})`)}
      ${row("Leg-out", `${z.legOut.direction} · ${z.legOut.candles} candle(s)`)}
      ${row("Departure", `${z.legOut.move.toFixed(1)} · ${z.legOut.moveATR.toFixed(2)}×ATR`)}
      ${row("Move-out mult", `${z.legOut.moveOutMultiple.toFixed(2)}×`)}
      ${row("Test count", z.testCount)}
      ${row("Penetration", `${Math.round(z.penetrationPercent * 100)}%`)}
      ${row("Score", `S${z.scores.strength.value.toFixed(1)}/2 · T${z.scores.time.value}/1 · F${z.scores.freshness.value}/2`)}
      ${row("Created", fmtTime(z.createdAt))}
      ${row("Invalidated", fmtTime(z.invalidatedAt))}
    </div>`;
  panel.classList.add("visible");
  const closeBtn = panel.querySelector("#stat5-zone-info-close");
  if (closeBtn) closeBtn.addEventListener("click", () => panel.classList.remove("visible"));
}

// ─── HUD indicator values ────────────────────────────────────
function stat5UpdateHUD() {
  const el = stat5El("stat5-indicator-hud");
  if (!el || !globalStat5Bars.length) return;
  const idx = globalStat5Bars.length - 1;
  const stBadge = (st) => st === 1 ? `<span class="tag-up">▲ BULL</span>` : st === -1 ? `<span class="tag-down">▼ BEAR</span>` : `<span>—</span>`;
  const ovU = globalStat5VsrOverlap?.upperArr?.[idx];
  const ovL = globalStat5VsrOverlap?.lowerArr?.[idx];
  const isOv = Number.isFinite(ovU) && Number.isFinite(ovL);
  el.innerHTML = `
    <div class="hud-item"><span class="hud-lbl">ATR1 BIAS</span> ${stBadge(globalStat5Bot1?.states?.[idx])}</div>
    <div class="hud-item"><span class="hud-lbl">ATR2 ENTRY</span> ${stBadge(globalStat5Bot2?.states?.[idx])}</div>
    <div class="hud-item"><span class="hud-lbl">S&amp;D</span> <b class="${stat5ZoneList.length ? "highlight" : "dim"}">${stat5ZoneList.filter((z) => z.status === "fresh").length} fresh</b></div>
    <div class="hud-item"><span class="hud-lbl">VSR Overlap</span> <b class="${isOv ? "highlight" : "dim"}">${isOv ? "ON" : "OFF"}</b></div>
  `;
}

// ─── Quick toggles ───────────────────────────────────────────
function stat5SyncQuickToggles() {
  const sync = (id, enabled) => {
    const btn = stat5El(id);
    if (btn) btn.classList.toggle("active", !!enabled);
  };
  sync("qt5-atr1", STAT5_CFG.atr1.enabled);
  sync("qt5-atr2", STAT5_CFG.atr2.enabled);
  sync("qt5-vsr1", STAT5_CFG.vsr1.enabled);
  sync("qt5-vsr2", STAT5_CFG.vsr2.enabled);
  sync("qt5-overlap", STAT5_CFG.vsrOverlap.enabled);
  sync("qt5-snd", STAT5_CFG.snd.enabled);
}

// ─── Interval pills ──────────────────────────────────────────
function stat5InitIntervalPills() {
  const pills = document.querySelectorAll(".stat5-iv-btn");
  pills.forEach((p) => {
    p.classList.toggle("active", p.dataset.iv === STAT5_CFG.interval);
    p.addEventListener("click", () => {
      if (p.dataset.iv === STAT5_CFG.interval) return;
      pills.forEach((el) => el.classList.remove("active"));
      p.classList.add("active");
      STAT5_CFG.interval = p.dataset.iv;
      stat5SaveConfig();
      stat5LoadSymbolData();
    });
  });
}

// ─── Symbol search đa nguồn ──────────────────────────────────
async function stat5InitSymbolSearch() {
  const input = stat5El("stat5-symbol-input");
  const modal = stat5El("stat5-symbol-modal");
  const modalInput = stat5El("stat5-modal-search-input");
  const listContainer = stat5El("stat5-modal-symbol-list");
  const tabsContainer = stat5El("stat5-modal-source-tabs");
  const filterCached = stat5El("stat5-filter-cached");
  const countEl = stat5El("stat5-symbol-count");
  if (!input || !modal) return;

  stat5CachedSet = await getDBAllCachedKeys();

  for (const k of Object.keys(DATA_SOURCES)) {
    fetchSymbolsForSource(k).then((syms) => { stat5SymbolsCache[k] = syms; });
  }

  function renderSourceTabs() {
    tabsContainer.innerHTML = [
      { id: "all", label: "🌐 Tất cả" },
      { id: "binance-futures", label: "🟡 Binance Fut" },
      { id: "binance-spot", label: "🪙 Binance Spot" },
      { id: "okx-perp", label: "⬛ OKX Perp" },
      { id: "bybit", label: "🟠 Bybit" },
      { id: "oanda", label: "💱 OANDA Forex" },
    ].map((t) => `
      <button class="sym-source-tab-btn ${t.id === stat5ActiveSourceFilter ? "active" : ""}" data-src="${t.id}">${t.label}</button>
    `).join("");

    tabsContainer.querySelectorAll(".sym-source-tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        stat5ActiveSourceFilter = btn.dataset.src;
        renderSourceTabs();
        renderList(modalInput.value);
      });
    });
  }

  function renderList(query) {
    const q = query.trim().toUpperCase();
    const items = [];
    const sourcesToScan = stat5ActiveSourceFilter === "all" ? Object.keys(DATA_SOURCES) : [stat5ActiveSourceFilter];
    for (const srcKey of sourcesToScan) {
      const src = DATA_SOURCES[srcKey];
      const symList = stat5SymbolsCache[srcKey] || (src.id === "oanda" ? src.config.forexPairs : []);
      for (const s of symList) {
        if (!q || s.toUpperCase().includes(q)) {
          const cacheId = `${src.id}_${s}`;
          const isCached = stat5CachedSet.has(cacheId);
          if (!filterCached.checked || isCached) {
            items.push({ symbol: s, sourceId: src.id, badge: src.badge, isCached });
          }
        }
      }
    }
    items.sort((a, b) => (a.isCached === b.isCached ? a.symbol.localeCompare(b.symbol) : a.isCached ? -1 : 1));
    if (countEl) countEl.textContent = `${items.length.toLocaleString()} mã`;

    listContainer.innerHTML = items.slice(0, 150).map((item) => `
      <div class="sym-item-btn" data-sym="${item.symbol}" data-src="${item.sourceId}">
        <div class="sym-name-group">
          <span class="sym-name">${item.symbol}</span>
          <span class="sym-desc">${getSourceInfo(item.sourceId).name}</span>
        </div>
        <div class="sym-badges-group">
          <span class="source-tag ${item.sourceId}">${item.badge}</span>
          ${item.isCached ? `<span class="cached-badge">⚡ CACHED</span>` : ""}
        </div>
      </div>
    `).join("") || `<div class="sym-empty">Không tìm thấy mã nào</div>`;

    listContainer.querySelectorAll(".sym-item-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        STAT5_CFG.dataSource = btn.dataset.src;
        STAT5_CFG.symbol = btn.dataset.sym;
        input.value = btn.dataset.sym;
        stat5SaveConfig();
        closeModal();
        stat5LoadSymbolData();
      });
    });
  }

  function openModal() {
    modal.style.display = "flex";
    modalInput.value = "";
    stat5ActiveSourceFilter = STAT5_CFG.dataSource;
    renderSourceTabs();
    renderList("");
    setTimeout(() => modalInput.focus(), 100);
  }
  function closeModal() {
    modal.style.display = "none";
  }

  input.value = STAT5_CFG.symbol;
  input.addEventListener("click", openModal);
  modalInput.addEventListener("input", (e) => renderList(e.target.value));
  filterCached.addEventListener("change", () => renderList(modalInput.value));
  const closeBtn = stat5El("stat5-modal-search-close");
  if (closeBtn) closeBtn.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });
}

// ─── Toolbar controls ────────────────────────────────────────
function stat5InitToolbar() {
  const preset = stat5El("stat5-preset-select");
  if (preset) {
    preset.value = STAT5_CFG.snd.preset;
    preset.addEventListener("change", () => {
      STAT5_CFG.snd.preset = preset.value;
      stat5SaveConfig();
      stat5RecalculateAndRedraw();
    });
  }
  const minScore = stat5El("stat5-min-score");
  if (minScore) {
    minScore.value = STAT5_CFG.snd.minScore;
    minScore.addEventListener("change", () => {
      STAT5_CFG.snd.minScore = Number(minScore.value) || 70;
      stat5SaveConfig();
      stat5RecalculateAndRedraw();
    });
  }
  ["RBR", "DBD", "RBD", "DBR"].forEach((f) => {
    const el = stat5El(`stat5-tf-${f}`);
    if (!el) return;
    el.checked = !!STAT5_CFG.snd.formations[f];
    el.addEventListener("change", () => {
      STAT5_CFG.snd.formations[f] = el.checked;
      stat5SaveConfig();
      stat5RecalculateAndRedraw();
    });
  });
  const showTested = stat5El("stat5-show-tested");
  if (showTested) {
    showTested.checked = STAT5_CFG.snd.showTested;
    showTested.addEventListener("change", () => {
      STAT5_CFG.snd.showTested = showTested.checked;
      stat5SaveConfig();
      stat5RecalculateAndRedraw();
    });
  }
  const showInv = stat5El("stat5-show-invalidated");
  if (showInv) {
    showInv.checked = STAT5_CFG.snd.showInvalidated;
    showInv.addEventListener("change", () => {
      STAT5_CFG.snd.showInvalidated = showInv.checked;
      stat5SaveConfig();
      stat5RecalculateAndRedraw();
    });
  }
  const dbg = stat5El("stat5-debug-toggle");
  if (dbg) {
    dbg.checked = STAT5_CFG.snd.debug;
    dbg.addEventListener("change", () => {
      STAT5_CFG.snd.debug = dbg.checked;
      stat5SaveConfig();
      stat5SetDebug(dbg.checked);
      stat5El("stat5-debug-panel").classList.toggle("open", dbg.checked);
      if (dbg.checked) {
        stat5RenderDebug();
        stat5RecalculateAndRedraw();
      }
      requestAnimationFrame(drawStat5Overlay);
    });
  }
  const debugClear = stat5El("stat5-debug-clear");
  if (debugClear) {
    debugClear.addEventListener("click", () => {
      stat5DebugLog = [];
      stat5RenderDebug();
    });
  }
}

// ─── Boot ────────────────────────────────────────────────────
async function initStat5() {
  initStat5Chart();
  const symInput = stat5El("stat5-symbol-input");
  if (symInput) symInput.value = STAT5_CFG.symbol;

  stat5Detector = new SupplyDemandDetector({
    symbol: STAT5_CFG.symbol,
    timeframe: STAT5_CFG.interval,
    formations: stat5ActiveFormations(),
    minScore: STAT5_CFG.snd.minScore,
    debug: STAT5_CFG.snd.debug,
    config: stat5BuildAlgorithmConfig(),
  });

  stat5SetDebug(STAT5_CFG.snd.debug);
  stat5SetHoverCallback((zone, param) => {
    if (zone) stat5ShowZoneInfo(zone);
    else if (param && !param.point) stat5El("stat5-zone-info").classList.remove("visible");
  });

  stat5InitIntervalPills();
  stat5InitToolbar();
  await stat5InitSymbolSearch();
  stat5InitQuickToggles();
  stat5El("stat5-debug-panel").classList.toggle("open", STAT5_CFG.snd.debug);

  // Nút mở settings
  const openSettingsBtn = stat5El("stat5-open-settings-btn");
  if (openSettingsBtn) openSettingsBtn.addEventListener("click", () => stat5OpenSettingsModal("atr1"));
  const closeSettingsBtn = stat5El("stat5-settings-close-btn");
  if (closeSettingsBtn) closeSettingsBtn.addEventListener("click", stat5CloseSettingsModal);
  const settingsModal = stat5El("stat5-settings-modal");
  if (settingsModal) {
    settingsModal.addEventListener("click", (e) => {
      if (e.target.id === "stat5-settings-modal") stat5CloseSettingsModal();
    });
  }

  await stat5LoadSymbolData();

  const loading = stat5El("stat5-loading");
  if (loading) loading.classList.add("hidden");
}

function stat5InitQuickToggles() {
  const bind = (btnId, path, def) => {
    const btn = stat5El(btnId);
    if (!btn) return;
    btn.classList.toggle("active", !!def);
    btn.addEventListener("click", () => {
      const cur = !btn.classList.contains("active");
      btn.classList.toggle("active", cur);
      stat5SetNestedProperty(STAT5_CFG, path, cur);
      stat5SaveConfig();
      stat5RecalculateAndRedraw();
    });
  };
  bind("qt5-atr1", "atr1.enabled", STAT5_CFG.atr1.enabled);
  bind("qt5-atr2", "atr2.enabled", STAT5_CFG.atr2.enabled);
  bind("qt5-vsr1", "vsr1.enabled", STAT5_CFG.vsr1.enabled);
  bind("qt5-vsr2", "vsr2.enabled", STAT5_CFG.vsr2.enabled);
  bind("qt5-overlap", "vsrOverlap.enabled", STAT5_CFG.vsrOverlap.enabled);
  bind("qt5-snd", "snd.enabled", STAT5_CFG.snd.enabled);
}

window.addEventListener("DOMContentLoaded", initStat5);