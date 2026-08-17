// ============================================================
// stat6-app.js — BOOTSTRAP NHẸ CHO STAT6
// Chỉ hiển thị: 2 VSR + 2 ATRBot + VSR Overlap + Demand/Supply zones.
// - barLimit mặc định 1500 → load 1 request, recompute < 50ms
// - Recompute indicator throttle 2s (không recompute mỗi tick)
// - S&D detection CHỈ trên closed candles (time-change detection)
// - Không analysis pipeline / settings modal / debug panel
// ============================================================

let stat6Detector = null;
let stat6ZoneList = [];
let stat6LastBarTime = null;
let stat6LastPrice = null;
let stat6SymbolsCache = {};
let stat6ActiveSourceFilter = "all";
let stat6CachedSet = new Set();
let stat6LastRecompute = 0;

function stat6El(id) {
  return document.getElementById(id);
}

function stat6Status(type, text) {
  const el = stat6El("stat6-status");
  if (!el) return;
  if (type === "loading") {
    el.innerHTML = `<span class="stat6-loading-spin"></span><span>${text}</span>`;
  } else if (type === "ready") {
    el.innerHTML = `<span class="stat6-status-dot"></span><span class="stat6-sym-tag">${STAT6_CFG.symbol}</span><span class="stat6-tf-tag">${STAT6_CFG.interval}</span><span>${text}</span>`;
  } else {
    el.innerHTML = `<span style="color:#ff5252">${text}</span>`;
  }
}

function stat6Ticker(price, changePct) {
  const pEl = stat6El("stat6-ticker-price");
  const cEl = stat6El("stat6-ticker-change");
  if (!pEl || !cEl || !price) return;
  const precision = price >= 10000 ? 1 : price >= 1000 ? 2 : price >= 100 ? 3 : 4;
  const old = parseFloat(pEl.textContent);
  pEl.textContent = price.toFixed(precision);
  pEl.className = old && price > old ? "stat6-tick-up" : old && price < old ? "stat6-tick-down" : "";
  if (changePct === undefined || changePct === null) {
    changePct = stat6LastPrice ? ((price - stat6LastPrice) / stat6LastPrice) * 100 : 0;
  }
  stat6LastPrice = price;
  cEl.textContent = `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`;
  cEl.className = changePct >= 0 ? "stat6-badge-up" : "stat6-badge-down";
}

// ─── Indicators (throttled) ──────────────────────────────────
function stat6RecalcIndicators() {
  if (!globalStat6Bars.length) return;
  const C = STAT6_CFG;
  globalStat6Bot1 = C.atr1.enabled ? calculateStat2ATRBot(globalStat6Bars, C.atr1.atrLen, C.atr1.maLen, C.atr1.mult, C.atr1.maType, C.atr1.source) : null;
  globalStat6Bot2 = C.atr2.enabled ? calculateStat2ATRBot(globalStat6Bars, C.atr2.atrLen, C.atr2.maLen, C.atr2.mult, C.atr2.maType, C.atr2.source) : null;
  globalStat6Vsr1 = C.vsr1.enabled ? calculateStat2VSR(globalStat6Bars, C.vsr1.len, C.vsr1.thr) : null;
  globalStat6Vsr2 = C.vsr2.enabled ? calculateStat2VSR(globalStat6Bars, C.vsr2.len, C.vsr2.thr) : null;
  globalStat6VsrOverlap = C.vsrOverlap.enabled && globalStat6Vsr1 && globalStat6Vsr2
    ? calculateStat2VSROverlap(globalStat6Bars, globalStat6Vsr1, globalStat6Vsr2)
    : null;
  requestAnimationFrame(drawStat6Overlay);
}

// Throttle: recompute indicator tối đa 1 lần / 2000ms
function stat6MaybeRecalc(force) {
  const now = Date.now();
  if (force || now - stat6LastRecompute > 2000) {
    stat6LastRecompute = now;
    stat6RecalcIndicators();
  }
}

