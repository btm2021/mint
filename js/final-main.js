// ============================================================
// final-main.js — ENTRY POINT KHỞI CHẠY FINAL.HTML (ĐA NGUỒN + FOREXFLOW)
// ============================================================

let finalSymbolsCache = {};

function updateFinalSourceBadge() {
  const badgeEl = document.getElementById("final-source-badge");
  if (!badgeEl) return;
  const src = getSourceInfo(FINAL_CFG.dataSource || "binance-futures");
  badgeEl.textContent = src.badge;
  badgeEl.className = `tb-source-badge ${src.id}`;
}

function recalculateAndRedrawFinal() {
  if (!globalFinalBars || !globalFinalBars.length) return;

  const C = FINAL_CFG;

  // 1. Tính toán 2 ATRBots
  if (C.atr1.enabled) {
    globalFinalBot1 = calculateFinalATRBot(globalFinalBars, C.atr1.atrLen, C.atr1.maLen, C.atr1.mult, C.atr1.maType, C.atr1.source);
  } else {
    globalFinalBot1 = null;
  }

  if (C.atr2.enabled) {
    globalFinalBot2 = calculateFinalATRBot(globalFinalBars, C.atr2.atrLen, C.atr2.maLen, C.atr2.mult, C.atr2.maType, C.atr2.source);
  } else {
    globalFinalBot2 = null;
  }

  // 2. Tính toán 2 VSRs
  if (C.vsr1.enabled) {
    globalFinalVsr1 = calculateFinalVSR(globalFinalBars, C.vsr1.len, C.vsr1.thr);
  } else {
    globalFinalVsr1 = null;
  }

  if (C.vsr2.enabled) {
    globalFinalVsr2 = calculateFinalVSR(globalFinalBars, C.vsr2.len, C.vsr2.thr);
  } else {
    globalFinalVsr2 = null;
  }

  // 3. Tính toán Vùng chồng lấn (VSR Overlap)
  if (C.vsrOverlap.enabled && globalFinalVsr1 && globalFinalVsr2) {
    globalFinalVsrOverlap = calculateFinalVSROverlap(globalFinalBars, globalFinalVsr1, globalFinalVsr2);
  } else {
    globalFinalVsrOverlap = null;
  }

  // 4. Tính toán S&D Zones (ForexFlow)
  if (C.zone.enabled) {
    globalFinalZones = ffxDetectZones(globalFinalBars, C.zone);
  } else {
    globalFinalZones = null;
  }

  // 5. Tính toán Trend & Swings (ForexFlow)
  if (C.trend.enabled) {
    globalFinalTrend = ffxDetectTrend(globalFinalBars, C.interval, C.trend);
  } else {
    globalFinalTrend = null;
  }

  // 6. Tính toán SMC (ForexFlow)
  if (C.smc.enabled) {
    globalFinalSMC = ffxDetectSMC(globalFinalBars, C.smc);
  } else {
    globalFinalSMC = null;
  }

  // 7. Tính toán Lệnh Entry / TP / SL
  if (C.strategy.enabled && globalFinalBot1 && globalFinalBot2) {
    globalFinalTrades = calculateFinalTrades(
      globalFinalBars,
      C,
      globalFinalBot1,
      globalFinalBot2,
      globalFinalVsr1 || { upperArr: [], lowerArr: [] },
      globalFinalVsr2 || { upperArr: [], lowerArr: [] },
      globalFinalVsrOverlap || { upperArr: [], lowerArr: [] },
      globalFinalZones,
      globalFinalSMC
    );
  } else {
    globalFinalTrades = [];
  }

  // 8. Cập nhật biểu đồ & giao diện
  if (finalChart && finalCandleSeries) {
    finalChart.applyOptions({
      layout: {
        background: { type: "solid", color: C.chart.bgColor || "#080810" },
      },
      grid: {
        vertLines: { color: C.chart.showGrid ? C.chart.gridColor : "rgba(0,0,0,0)" },
        horzLines: { color: C.chart.showGrid ? C.chart.gridColor : "rgba(0,0,0,0)" },
      },
    });

    finalCandleSeries.applyOptions({
      upColor: C.chart.upColor || "#00E676",
      downColor: C.chart.downColor || "#FF5252",
      wickUpColor: C.chart.upColor || "#00E676",
      wickDownColor: C.chart.downColor || "#FF5252",
    });
  }

  syncFinalQuickToggles();
  updateFinalStatsBar();
  updateFinalIndicatorHUD(finalLastCrosshairLogical);
  requestAnimationFrame(drawFinalOverlay);
}

