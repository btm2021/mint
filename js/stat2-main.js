// ============================================================
// stat2-main.js — ENTRY POINT KHỞI CHẠY STAT2 (ĐA NGUỒN DỮ LIỆU)
// ============================================================

let stat2SymbolsCache = {}; // { [sourceId]: Array<string> }

function updateStat2SourceBadge() {
  const badgeEl = document.getElementById("stat2-source-badge");
  if (!badgeEl) return;
  const src = getSourceInfo(STAT2_CFG.dataSource || "binance-futures");
  badgeEl.textContent = src.badge;
  badgeEl.className = `tb-source-badge ${src.id}`;
}

function recalculateAndRedrawStat2() {
  if (!globalStat2Bars || !globalStat2Bars.length) return;

  const C = STAT2_CFG;

  // 1. Tính toán 2 ATRBots
  if (C.atr1.enabled) {
    globalStat2Bot1 = calculateStat2ATRBot(globalStat2Bars, C.atr1.atrLen, C.atr1.maLen, C.atr1.mult, C.atr1.maType, C.atr1.source);
  } else {
    globalStat2Bot1 = null;
  }

  if (C.atr2.enabled) {
    globalStat2Bot2 = calculateStat2ATRBot(globalStat2Bars, C.atr2.atrLen, C.atr2.maLen, C.atr2.mult, C.atr2.maType, C.atr2.source);
  } else {
    globalStat2Bot2 = null;
  }

  // 2. Tính toán 2 VSRs
  if (C.vsr1.enabled) {
    globalStat2Vsr1 = calculateStat2VSR(globalStat2Bars, C.vsr1.len, C.vsr1.thr);
  } else {
    globalStat2Vsr1 = null;
  }

  if (C.vsr2.enabled) {
    globalStat2Vsr2 = calculateStat2VSR(globalStat2Bars, C.vsr2.len, C.vsr2.thr);
  } else {
    globalStat2Vsr2 = null;
  }

  // 3. Tính toán Vùng chồng lấn (VSR Overlap)
  if (C.vsrOverlap.enabled && globalStat2Vsr1 && globalStat2Vsr2) {
    globalStat2VsrOverlap = calculateStat2VSROverlap(globalStat2Bars, globalStat2Vsr1, globalStat2Vsr2);
  } else {
    globalStat2VsrOverlap = null;
  }

  // 4. Tính toán Lệnh Entry / TP / SL
  if (C.strategy.enabled && globalStat2Bot1 && globalStat2Bot2) {
    globalStat2Trades = calculateStat2Trades(
      globalStat2Bars,
      C,
      globalStat2Bot1,
      globalStat2Bot2,
      globalStat2Vsr1 || { upperArr: [], lowerArr: [] },
      globalStat2Vsr2 || { upperArr: [], lowerArr: [] },
      globalStat2VsrOverlap || { upperArr: [], lowerArr: [] }
    );
  } else {
    globalStat2Trades = [];
  }

  // 5. Cập nhật biểu đồ & giao diện
  if (stat2Chart && stat2CandleSeries) {
    stat2Chart.applyOptions({
      layout: {
        background: { type: "solid", color: C.chart.bgColor || "#080810" },
      },
      grid: {
        vertLines: { color: C.chart.showGrid ? C.chart.gridColor : "rgba(0,0,0,0)" },
        horzLines: { color: C.chart.showGrid ? C.chart.gridColor : "rgba(0,0,0,0)" },
      },
    });

    stat2CandleSeries.applyOptions({
      upColor: C.chart.upColor || "#00E676",
      downColor: C.chart.downColor || "#FF5252",
      wickUpColor: C.chart.upColor || "#00E676",
      wickDownColor: C.chart.downColor || "#FF5252",
    });
  }

  syncStat2QuickToggles();
  updateStat2StatsBar();
  updateStat2IndicatorHUD(stat2LastCrosshairLogical);
  requestAnimationFrame(drawStat2Overlay);
}

function syncStat2QuickToggles() {
  const syncBtn = (id, enabled) => {
    const btn = document.getElementById(id);
    if (btn) btn.classList.toggle("active", !!enabled);
  };
  syncBtn("qt-atr1", STAT2_CFG.atr1.enabled);
  syncBtn("qt-atr2", STAT2_CFG.atr2.enabled);
  syncBtn("qt-vsr1", STAT2_CFG.vsr1.enabled);
  syncBtn("qt-vsr2", STAT2_CFG.vsr2.enabled);
  syncBtn("qt-overlap", STAT2_CFG.vsrOverlap.enabled);
  syncBtn("qt-strategy", STAT2_CFG.strategy.enabled);
}

// ==================== LOAD DỮ LIỆU ĐA NGUỒN (DATA LOADING) ====================