// ─── Zones ───────────────────────────────────────────────────
function stat6ApplyZones(zones) {
  const visible = zones.filter((z) => {
    if (!STAT6_CFG.snd.formations[z.formation]) return false;
    if (z.status === "invalidated" && !STAT6_CFG.snd.showInvalidated) return false;
    if (z.status === "tested" && !STAT6_CFG.snd.showTested) return false;
    return true;
  });
  stat6ZoneList = visible;
  stat6SetZones(visible, stat6Detector.candles);
  requestAnimationFrame(drawStat6Overlay);
  stat6RenderZoneList();
  stat6RenderLegend(zones);
  stat6Status("ready", `${zones.length} zones · ${zones.filter((z) => z.status === "fresh").length} fresh`);
}

function stat6RenderZoneList() {
  const list = stat6El("stat6-zone-list");
  if (!list) return;
  list.innerHTML = stat6ZoneList.map((z) => {
    const color = z.type === "demand" ? "#00E676" : "#FF5252";
    return `<div class="stat6-zone-row" data-id="${z.id}">
      <span class="stat6-zone-f" style="color:${color}">${z.formation}</span>
      <span class="stat6-zone-score">${z.score}</span>
      <span class="stat6-zone-status ${z.status}">${z.status}</span>
      <span class="stat6-zone-prices">${z.proximal.toFixed(2)} / ${z.distal.toFixed(2)}</span>
    </div>`;
  }).join("") || `<div class="stat6-zone-empty">No zones match filters</div>`;

  list.querySelectorAll(".stat6-zone-row").forEach((row) => {
    row.addEventListener("click", () => {
      const z = stat6ZoneList.find((zz) => zz.id === row.dataset.id);
      if (z) stat6ShowZoneInfo(z);
    });
  });
}

function stat6RenderLegend(zones) {
  const el = stat6El("stat6-legend");
  if (!el) return;
  const fmt = (f) => {
    const arr = zones.filter((z) => z.formation === f);
    return `<span class="stat6-legend-item ${f === "RBR" || f === "DBR" ? "demand" : "supply"}"><i></i>${f}: <b>${arr.filter((z) => z.status === "fresh").length}</b><span class="dim">+${arr.filter((z) => z.status === "tested").length}</span></span>`;
  };
  el.innerHTML = ["RBR", "DBD", "RBD", "DBR"].filter((f) => STAT6_CFG.snd.formations[f]).map(fmt).join("") || "";
}

function stat6ShowZoneInfo(z) {
  const panel = stat6El("stat6-zone-info");
  if (!panel) return;
  const color = z.type === "demand" ? "#00E676" : "#FF5252";
  const row = (label, value) => `<div class="stat6-info-row"><span class="stat6-info-label">${label}</span><span class="stat6-info-value">${value}</span></div>`;
  panel.innerHTML = `
    <div class="stat6-zone-info-head" style="border-color:${color}">
      <span style="color:${color};font-weight:700">${z.formation}</span>
      <span class="stat6-zone-score-big">${z.score}</span>
      <button id="stat6-zone-info-close" class="stat6-zone-info-x">✕</button>
    </div>
    <div class="stat6-zone-info-body">
      ${row("Status", `<span class="stat6-zone-status ${z.status}">${z.status}</span>`)}
      ${row("Type", z.type)}
      ${row("Proximal", z.proximal.toFixed(2))}
      ${row("Distal", z.distal.toFixed(2))}
      ${row("Base candles", `${z.base.startIndex}\u2013${z.base.endIndex} (${z.base.candles})`)}
      ${row("Base width", `${z.base.width.toFixed(1)} (${z.base.widthATR.toFixed(2)}×ATR)`)}
      ${row("Leg-out", `${z.legOut.direction} · ${z.legOut.candles} candle(s) · ${z.legOut.moveOutMultiple.toFixed(2)}×`)}
      ${row("Test count", z.testCount)}
      ${row("Penetration", `${Math.round(z.penetrationPercent * 100)}%`)}
    </div>`;
  panel.classList.add("visible");
  const closeBtn = panel.querySelector("#stat6-zone-info-close");
  if (closeBtn) closeBtn.addEventListener("click", () => panel.classList.remove("visible"));
}