function syncFinalQuickToggles() {
  const syncBtn = (id, enabled) => {
    const btn = document.getElementById(id);
    if (btn) btn.classList.toggle("active", !!enabled);
  };
  syncBtn("qt-atr1", FINAL_CFG.atr1.enabled);
  syncBtn("qt-atr2", FINAL_CFG.atr2.enabled);
  syncBtn("qt-vsr1", FINAL_CFG.vsr1.enabled);
  syncBtn("qt-vsr2", FINAL_CFG.vsr2.enabled);
  syncBtn("qt-overlap", FINAL_CFG.vsrOverlap.enabled);
  syncBtn("qt-zone", FINAL_CFG.zone.enabled);
  syncBtn("qt-trend", FINAL_CFG.trend.enabled);
  syncBtn("qt-smc", FINAL_CFG.smc.enabled);
  syncBtn("qt-struct", FINAL_CFG.structural.enabled);
  syncBtn("qt-strategy", FINAL_CFG.strategy.enabled);
}

// ==================== LOAD DỮ LIỆU ĐA NGUỒN ====================

async function loadFinalSymbolData() {
  const sourceKey = FINAL_CFG.dataSource || "binance-futures";
  const sym = FINAL_CFG.symbol || "BTCUSDT";
  const iv = FINAL_CFG.interval || "15m";
  const limit = FINAL_CFG.barLimit || 100000;
  const src = getSourceInfo(sourceKey);

  updateFinalSourceBadge();

  const progContainer = document.getElementById("final-progress-bar-container");
  const progFill = document.getElementById("final-progress-bar-fill");
  const statusEl = document.getElementById("final-status");

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
        setTimeout(() => {
          progFill.style.width = "0%";
        }, 250);
      }, 300);
    }
  };

  setProgress(10);
  if (statusEl) {
    statusEl.innerHTML = `<span class="loading-spin">⏳</span> Đang nạp [${src.shortName}] ${sym} ${iv}...`;
  }

  closeAllSourceStreams();

  const bars = await fetchSourceKlines(sourceKey, sym, iv, limit, (msg, pct = 0) => {
    if (pct > 0) setProgress(pct);
    if (statusEl) {
      statusEl.innerHTML = `<span class="loading-spin">⏳</span> ${msg}`;
    }
  });

  endProgress();

  if (!bars || bars.length === 0) {
    if (statusEl) statusEl.innerHTML = `<span class="err" style="color:#ff5252">Lỗi tải dữ liệu ${sym}</span>`;
    return;
  }

  globalFinalBars = bars;
  finalCandleSeries.setData(bars);

  const prFormat = getFinalPriceFormat(bars[bars.length - 1].close);
  finalCandleSeries.applyOptions({ priceFormat: prFormat });

  recalculateAndRedrawFinal();

  if (statusEl) {
    statusEl.innerHTML = `<span class="ready-dot"></span> [${src.shortName}] <span class="process-badge">${bars.length.toLocaleString()} nến</span>`;
  }
  finalChart.timeScale().fitContent();

  setupSourceTickerStream(sourceKey, sym, ({ price, changePct }) => {
    const pEl = document.getElementById("final-ticker-price");
    const cEl = document.getElementById("final-ticker-change");
    if (!pEl || !cEl) return;

    const pr = getFinalPriceFormat(price).precision;
    pEl.textContent = price.toFixed(pr);
    cEl.textContent = `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`;
    cEl.className = `tb-ticker-badge ${changePct >= 0 ? "badge-up" : "badge-down"}`;
  });

  setupSourceKlineStream(sourceKey, sym, iv, (bar) => {
    finalCandleSeries.update(bar);

    if (globalFinalBars.length > 0) {
      const last = globalFinalBars[globalFinalBars.length - 1];
      if (last.time === bar.time) {
        globalFinalBars[globalFinalBars.length - 1] = bar;
      } else {
        globalFinalBars.push(bar);
        if (globalFinalBars.length > FINAL_CFG.barLimit) globalFinalBars.shift();
      }
    } else {
      globalFinalBars.push(bar);
    }

    recalculateAndRedrawFinal();
  });
}