async function loadStat2SymbolData() {
  const sourceKey = STAT2_CFG.dataSource || "binance-futures";
  const sym = STAT2_CFG.symbol || "BTCUSDT";
  const iv = STAT2_CFG.interval || "15m";
  const limit = STAT2_CFG.barLimit || 100000;
  const src = getSourceInfo(sourceKey);

  updateStat2SourceBadge();

  const progContainer = document.getElementById("stat2-progress-bar-container");
  const progFill = document.getElementById("stat2-progress-bar-fill");
  const statusEl = document.getElementById("stat2-status");

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

  // Đóng các websocket cũ trước khi nạp nguồn mới
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

  globalStat2Bars = bars;
  stat2CandleSeries.setData(bars);

  // Cập nhật định dạng số thập phân giá theo giá đóng cửa nến cuối
  const prFormat = getStat2PriceFormat(bars[bars.length - 1].close);
  stat2CandleSeries.applyOptions({ priceFormat: prFormat });

  recalculateAndRedrawStat2();

  if (statusEl) {
    statusEl.innerHTML = `<span class="ready-dot"></span> [${src.shortName}] <span class="process-badge">${bars.length.toLocaleString()} nến</span>`;
  }
  stat2Chart.timeScale().fitContent();

  // Khởi tạo luồng realtime
  setupSourceTickerStream(sourceKey, sym, ({ price, changePct }) => {
    const pEl = document.getElementById("stat2-ticker-price");
    const cEl = document.getElementById("stat2-ticker-change");
    if (!pEl || !cEl) return;

    const pr = getStat2PriceFormat(price).precision;
    pEl.textContent = price.toFixed(pr);
    cEl.textContent = `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`;
    cEl.className = changePct >= 0 ? "badge-up" : "badge-down";
  });

  setupSourceKlineStream(sourceKey, sym, iv, (bar) => {
    stat2CandleSeries.update(bar);

    if (globalStat2Bars.length > 0) {
      const last = globalStat2Bars[globalStat2Bars.length - 1];
      if (last.time === bar.time) {
        globalStat2Bars[globalStat2Bars.length - 1] = bar;
      } else {
        globalStat2Bars.push(bar);
        if (globalStat2Bars.length > STAT2_CFG.barLimit) globalStat2Bars.shift();
      }
    } else {
      globalStat2Bars.push(bar);
    }

    recalculateAndRedrawStat2();
  });
}

// ==================== MODAL TÌM KIẾM ĐA NGUỒN (MULTI-SOURCE SEARCH) ====================

let activeSourceFilter = "all";