// ─── Realtime ────────────────────────────────────────────────
function stat6OnBarUpdate(bar) {
  // Nến đóng: khi bar.time đổi, nến trước đã CLOSED → detection
  if (stat6LastBarTime !== null && bar.time !== stat6LastBarTime) {
    const closedBar = stat6Detector.candles[stat6Detector.candles.length - 1];
    if (closedBar && closedBar.time === stat6LastBarTime) {
      const result = stat6Detector.onCandleClosed(closedBar);
      stat6ApplyZones(result.zones);
      stat6MaybeRecalc(true);
    }
  }
  stat6LastBarTime = bar.time;

  stat6UpdateCandle(bar);
  stat6Detector.updateCandle(bar);
  stat6AppendBar(bar);
  stat6MaybeRecalc(false);
  stat6Ticker(bar.close, null);
}

function stat6AppendBar(bar) {
  if (globalStat6Bars.length && globalStat6Bars[globalStat6Bars.length - 1].time === bar.time) {
    globalStat6Bars[globalStat6Bars.length - 1] = bar;
  } else {
    globalStat6Bars.push(bar);
    if (globalStat6Bars.length > STAT6_CFG.barLimit) globalStat6Bars.shift();
  }
}

function stat6SetupRealtime() {
  setupSourceTickerStream(STAT6_CFG.dataSource, STAT6_CFG.symbol, ({ price, changePct }) => {
    stat6Ticker(price, changePct);
  });
  setupSourceKlineStream(STAT6_CFG.dataSource, STAT6_CFG.symbol, STAT6_CFG.interval, stat6OnBarUpdate);
}

// ─── Data loading ────────────────────────────────────────────
async function stat6LoadSymbolData() {
  const src = getSourceInfo(STAT6_CFG.dataSource);
  const progContainer = stat6El("stat6-progress-bar-container");
  const progFill = stat6El("stat6-progress-bar-fill");
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
  stat6Status("loading", `Đang nạp [${src.shortName}] ${STAT6_CFG.symbol} ${STAT6_CFG.interval}...`);
  closeAllSourceStreams();
  stat6LastBarTime = null;

  const bars = await fetchSourceKlines(STAT6_CFG.dataSource, STAT6_CFG.symbol, STAT6_CFG.interval, STAT6_CFG.barLimit, (msg, pct = 0) => {
    if (pct > 0) setProgress(pct);
    stat6Status("loading", msg);
  });
  endProgress();

  if (!bars || bars.length === 0) {
    stat6Status("error", `Lỗi tải dữ liệu ${STAT6_CFG.symbol}`);
    return;
  }

  stat6SetBars(bars);
  globalStat6Bars = bars;

  stat6Detector.config = stat6BuildAlgorithmConfig();
  stat6Detector.formations = stat6ActiveFormations();
  stat6Detector.symbol = STAT6_CFG.symbol;
  stat6Detector.timeframe = STAT6_CFG.interval;
  const result = stat6Detector.detect(bars);
  stat6RecalcIndicators();
  stat6ApplyZones(result.zones);
  requestAnimationFrame(drawStat6Overlay);

  stat6Status("ready", `${bars.length.toLocaleString()} nến`);
  stat6SetupRealtime();
}