// ==================== MODAL TÌM KIẾM ĐA NGUỒN ====================

let activeFinalSourceFilter = "all";

async function initFinalSymbolSearch() {
  const input = document.getElementById("final-symbol-input");
  const modal = document.getElementById("final-symbol-modal");
  const modalInput = document.getElementById("final-modal-search-input");
  const listContainer = document.getElementById("final-modal-symbol-list");
  const tabsContainer = document.getElementById("final-modal-source-tabs");
  const filterCached = document.getElementById("final-filter-cached");
  const countEl = document.getElementById("final-symbol-count");

  const sourceKeys = Object.keys(DATA_SOURCES);
  for (const k of sourceKeys) {
    fetchSymbolsForSource(k).then((syms) => {
      finalSymbolsCache[k] = syms;
    });
  }

  function renderSourceTabs() {
    if (!tabsContainer) return;
    const tabs = [
      { id: "all", label: "🌐 Tất cả", icon: "" },
      { id: "binance-futures", label: "Binance Fut", icon: "🟡" },
      { id: "binance-spot", label: "Binance Spot", icon: "🪙" },
      { id: "okx-perp", label: "OKX Perp", icon: "⬛" },
      { id: "bybit", label: "Bybit", icon: "🟠" },
      { id: "oanda", label: "OANDA Forex", icon: "💱" },
    ];

    tabsContainer.innerHTML = tabs.map((t) => `
      <button class="sym-source-tab-btn ${t.id === activeFinalSourceFilter ? "active" : ""}" data-src="${t.id}">
        ${t.icon ? `${t.icon} ` : ""}${t.label}
      </button>
    `).join("");

    tabsContainer.querySelectorAll(".sym-source-tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeFinalSourceFilter = btn.dataset.src;
        renderSourceTabs();
        renderList(modalInput ? modalInput.value : "");
      });
    });
  }

  async function renderList(query) {
    const q = query.trim().toUpperCase();
    const cachedSet = await getDBAllCachedKeys();
    const items = [];

    const sourcesToScan = activeFinalSourceFilter === "all" ? Object.keys(DATA_SOURCES) : [activeFinalSourceFilter];

    for (const srcKey of sourcesToScan) {
      const src = DATA_SOURCES[srcKey];
      const symList = finalSymbolsCache[srcKey] || (src.id === "oanda" ? src.config.forexPairs : []);

      for (const s of symList) {
        if (!q || s.toUpperCase().includes(q)) {
          const cacheId = `${src.id}_${s}`;
          const isCached = cachedSet.has(cacheId);
          if (!filterCached.checked || isCached) {
            items.push({
              symbol: s,
              sourceId: src.id,
              sourceName: src.name,
              badge: src.badge,
              category: src.category,
              isCached,
            });
          }
        }
      }
    }

    items.sort((a, b) => {
      if (a.isCached !== b.isCached) return a.isCached ? -1 : 1;
      if (q) {
        const aStarts = a.symbol.startsWith(q);
        const bStarts = b.symbol.startsWith(q);
        if (aStarts !== bStarts) return aStarts ? -1 : 1;
      }
      return a.symbol.localeCompare(b.symbol);
    });

    if (countEl) countEl.textContent = `${items.length.toLocaleString()} mã`;

    const topItems = items.slice(0, 120);

    listContainer.innerHTML = topItems.length ? topItems.map((item) => `
      <div class="sym-item-btn" data-sym="${item.symbol}" data-src="${item.sourceId}">
        <div class="sym-name-group">
          <span class="sym-name">${item.symbol}</span>
          <span class="sym-desc">${item.sourceName}</span>
        </div>
        <div class="sym-badges-group">
          <span class="source-tag ${item.sourceId}">${item.badge}</span>
          ${item.isCached ? `<span class="cached-badge">⚡ CACHED</span>` : ""}
        </div>
      </div>
    `).join("") : `<div class="sym-empty">Không tìm thấy mã nào phù hợp với từ khóa "${query}"</div>`;

    listContainer.querySelectorAll(".sym-item-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const selectedSym = btn.dataset.sym;
        const selectedSrc = btn.dataset.src;

        FINAL_CFG.dataSource = selectedSrc;
        FINAL_CFG.symbol = selectedSym;

        if (input) input.value = selectedSym;
        updateFinalSourceBadge();

        saveFinalConfig();
        closeModal();
        loadFinalSymbolData();
      });
    });
  }

  function openModal() {
    modal.style.display = "flex";
    if (modalInput) modalInput.value = "";
    activeFinalSourceFilter = FINAL_CFG.dataSource || "all";
    renderSourceTabs();
    renderList("");
    setTimeout(() => modalInput && modalInput.focus(), 100);
  }

  function closeModal() {
    modal.style.display = "none";
  }

  const picker = document.getElementById("final-symbol-picker");
  if (picker) picker.addEventListener("click", openModal);
  if (input) input.addEventListener("click", openModal);
  if (modalInput) modalInput.addEventListener("input", (e) => renderList(e.target.value));
  if (filterCached) filterCached.addEventListener("change", () => renderList(modalInput ? modalInput.value : ""));

  const closeBtn = document.getElementById("final-modal-search-close");
  if (closeBtn) closeBtn.addEventListener("click", closeModal);
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });
  }
}