async function initStat2SymbolSearch() {
  const input = document.getElementById("stat2-symbol-input");
  const modal = document.getElementById("stat2-symbol-modal");
  const modalInput = document.getElementById("stat2-modal-search-input");
  const listContainer = document.getElementById("stat2-modal-symbol-list");
  const tabsContainer = document.getElementById("stat2-modal-source-tabs");
  const filterCached = document.getElementById("stat2-filter-cached");
  const countEl = document.getElementById("stat2-symbol-count");

  // Nạp danh sách mã cho từng nguồn
  const sourceKeys = Object.keys(DATA_SOURCES);
  for (const k of sourceKeys) {
    fetchSymbolsForSource(k).then((syms) => {
      stat2SymbolsCache[k] = syms;
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
      <button class="sym-source-tab-btn ${t.id === activeSourceFilter ? "active" : ""}" data-src="${t.id}">
        ${t.icon ? `${t.icon} ` : ""}${t.label}
      </button>
    `).join("");

    tabsContainer.querySelectorAll(".sym-source-tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeSourceFilter = btn.dataset.src;
        renderSourceTabs();
        renderList(modalInput ? modalInput.value : "");
      });
    });
  }

  async function renderList(query) {
    const q = query.trim().toUpperCase();
    const cachedSet = await getDBAllCachedKeys();
    const items = [];

    const sourcesToScan = activeSourceFilter === "all" ? Object.keys(DATA_SOURCES) : [activeSourceFilter];

    for (const srcKey of sourcesToScan) {
      const src = DATA_SOURCES[srcKey];
      const symList = stat2SymbolsCache[srcKey] || (src.id === "oanda" ? src.config.forexPairs : []);

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

    // Sắp xếp: Cached lên đầu, sau đó ưu tiên khớp chính xác hoặc bắt đầu bằng query
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

        STAT2_CFG.dataSource = selectedSrc;
        STAT2_CFG.symbol = selectedSym;

        if (input) input.value = selectedSym;
        updateStat2SourceBadge();

        saveStat2Config();
        closeModal();
        loadStat2SymbolData();
      });
    });
  }

  function openModal() {
    modal.style.display = "flex";
    if (modalInput) modalInput.value = "";
    activeSourceFilter = STAT2_CFG.dataSource || "all";
    renderSourceTabs();
    renderList("");
    setTimeout(() => modalInput && modalInput.focus(), 100);
  }

  function closeModal() {
    modal.style.display = "none";
  }

  if (input) input.addEventListener("click", openModal);
  if (modalInput) modalInput.addEventListener("input", (e) => renderList(e.target.value));
  if (filterCached) filterCached.addEventListener("change", () => renderList(modalInput ? modalInput.value : ""));

  const closeBtn = document.getElementById("stat2-modal-search-close");
  if (closeBtn) closeBtn.addEventListener("click", closeModal);
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });
  }
}

// ==================== INTERVAL BUTTONS ====================

function initStat2IntervalPills() {
  const pills = document.querySelectorAll(".stat2-iv-btn");
  pills.forEach((p) => {
    if (p.dataset.iv === STAT2_CFG.interval) p.classList.add("active");
    else p.classList.remove("active");

    p.addEventListener("click", () => {
      pills.forEach((el) => el.classList.remove("active"));
      p.classList.add("active");
      STAT2_CFG.interval = p.dataset.iv;
      saveStat2Config();
      loadStat2SymbolData();
    });
  });
}

// ==================== TƯƠNG TÁC BIỂU ĐỒ (CLICK VÀO LỆNH) ====================

function initStat2Interactions() {
  const container = document.getElementById("stat2-chart-container");
  let startX = 0, startY = 0;

  if (container) {
    container.addEventListener("pointerdown", (e) => {
      startX = e.clientX;
      startY = e.clientY;
    });

    container.addEventListener("pointerup", (e) => {
      if (!stat2Chart || !stat2CandleSeries) return;
      // Nếu rê chuột / kéo biểu đồ (> 5px) thì không tính là click
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > 5) return;

      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const logical = stat2Chart.timeScale().coordinateToLogical(x);
      const price = stat2CandleSeries.coordinateToPrice(y);

      const clickedTrade = hitTestStat2Trade(logical, price);
      if (clickedTrade) {
        openStat2TradeModal(clickedTrade);
      }
    });
  }

  // Modal backdrop close
  const tradeModal = document.getElementById("stat2-trade-modal-overlay");
  if (tradeModal) {
    tradeModal.addEventListener("click", (e) => {
      if (e.target.id === "stat2-trade-modal-overlay") closeStat2TradeModal();
    });
  }

  const settingsModal = document.getElementById("stat2-settings-modal");
  if (settingsModal) {
    settingsModal.addEventListener("click", (e) => {
      if (e.target.id === "stat2-settings-modal") closeStat2SettingsModal();
    });
  }

  // Đóng modal bằng phím Escape
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeStat2TradeModal();
      closeStat2SettingsModal();
      const symModal = document.getElementById("stat2-symbol-modal");
      if (symModal) symModal.style.display = "none";
    }
  });
}

// ==================== KHỞI CHẠY CHÍNH ====================

async function initStat2() {
  initStat2Chart();
  const symInput = document.getElementById("stat2-symbol-input");
  if (symInput) symInput.value = STAT2_CFG.symbol;
  updateStat2SourceBadge();

  initStat2IntervalPills();
  await initStat2SymbolSearch();
  initStat2Interactions();

  // Nút mở Settings
  const openSettingsBtn = document.getElementById("stat2-open-settings-btn");
  if (openSettingsBtn) {
    openSettingsBtn.addEventListener("click", () => {
      openStat2SettingsModal("atr1");
    });
  }
  const closeSettingsBtn = document.getElementById("stat2-settings-close-btn");
  if (closeSettingsBtn) closeSettingsBtn.addEventListener("click", closeStat2SettingsModal);

  // Quick Toggles trên Topbar
  const bindQuickToggle = (btnId, path, defaultVal) => {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.classList.toggle("active", !!defaultVal);
    btn.addEventListener("click", () => {
      const cur = !btn.classList.contains("active");
      btn.classList.toggle("active", cur);
      setNestedProperty(STAT2_CFG, path, cur);
      saveStat2Config();
      recalculateAndRedrawStat2();
    });
  };

  bindQuickToggle("qt-atr1", "atr1.enabled", STAT2_CFG.atr1.enabled);
  bindQuickToggle("qt-atr2", "atr2.enabled", STAT2_CFG.atr2.enabled);
  bindQuickToggle("qt-vsr1", "vsr1.enabled", STAT2_CFG.vsr1.enabled);
  bindQuickToggle("qt-vsr2", "vsr2.enabled", STAT2_CFG.vsr2.enabled);
  bindQuickToggle("qt-overlap", "vsrOverlap.enabled", STAT2_CFG.vsrOverlap.enabled);
  bindQuickToggle("qt-strategy", "strategy.enabled", STAT2_CFG.strategy.enabled);

  await loadStat2SymbolData();
}

window.addEventListener("DOMContentLoaded", initStat2);