// ─── Controls ────────────────────────────────────────────────
function stat6InitControls() {
  const pills = document.querySelectorAll(".stat6-iv-btn");
  pills.forEach((p) => {
    p.classList.toggle("active", p.dataset.iv === STAT6_CFG.interval);
    p.addEventListener("click", () => {
      if (p.dataset.iv === STAT6_CFG.interval) return;
      pills.forEach((el) => el.classList.remove("active"));
      p.classList.add("active");
      STAT6_CFG.interval = p.dataset.iv;
      stat6SaveConfig();
      stat6LoadSymbolData();
    });
  });

  const preset = stat6El("stat6-preset-select");
  if (preset) {
    preset.value = STAT6_CFG.snd.preset;
    preset.addEventListener("change", () => {
      STAT6_CFG.snd.preset = preset.value;
      stat6SaveConfig();
      stat6ReloadDetection();
    });
  }
  const minScore = stat6El("stat6-min-score");
  if (minScore) {
    minScore.value = STAT6_CFG.snd.minScore;
    minScore.addEventListener("change", () => {
      STAT6_CFG.snd.minScore = Number(minScore.value) || 70;
      stat6SaveConfig();
      stat6ReloadDetection();
    });
  }
  ["RBR", "DBD", "RBD", "DBR"].forEach((f) => {
    const el = stat6El(`stat6-tf-${f}`);
    if (!el) return;
    el.checked = !!STAT6_CFG.snd.formations[f];
    el.addEventListener("change", () => {
      STAT6_CFG.snd.formations[f] = el.checked;
      stat6SaveConfig();
      stat6ReloadDetection();
    });
  });
  const showTested = stat6El("stat6-show-tested");
  if (showTested) {
    showTested.checked = STAT6_CFG.snd.showTested;
    showTested.addEventListener("change", () => {
      STAT6_CFG.snd.showTested = showTested.checked;
      stat6SaveConfig();
      stat6ReloadRender();
    });
  }
  const showInv = stat6El("stat6-show-invalidated");
  if (showInv) {
    showInv.checked = STAT6_CFG.snd.showInvalidated;
    showInv.addEventListener("change", () => {
      STAT6_CFG.snd.showInvalidated = showInv.checked;
      stat6SaveConfig();
      stat6ReloadRender();
    });
  }

  const bindToggle = (btnId, path, def) => {
    const btn = stat6El(btnId);
    if (!btn) return;
    btn.classList.toggle("active", !!def);
    btn.addEventListener("click", () => {
      const cur = !btn.classList.contains("active");
      btn.classList.toggle("active", cur);
      const parts = path.split(".");
      let obj = STAT6_CFG;
      for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
      obj[parts[parts.length - 1]] = cur;
      stat6SaveConfig();
      stat6ReloadIndicatorsOnly();
    });
  };
  bindToggle("qt6-atr1", "atr1.enabled", STAT6_CFG.atr1.enabled);
  bindToggle("qt6-atr2", "atr2.enabled", STAT6_CFG.atr2.enabled);
  bindToggle("qt6-vsr1", "vsr1.enabled", STAT6_CFG.vsr1.enabled);
  bindToggle("qt6-vsr2", "vsr2.enabled", STAT6_CFG.vsr2.enabled);
  bindToggle("qt6-overlap", "vsrOverlap.enabled", STAT6_CFG.vsrOverlap.enabled);
  bindToggle("qt6-snd", "snd.enabled", STAT6_CFG.snd.enabled);
}

function stat6ReloadIndicatorsOnly() {
  stat6RecalcIndicators();
  stat6ApplyZones(stat6Detector.getZones());
  requestAnimationFrame(drawStat6Overlay);
}

function stat6ReloadDetection() {
  if (!stat6Detector || !globalStat6Bars.length) return;
  stat6Detector.config = stat6BuildAlgorithmConfig();
  stat6Detector.formations = stat6ActiveFormations();
  stat6Detector.minScore = STAT6_CFG.snd.minScore;
  stat6Detector.symbol = STAT6_CFG.symbol;
  stat6Detector.timeframe = STAT6_CFG.interval;
  const result = stat6Detector.reDetect();
  stat6ApplyZones(result.zones);
}