// ==================== INTERVAL BUTTONS ====================

function initFinalIntervalPills() {
  const pills = document.querySelectorAll(".final-iv-btn");
  pills.forEach((p) => {
    if (p.dataset.iv === FINAL_CFG.interval) p.classList.add("active");
    else p.classList.remove("active");

    p.addEventListener("click", () => {
      pills.forEach((el) => el.classList.remove("active"));
      p.classList.add("active");
      FINAL_CFG.interval = p.dataset.iv;
      saveFinalConfig();
      loadFinalSymbolData();
    });
  });
}

// ==================== TƯƠNG TÁC BIỂU ĐỒ ====================

function initFinalInteractions() {
  const container = document.getElementById("final-chart-container");
  let startX = 0, startY = 0;

  if (container) {
    container.addEventListener("pointerdown", (e) => {
      startX = e.clientX;
      startY = e.clientY;
    });

    container.addEventListener("pointerup", (e) => {
      if (!finalChart || !finalCandleSeries) return;
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > 5) return;

      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const logical = finalChart.timeScale().coordinateToLogical(x);
      const price = finalCandleSeries.coordinateToPrice(y);

      // Hit-test trade
      const clickedTrade = hitTestFinalTrade(logical, price);
      if (clickedTrade) {
        openFinalTradeModal(clickedTrade);
        return;
      }

      // Hit-test S&D zone
      const clickedZone = hitTestFinalZone(logical, price);
      if (clickedZone) {
        openFinalZoneModal(clickedZone);
        return;
      }
    });
  }

  const tradeModal = document.getElementById("final-trade-modal-overlay");
  if (tradeModal) {
    tradeModal.addEventListener("click", (e) => {
      if (e.target.id === "final-trade-modal-overlay") closeFinalTradeModal();
    });
  }

  const settingsModal = document.getElementById("final-settings-modal");
  if (settingsModal) {
    settingsModal.addEventListener("click", (e) => {
      if (e.target.id === "final-settings-modal") closeFinalSettingsModal();
    });
  }

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeFinalTradeModal();
      closeFinalSettingsModal();
      closeFinalSidebar();
      const symModal = document.getElementById("final-symbol-modal");
      if (symModal) symModal.style.display = "none";
    }
  });
}

// ==================== KHỞI CHẠY CHÍNH ====================

async function initFinal() {
  initFinalChart();
  const symInput = document.getElementById("final-symbol-input");
  if (symInput) symInput.value = FINAL_CFG.symbol;
  updateFinalSourceBadge();

  initFinalIntervalPills();
  await initFinalSymbolSearch();
  initFinalInteractions();

  // Sidebar Toggle Buttons on Topbar (Left ☰ and Right ⚙)
  const sidebarToggleBtn = document.getElementById("final-sidebar-toggle-btn");
  if (sidebarToggleBtn) {
    sidebarToggleBtn.addEventListener("click", toggleFinalSidebar);
  }
  const sidebarToggleBtn2 = document.getElementById("final-sidebar-toggle-btn-2");
  if (sidebarToggleBtn2) {
    sidebarToggleBtn2.addEventListener("click", toggleFinalSidebar);
  }

  const sidebarCloseBtn = document.getElementById("final-sidebar-close-btn");
  if (sidebarCloseBtn) {
    sidebarCloseBtn.addEventListener("click", closeFinalSidebar);
  }

  const sidebarBackdrop = document.getElementById("final-sidebar-backdrop");
  if (sidebarBackdrop) {
    sidebarBackdrop.addEventListener("click", closeFinalSidebar);
  }

  // Sidebar Footer Buttons
  const sidebarOpenModalBtn = document.getElementById("final-sidebar-open-modal-btn");
  if (sidebarOpenModalBtn) {
    sidebarOpenModalBtn.addEventListener("click", () => {
      closeFinalSidebar();
      openFinalSettingsModal(activeSidebarTab || "atr1");
    });
  }

  const sidebarResetBtn = document.getElementById("final-sidebar-reset-btn");
  if (sidebarResetBtn) {
    sidebarResetBtn.addEventListener("click", () => {
      if (confirm("Bạn có chắc chắn muốn khôi phục toàn bộ cài đặt về mặc định?")) {
        resetFinalConfig(null);
        renderFinalSettingsTabs();
        renderFinalSettingsContent();
        renderFinalSidebarTabs();
        renderFinalSidebarTabContent(activeSidebarTab || "atr1");
        syncFinalSidebarToggles();
        if (typeof recalculateAndRedrawFinal === "function") {
          recalculateAndRedrawFinal();
        }
      }
    });
  }

  // Full Screen Modal Buttons
  const closeSettingsBtn = document.getElementById("final-settings-close-btn");
  if (closeSettingsBtn) closeSettingsBtn.addEventListener("click", closeFinalSettingsModal);

  // Quick Toggles Switch Controls inside Sidebar
  const bindSidebarSwitch = (switchId, path, defaultVal) => {
    const sw = document.getElementById(switchId);
    if (!sw) return;
    sw.checked = !!defaultVal;
    sw.addEventListener("change", () => {
      setFinalNestedProperty(FINAL_CFG, path, sw.checked);
      saveFinalConfig();
      if (typeof recalculateAndRedrawFinal === "function") {
        recalculateAndRedrawFinal();
      }
    });
  };

  bindSidebarSwitch("sb-qt-atr1", "atr1.enabled", FINAL_CFG.atr1.enabled);
  bindSidebarSwitch("sb-qt-atr2", "atr2.enabled", FINAL_CFG.atr2.enabled);
  bindSidebarSwitch("sb-qt-vsr1", "vsr1.enabled", FINAL_CFG.vsr1.enabled);
  bindSidebarSwitch("sb-qt-vsr2", "vsr2.enabled", FINAL_CFG.vsr2.enabled);
  bindSidebarSwitch("sb-qt-overlap", "vsrOverlap.enabled", FINAL_CFG.vsrOverlap.enabled);
  bindSidebarSwitch("sb-qt-zone", "zone.enabled", FINAL_CFG.zone.enabled);
  bindSidebarSwitch("sb-qt-trend", "trend.enabled", FINAL_CFG.trend.enabled);
  bindSidebarSwitch("sb-qt-smc", "smc.enabled", FINAL_CFG.smc.enabled);
  bindSidebarSwitch("sb-qt-struct", "structural.enabled", FINAL_CFG.structural.enabled);
  bindSidebarSwitch("sb-qt-strategy", "strategy.enabled", FINAL_CFG.strategy.enabled);

  await loadFinalSymbolData();
}

window.addEventListener("DOMContentLoaded", initFinal);