function stat6ReloadRender() {
  if (!stat6Detector) return;
  stat6ApplyZones(stat6Detector.getZones());
}

// ─── Symbol search ───────────────────────────────────────────
async function stat6InitSymbolSearch() {
  const input = stat6El("stat6-symbol-input");
  const modal = stat6El("stat6-symbol-modal");
  const modalInput = stat6El("stat6-modal-search-input");
  const listContainer = stat6El("stat6-modal-symbol-list");
  const tabsContainer = stat6El("stat6-modal-source-tabs");
  const filterCached = stat6El("stat6-filter-cached");
  const countEl = stat6El("stat6-symbol-count");
  if (!input || !modal) return;

  stat6CachedSet = await getDBAllCachedKeys();
  for (const k of Object.keys(DATA_SOURCES)) {
    fetchSymbolsForSource(k).then((syms) => { stat6SymbolsCache[k] = syms; });
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
      <button class="sym-source-tab-btn ${t.id === stat6ActiveSourceFilter ? "active" : ""}" data-src="${t.id}">${t.label}</button>
    `).join("");
    tabsContainer.querySelectorAll(".sym-source-tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        stat6ActiveSourceFilter = btn.dataset.src;
        renderSourceTabs();
        renderList(modalInput.value);
      });
    });
  }

  function renderList(query) {
    const q = query.trim().toUpperCase();
    const items = [];
    const sourcesToScan = stat6ActiveSourceFilter === "all" ? Object.keys(DATA_SOURCES) : [stat6ActiveSourceFilter];
    for (const srcKey of sourcesToScan) {
      const src = DATA_SOURCES[srcKey];
      const symList = stat6SymbolsCache[srcKey] || (src.id === "oanda" ? src.config.forexPairs : []);
      for (const s of symList) {
        if (!q || s.toUpperCase().includes(q)) {
          const cacheId = `${src.id}_${s}`;
          const isCached = stat6CachedSet.has(cacheId);
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
        STAT6_CFG.dataSource = btn.dataset.src;
        STAT6_CFG.symbol = btn.dataset.sym;
        input.value = btn.dataset.sym;
        stat6SaveConfig();
        closeModal();
        stat6LoadSymbolData();
      });
    });
  }

  function openModal() {
    modal.style.display = "flex";
    modalInput.value = "";
    stat6ActiveSourceFilter = STAT6_CFG.dataSource;
    renderSourceTabs();
    renderList("");
    setTimeout(() => modalInput.focus(), 100);
  }
  function closeModal() {
    modal.style.display = "none";
  }

  input.value = STAT6_CFG.symbol;
  input.addEventListener("click", openModal);
  modalInput.addEventListener("input", (e) => renderList(e.target.value));
  filterCached.addEventListener("change", () => renderList(modalInput.value));
  const closeBtn = stat6El("stat6-modal-search-close");
  if (closeBtn) closeBtn.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });
}

// ─── Boot ────────────────────────────────────────────────────
async function initStat6() {
  initStat6Chart();
  const symInput = stat6El("stat6-symbol-input");
  if (symInput) symInput.value = STAT6_CFG.symbol;

  stat6Detector = new SupplyDemandDetector({
    symbol: STAT6_CFG.symbol,
    timeframe: STAT6_CFG.interval,
    formations: stat6ActiveFormations(),
    minScore: STAT6_CFG.snd.minScore,
    config: stat6BuildAlgorithmConfig(),
    maxCandles: 2000, // cap detection window → luôn nhanh
  });

  stat6SetHoverCallback((zone, param) => {
    if (zone) stat6ShowZoneInfo(zone);
    else if (param && !param.point) stat6El("stat6-zone-info").classList.remove("visible");
  });

  stat6InitControls();
  await stat6InitSymbolSearch();
  await stat6LoadSymbolData();

  const loading = stat6El("stat6-loading");
  if (loading) loading.classList.add("hidden");
}

window.addEventListener("DOMContentLoaded", initStat6);