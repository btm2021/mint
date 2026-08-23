/**
 * SMC FVG, VSR & Dual ATR Bot Real-Time Engine (Pure JavaScript - stat2.js)
 * Standalone client-side direct live Binance Futures calculation, exchangeInfo dynamic symbol search, 24h ticker caching & WebSocket streaming
 */

(function () {
  'use strict';

  const STORAGE_KEY = 'smc_stat2_settings_v4';
  const TICKER_CACHE_TTL = 60000; // 60 seconds cache to avoid spamming Binance API

  const HOT_SYMBOLS = new Set([
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT',
    'ADAUSDT', 'AVAXUSDT', 'SUIUSDT', 'NEARUSDT', 'LINKUSDT', 'PEPEUSDT',
    'APTUSDT', 'ARBUSDT', 'OPUSDT', 'LTCUSDT', 'TIAUSDT', 'INJUSDT',
    'FTMUSDT', 'IMXUSDT', '1000PEPEUSDT', '1000SHIBUSDT', '1000BONKUSDT',
    'WIFUSDT', 'RENDERUSDT', 'FETUSDT', 'TAOUSDT'
  ]);

  const MEME_SYMBOLS = new Set([
    'DOGEUSDT', 'PEPEUSDT', '1000PEPEUSDT', '1000SHIBUSDT', '1000BONKUSDT',
    '1000FLOKIUSDT', 'WIFUSDT', 'BOMEUSDT', 'NEIROUSDT', 'MEMEUSDT', '1000CATUSDT'
  ]);

  const L1_SYMBOLS = new Set([
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'ADAUSDT', 'AVAXUSDT',
    'NEARUSDT', 'SUIUSDT', 'APTUSDT', 'ARBUSDT', 'OPUSDT', 'DOTUSDT',
    'POLUSDT', 'SEIUSDT', 'INJUSDT', 'FTMUSDT', 'ATOMUSDT', 'ALGOUSDT'
  ]);

  // --- Default Configuration ---
  const defaultState = {
    symbol: 'BTCUSDT',
    timeframe: '15m',
    candleLimit: 20000,
    pricePrecision: 2,
    priceMinMove: 0.01,
    minGapPercent: 0,
    boxOpacity: 0.3,
    enableLiveWs: true,
    activeCategory: 'ALL',
    sortBy: 'VOL',       // 'VOL' | 'CHG'
    searchQuery: '',

    allSymbols: [],      // Array loaded directly from Binance exchangeInfo + 24hr tickers
    tickerMap: new Map(), // symbol -> { lastPrice, changePct, quoteVolume, timestamp }
    lastTickerFetchTime: 0,

    rawData: [],
    chartData: [],
    volumeData: [],

    // Indicators Data
    fvgList: [],
    vsrData: [],
    atr1Data: [],
    atr2Data: [],

    // 1. FVG Settings
    fvg: {
      enable: true,
      bullish: true,
      bearish: true,
      unmitigatedOnly: false,
      joinConsecutive: false
    },

    // 2. VSR (10-10) Settings
    vsr: {
      enable: true,
      showZone: true,
      showSpikes: true,
      length: 10,
      threshold: 10.0
    },

    // 3. ATR Bot 1: VIDYA (14, 55, 4.0) - Slow / Trend
    atr1: {
      enable: true,
      showLines: true,
      showRibbon: true,
      showSignals: true,
      length: 14,
      mult: 4.0,
      maType: "VIDYA",
      maLength: 55
    },

    // 4. ATR Bot 2: VIDYA (14, 21, 2.0) - Fast / Scalp
    atr2: {
      enable: true,
      showLines: true,
      showRibbon: true,
      showSignals: true,
      length: 14,
      mult: 2.0,
      maType: "VIDYA",
      maLength: 21
    },

    sidebarCollapsed: false
  };

  // Clone default state into working state
  const state = JSON.parse(JSON.stringify(defaultState));
  state.allSymbols = [];
  state.tickerMap = new Map();

  // --- DOM Elements ---
  const el = {
    sidebarPanel: document.getElementById('sidebarPanel'),
    btnCollapseSidebar: document.getElementById('btnCollapseSidebar'),
    btnExpandSidebar: document.getElementById('btnExpandSidebar'),

    symbolPickerWrapper: document.getElementById('symbolPickerWrapper'),
    btnOpenSymbolPicker: document.getElementById('btnOpenSymbolPicker'),
    activeSymbolText: document.getElementById('activeSymbolText'),
    symbolDropdownPanel: document.getElementById('symbolDropdownPanel'),
    symbolSearchInput: document.getElementById('symbolSearchInput'),
    symbolsCountBadge: document.getElementById('symbolsCountBadge'),
    symbolListContainer: document.getElementById('symbolListContainer'),
    quickFilterTags: document.querySelectorAll('.quick-filter-tags .tag-btn'),
    btnSortVol: document.getElementById('btnSortVol'),
    btnSortChg: document.getElementById('btnSortChg'),

    // Active Ticker Strip
    tkPrice: document.getElementById('tkPrice'),
    tkChg: document.getElementById('tkChg'),
    tkVol: document.getElementById('tkVol'),

    liveTimeframe: document.getElementById('liveTimeframe'),
    liveLimit: document.getElementById('liveLimit'),
    btnFetchLive: document.getElementById('btnFetchLive'),
    btnToggleMeasure: document.getElementById('btnToggleMeasure'),
    toggleLiveStream: document.getElementById('toggleLiveStream'),
    csvFileInput: document.getElementById('csvFileInput'),
    statusBadge: document.getElementById('statusBadge'),
    statusText: document.getElementById('statusText'),
    statScale: document.getElementById('statScale'),
    statCandles: document.getElementById('statCandles'),
    chartContainer: document.getElementById('chartContainer'),
    overlayCanvas: document.getElementById('fvgOverlayCanvas'),
    legendSymbol: document.getElementById('legendSymbol'),
    legOpen: document.getElementById('legOpen'),
    legHigh: document.getElementById('legHigh'),
    legLow: document.getElementById('legLow'),
    legClose: document.getElementById('legClose'),
    legVol: document.getElementById('legVol'),
    legChange: document.getElementById('legChange'),
    legendDetails: document.getElementById('legendDetails'),
    activeIndicatorsCount: document.getElementById('activeIndicatorsCount'),
    btnResetSettings: document.getElementById('btnResetSettings'),

    // FVG Controls
    toggleFVG: document.getElementById('toggleFVG'),
    fvgBullish: document.getElementById('fvgBullish'),
    fvgBearish: document.getElementById('fvgBearish'),
    fvgUnmitigatedOnly: document.getElementById('fvgUnmitigatedOnly'),
    fvgJoinConsecutive: document.getElementById('fvgJoinConsecutive'),
    sliderMinGap: document.getElementById('sliderMinGap'),
    lblMinGap: document.getElementById('lblMinGap'),
    sliderOpacity: document.getElementById('sliderOpacity'),
    lblOpacity: document.getElementById('lblOpacity'),
    activeFVGCount: document.getElementById('activeFVGCount'),

    // VSR Controls
    toggleVSR: document.getElementById('toggleVSR'),
    badgeVSRCount: document.getElementById('badgeVSRCount'),
    vsrShowZone: document.getElementById('vsrShowZone'),
    vsrShowSpikes: document.getElementById('vsrShowSpikes'),
    vsrLength: document.getElementById('vsrLength'),
    vsrThreshold: document.getElementById('vsrThreshold'),

    // ATR Bot 1 Controls (Slow / VIDYA 14/55/4)
    toggleATR1: document.getElementById('toggleATR1'),
    badgeATR1Trend: document.getElementById('badgeATR1Trend'),
    atr1ShowLines: document.getElementById('atr1ShowLines'),
    atr1ShowRibbon: document.getElementById('atr1ShowRibbon'),
    atr1ShowSignals: document.getElementById('atr1ShowSignals'),
    atr1Length: document.getElementById('atr1Length'),
    atr1Mult: document.getElementById('atr1Mult'),
    atr1MAType: document.getElementById('atr1MAType'),
    atr1MALength: document.getElementById('atr1MALength'),

    // ATR Bot 2 Controls (Fast / VIDYA 14/21/2)
    toggleATR2: document.getElementById('toggleATR2'),
    badgeATR2Trend: document.getElementById('badgeATR2Trend'),
    atr2ShowLines: document.getElementById('atr2ShowLines'),
    atr2ShowRibbon: document.getElementById('atr2ShowRibbon'),
    atr2ShowSignals: document.getElementById('atr2ShowSignals'),
    atr2Length: document.getElementById('atr2Length'),
    atr2Mult: document.getElementById('atr2Mult'),
    atr2MAType: document.getElementById('atr2MAType'),
    atr2MALength: document.getElementById('atr2MALength'),

    // FVG Stats
    statTotalFVG: document.getElementById('statTotalFVG'),
    statMitigationRate: document.getElementById('statMitigationRate'),
    statBullCount: document.getElementById('statBullCount'),
    statBearCount: document.getElementById('statBearCount'),
    statUnmitCount: document.getElementById('statUnmitCount'),
    statAvgBars: document.getElementById('statAvgBars'),
    statAvgGapSize: document.getElementById('statAvgGapSize'),
    listCounter: document.getElementById('listCounter'),
    fvgTableBody: document.getElementById('fvgTableBody')
  };

  // --- Chart & WebSocket Handles ---
  let chart = null;
  let candleSeries = null;
  let volumeSeries = null;
  let ctx = null;
  let resizeObserver = null;
  let renderScheduled = false;
  let liveWs = null;
  let lastWsThrottle = 0;
  let isDropdownOpen = false;

  // --- Measurement Tool State (Shift + Click Measure) ---
  const measure = {
    modeActive: false,    // Active measurement mode
    isMeasuring: false,   // Actively measuring / dragging
    isPinned: false,      // Measurement is locked / displayed on chart
    start: null,          // { time, price, x, y }
    current: null,        // { time, price, x, y }
    lastCrosshair: null   // { time, price, x, y }
  };

  // --- Initialize App ---
  function init() {
    loadSettingsFromLocalStorage();
    setupUIEvents();
    initChart();

    // 1. Fetch Binance Futures exchangeInfo & 24hr Ticker batch
    initExchangeData();

    // 2. Directly fetch live Binance Futures candles on startup
    fetchLiveBinance(state.symbol, state.timeframe, state.candleLimit);
  }

  // --- Helpers: Formatting Numbers ---
  function formatUSDVolume(val) {
    if (!val || isNaN(val)) return '$0';
    const num = Number(val);
    if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
    if (num >= 1e6) return `$${(num / 1e6).toFixed(1)}M`;
    if (num >= 1e3) return `$${(num / 1e3).toFixed(1)}K`;
    return `$${num.toFixed(0)}`;
  }

  function formatSymbolPrice(val) {
    if (val === null || val === undefined || isNaN(val)) return '--';
    const num = Number(val);
    if (num >= 1000) return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (num >= 10) return num.toFixed(2);
    if (num >= 1) return num.toFixed(4);
    if (num >= 0.01) return num.toFixed(5);
    if (num >= 0.0001) return num.toFixed(6);
    return num.toFixed(8);
  }

  // --- 1. Fetch Exchange Data (exchangeInfo + 24hr Tickers with Caching) ---
  async function initExchangeData() {
    await fetchExchangeInfo();
    await fetch24hTickers();
  }

  async function fetchExchangeInfo() {
    const url = 'https://fapi.binance.com/fapi/v1/exchangeInfo';
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (data && data.symbols && Array.isArray(data.symbols)) {
        const activeSymbols = data.symbols
          .filter(s => s.status === 'TRADING' && s.quoteAsset === 'USDT' && s.contractType === 'PERPETUAL')
          .map(s => ({
            symbol: s.symbol,
            baseAsset: s.baseAsset,
            quoteAsset: s.quoteAsset,
            isHot: HOT_SYMBOLS.has(s.symbol),
            isMeme: MEME_SYMBOLS.has(s.symbol),
            isL1: L1_SYMBOLS.has(s.symbol),
            lastPrice: 0,
            changePct: 0,
            quoteVolume: 0
          }));

        state.allSymbols = activeSymbols;
        el.symbolsCountBadge.textContent = `${activeSymbols.length} Pairs`;
      }
    } catch (err) {
      console.warn('Failed to fetch exchangeInfo:', err);
      const fallbackList = Array.from(HOT_SYMBOLS).map(sym => ({
        symbol: sym,
        baseAsset: sym.replace('USDT', ''),
        quoteAsset: 'USDT',
        isHot: true,
        isMeme: false,
        isL1: false,
        lastPrice: 0,
        changePct: 0,
        quoteVolume: 0
      }));
      state.allSymbols = fallbackList;
      el.symbolsCountBadge.textContent = `${fallbackList.length} Cached`;
    }
  }

  // Single Batched 24h Ticker fetch for all 700+ symbols (Throttled by 60s TTL)
  async function fetch24hTickers(force = false) {
    const now = Date.now();
    if (!force && now - state.lastTickerFetchTime < TICKER_CACHE_TTL && state.tickerMap.size > 0) {
      // Use cached data
      applyTickersToSymbols();
      return;
    }

    const url = 'https://fapi.binance.com/fapi/v1/ticker/24hr';
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (Array.isArray(data)) {
        state.tickerMap.clear();
        for (let i = 0; i < data.length; i++) {
          const item = data[i];
          state.tickerMap.set(item.symbol, {
            lastPrice: parseFloat(item.lastPrice) || 0,
            changePct: parseFloat(item.priceChangePercent) || 0,
            quoteVolume: parseFloat(item.quoteVolume) || 0
          });
        }
        state.lastTickerFetchTime = now;
        applyTickersToSymbols();
      }
    } catch (err) {
      console.warn('Failed to fetch 24hr tickers:', err);
    }
  }

  function applyTickersToSymbols() {
    for (let i = 0; i < state.allSymbols.length; i++) {
      const item = state.allSymbols[i];
      const t = state.tickerMap.get(item.symbol);
      if (t) {
        item.lastPrice = t.lastPrice;
        item.changePct = t.changePct;
        item.quoteVolume = t.quoteVolume;
      }
    }

    // Sort symbols based on active sort mode
    sortSymbols();
    renderSymbolList();
    updateHeaderTickerDisplay();
  }

  function sortSymbols() {
    if (state.sortBy === 'VOL') {
      state.allSymbols.sort((a, b) => b.quoteVolume - a.quoteVolume);
    } else if (state.sortBy === 'CHG') {
      state.allSymbols.sort((a, b) => b.changePct - a.changePct);
    }
  }

  function updateHeaderTickerDisplay() {
    const t = state.tickerMap.get(state.symbol);
    if (t) {
      el.tkPrice.textContent = `$${formatSymbolPrice(t.lastPrice)}`;
      const isUp = t.changePct >= 0;
      el.tkChg.textContent = `${isUp ? '+' : ''}${t.changePct.toFixed(2)}%`;
      el.tkChg.className = `tk-val ${isUp ? 'up' : 'down'}`;
      el.tkVol.textContent = formatUSDVolume(t.quoteVolume);
    }
  }

  // --- Render Filtered Symbol Dropdown List ---
  function renderSymbolList() {
    const query = (state.searchQuery || '').trim().toUpperCase();
    const category = state.activeCategory || 'ALL';

    const filtered = state.allSymbols.filter(item => {
      if (category === 'HOT' && !item.isHot) return false;
      if (category === 'MEME' && !item.isMeme) return false;
      if (category === 'LAYER1' && !item.isL1) return false;

      if (query) {
        return item.symbol.includes(query) || item.baseAsset.includes(query);
      }
      return true;
    });

    if (filtered.length === 0) {
      el.symbolListContainer.innerHTML = '<div class="symbol-list-loading">No matching symbols found</div>';
      return;
    }

    let html = '';
    // Show top 200 matches for ultra high performance
    const renderCount = Math.min(filtered.length, 200);

    for (let i = 0; i < renderCount; i++) {
      const item = filtered[i];
      const isSelected = item.symbol === state.symbol;
      const isUp = item.changePct >= 0;
      const chgClass = isUp ? 'up' : 'down';
      const chgSign = isUp ? '+' : '';

      html += `<div class="symbol-item ${isSelected ? 'selected' : ''}" data-symbol="${item.symbol}">
        <div class="symbol-left-info">
          <span class="symbol-name">${item.symbol}</span>
          <span class="symbol-asset">${item.baseAsset}</span>
        </div>
        <div class="symbol-right-info">
          <span class="symbol-price">$${formatSymbolPrice(item.lastPrice)}</span>
          <span class="symbol-chg ${chgClass}">${chgSign}${item.changePct.toFixed(2)}%</span>
          <span class="symbol-vol">${formatUSDVolume(item.quoteVolume)}</span>
        </div>
      </div>`;
    }

    el.symbolListContainer.innerHTML = html;

    const items = el.symbolListContainer.querySelectorAll('.symbol-item[data-symbol]');
    items.forEach(it => {
      it.addEventListener('click', () => {
        const sym = it.dataset.symbol;
        selectSymbol(sym);
      });
    });
  }

  function selectSymbol(sym) {
    if (!sym) return;
    state.symbol = sym.toUpperCase();
    el.activeSymbolText.textContent = state.symbol;
    updateHeaderTickerDisplay();
    closeSymbolDropdown();
    saveSettingsToLocalStorage();
    fetchLiveBinance(state.symbol, state.timeframe, state.candleLimit);
  }

  function openSymbolDropdown() {
    isDropdownOpen = true;
    el.symbolDropdownPanel.classList.add('show');
    el.symbolSearchInput.value = '';
    state.searchQuery = '';
    fetch24hTickers(); // Silently refresh 24h ticker if TTL expired
    renderSymbolList();
    setTimeout(() => el.symbolSearchInput.focus(), 50);
  }

  function closeSymbolDropdown() {
    isDropdownOpen = false;
    el.symbolDropdownPanel.classList.remove('show');
  }

  // --- Sidebar Collapse & Expand Animation ---
  function toggleSidebar(forceCollapsed) {
    const isCollapsed = forceCollapsed !== undefined ? forceCollapsed : !state.sidebarCollapsed;
    state.sidebarCollapsed = isCollapsed;

    if (isCollapsed) {
      el.sidebarPanel.classList.add('collapsed');
    } else {
      el.sidebarPanel.classList.remove('collapsed');
    }

    saveSettingsToLocalStorage();

    // Trigger chart resize & overlay render after CSS transition
    setTimeout(() => {
      if (chart && el.chartContainer) {
        const w = el.chartContainer.clientWidth;
        const h = el.chartContainer.clientHeight;
        chart.resize(w, h);
        resizeCanvas();
        scheduleOverlayRender();
      }
    }, 300);
  }

  // --- LocalStorage Save & Load ---
  function saveSettingsToLocalStorage() {
    try {
      const payload = {
        symbol: state.symbol,
        timeframe: state.timeframe,
        candleLimit: state.candleLimit,
        enableLiveWs: state.enableLiveWs,
        sidebarCollapsed: state.sidebarCollapsed,
        minGapPercent: state.minGapPercent,
        boxOpacity: state.boxOpacity,
        fvg: state.fvg,
        vsr: state.vsr,
        atr1: state.atr1,
        atr2: state.atr2
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
      console.warn('Failed to save settings to localStorage:', e);
    }
  }

  function loadSettingsFromLocalStorage() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved);

      if (parsed.symbol) {
        state.symbol = parsed.symbol;
        el.activeSymbolText.textContent = state.symbol;
      }
      if (parsed.timeframe) state.timeframe = parsed.timeframe;
      if (parsed.candleLimit) state.candleLimit = parsed.candleLimit;
      if (parsed.enableLiveWs !== undefined) state.enableLiveWs = parsed.enableLiveWs;
      if (parsed.sidebarCollapsed !== undefined) {
        state.sidebarCollapsed = parsed.sidebarCollapsed;
        if (state.sidebarCollapsed) {
          el.sidebarPanel.classList.add('collapsed');
        }
      }
      if (parsed.minGapPercent !== undefined) state.minGapPercent = parsed.minGapPercent;
      if (parsed.boxOpacity !== undefined) state.boxOpacity = parsed.boxOpacity;
      if (parsed.fvg) Object.assign(state.fvg, parsed.fvg);
      if (parsed.vsr) Object.assign(state.vsr, parsed.vsr);
      if (parsed.atr1) Object.assign(state.atr1, parsed.atr1);
      if (parsed.atr2) Object.assign(state.atr2, parsed.atr2);

      el.liveTimeframe.value = state.timeframe;
      el.liveLimit.value = String(state.candleLimit);
      el.toggleLiveStream.checked = state.enableLiveWs;

      // Sync Sidebar UI
      el.toggleFVG.checked = state.fvg.enable;
      el.fvgBullish.checked = state.fvg.bullish;
      el.fvgBearish.checked = state.fvg.bearish;
      el.fvgUnmitigatedOnly.checked = state.fvg.unmitigatedOnly;
      el.fvgJoinConsecutive.checked = state.fvg.joinConsecutive;
      el.sliderMinGap.value = state.minGapPercent;
      el.lblMinGap.textContent = `${state.minGapPercent.toFixed(2)}%`;
      el.sliderOpacity.value = Math.round(state.boxOpacity * 100);
      el.lblOpacity.textContent = `${Math.round(state.boxOpacity * 100)}%`;

      el.toggleVSR.checked = state.vsr.enable;
      el.vsrShowZone.checked = state.vsr.showZone;
      el.vsrShowSpikes.checked = state.vsr.showSpikes;
      el.vsrLength.value = state.vsr.length;
      el.vsrThreshold.value = state.vsr.threshold;

      el.toggleATR1.checked = state.atr1.enable;
      el.atr1ShowLines.checked = state.atr1.showLines;
      el.atr1ShowRibbon.checked = state.atr1.showRibbon;
      el.atr1ShowSignals.checked = state.atr1.showSignals;
      el.atr1Length.value = state.atr1.length;
      el.atr1Mult.value = state.atr1.mult;
      el.atr1MAType.value = state.atr1.maType;
      el.atr1MALength.value = state.atr1.maLength;

      el.toggleATR2.checked = state.atr2.enable;
      el.atr2ShowLines.checked = state.atr2.showLines;
      el.atr2ShowRibbon.checked = state.atr2.showRibbon;
      el.atr2ShowSignals.checked = state.atr2.showSignals;
      el.atr2Length.value = state.atr2.length;
      el.atr2Mult.value = state.atr2.mult;
      el.atr2MAType.value = state.atr2.maType;
      el.atr2MALength.value = state.atr2.maLength;

    } catch (e) {
      console.warn('Failed to load settings from localStorage:', e);
    }
  }

  function resetToDefaults() {
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  }

  // --- Setup UI Events ---
  function setupUIEvents() {
    el.btnResetSettings.addEventListener('click', resetToDefaults);

    // Sidebar Collapse / Expand buttons
    if (el.btnCollapseSidebar) {
      el.btnCollapseSidebar.addEventListener('click', () => toggleSidebar(true));
    }
    if (el.btnExpandSidebar) {
      el.btnExpandSidebar.addEventListener('click', () => toggleSidebar(false));
    }

    // Keyboard shortcut for sidebar toggle (Ctrl+B or [) & Measurement (Shift / Escape)
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey && e.key.toLowerCase() === 'b') || (e.key === '[' && document.activeElement.tagName !== 'INPUT')) {
        e.preventDefault();
        toggleSidebar();
      } else if (e.key === 'Shift') {
        measure.modeActive = true;
        el.chartContainer.classList.add('measuring');
        if (el.btnToggleMeasure) el.btnToggleMeasure.classList.add('active');
      } else if (e.key === 'Escape') {
        measure.modeActive = false;
        measure.isMeasuring = false;
        measure.isPinned = false;
        measure.start = null;
        measure.current = null;
        el.chartContainer.classList.remove('measuring');
        if (el.btnToggleMeasure) el.btnToggleMeasure.classList.remove('active');
        scheduleOverlayRender();
      }
    });

    document.addEventListener('keyup', (e) => {
      if (e.key === 'Shift') {
        if (!measure.isMeasuring) {
          measure.modeActive = false;
          el.chartContainer.classList.remove('measuring');
          if (el.btnToggleMeasure) el.btnToggleMeasure.classList.remove('active');
        }
      }
    });

    // Measurement Tool Toggle Button
    if (el.btnToggleMeasure) {
      el.btnToggleMeasure.addEventListener('click', (e) => {
        e.stopPropagation();
        measure.modeActive = !measure.modeActive;
        if (measure.modeActive) {
          el.chartContainer.classList.add('measuring');
          el.btnToggleMeasure.classList.add('active');
        } else {
          measure.isMeasuring = false;
          measure.isPinned = false;
          measure.start = null;
          measure.current = null;
          el.chartContainer.classList.remove('measuring');
          el.btnToggleMeasure.classList.remove('active');
          scheduleOverlayRender();
        }
      });
    }

    // Chart Click Handler for Measurement (Shift + Click or Active Measure Mode)
    el.chartContainer.addEventListener('click', (e) => {
      if (e.shiftKey || measure.modeActive) {
        if (!measure.isMeasuring) {
          // Start measurement at current cursor point
          if (measure.lastCrosshair && measure.lastCrosshair.price !== null) {
            measure.start = { ...measure.lastCrosshair };
            measure.current = { ...measure.lastCrosshair };
            measure.isMeasuring = true;
            measure.isPinned = false;
            scheduleOverlayRender();
          }
        } else {
          // Second click: Pin and finish measurement
          if (measure.lastCrosshair && measure.lastCrosshair.price !== null) {
            measure.current = { ...measure.lastCrosshair };
          }
          measure.isMeasuring = false;
          measure.isPinned = true;
          measure.modeActive = false;
          el.chartContainer.classList.remove('measuring');
          if (el.btnToggleMeasure) el.btnToggleMeasure.classList.remove('active');
          scheduleOverlayRender();
        }
      } else {
        // Normal click without shift: Clear existing pinned measurement
        if (measure.isPinned || measure.isMeasuring) {
          measure.isMeasuring = false;
          measure.isPinned = false;
          measure.start = null;
          measure.current = null;
          scheduleOverlayRender();
        }
      }
    });

    // Open / Toggle Symbol Search Dropdown
    el.btnOpenSymbolPicker.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isDropdownOpen) closeSymbolDropdown();
      else openSymbolDropdown();
    });

    document.addEventListener('click', (e) => {
      if (isDropdownOpen && !el.symbolPickerWrapper.contains(e.target)) {
        closeSymbolDropdown();
      }
    });

    // Live search filter input
    el.symbolSearchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      renderSymbolList();
    });

    el.symbolSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeSymbolDropdown();
      } else if (e.key === 'Enter') {
        const query = el.symbolSearchInput.value.trim().toUpperCase();
        if (query) {
          selectSymbol(query);
        }
      }
    });

    // Category Tag Buttons
    el.quickFilterTags.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        el.quickFilterTags.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.activeCategory = btn.dataset.filter;
        renderSymbolList();
      });
    });

    // Sort buttons
    el.btnSortVol.addEventListener('click', (e) => {
      e.stopPropagation();
      el.btnSortVol.classList.add('active');
      el.btnSortChg.classList.remove('active');
      state.sortBy = 'VOL';
      sortSymbols();
      renderSymbolList();
    });

    el.btnSortChg.addEventListener('click', (e) => {
      e.stopPropagation();
      el.btnSortChg.classList.add('active');
      el.btnSortVol.classList.remove('active');
      state.sortBy = 'CHG';
      sortSymbols();
      renderSymbolList();
    });

    // Timeframe Selection Trigger
    el.liveTimeframe.addEventListener('change', () => {
      state.timeframe = el.liveTimeframe.value;
      saveSettingsToLocalStorage();
      fetchLiveBinance(state.symbol, state.timeframe, state.candleLimit);
    });

    // Candle Limit Trigger
    el.liveLimit.addEventListener('change', () => {
      state.candleLimit = parseInt(el.liveLimit.value, 10) || 20000;
      saveSettingsToLocalStorage();
      fetchLiveBinance(state.symbol, state.timeframe, state.candleLimit);
    });

    // Manual Refresh Button (Forces full fresh 20k download)
    el.btnFetchLive.addEventListener('click', () => {
      saveSettingsToLocalStorage();
      fetchLiveBinance(state.symbol, state.timeframe, state.candleLimit, true);
    });

    // WebSocket Realtime Toggle
    el.toggleLiveStream.addEventListener('change', (e) => {
      state.enableLiveWs = e.target.checked;
      saveSettingsToLocalStorage();
      if (state.enableLiveWs) {
        connectWebSocket(state.symbol, state.timeframe);
      } else {
        closeWebSocket();
      }
    });

    // CSV File Upload (optional backup)
    el.csvFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        setStatus('loading', `Reading ${file.name}...`);
        Papa.parse(file, {
          header: true,
          dynamicTyping: true,
          skipEmptyLines: true,
          complete: (results) => processRawData(results.data, file.name),
          error: (err) => setStatus('error', `CSV Parse Error: ${err.message}`)
        });
      }
    });

    // Sidebar FVG Toggles
    el.toggleFVG.addEventListener('change', (e) => {
      state.fvg.enable = e.target.checked;
      saveSettingsToLocalStorage();
      scheduleOverlayRender();
      updateActiveCount();
    });
    el.fvgBullish.addEventListener('change', (e) => {
      state.fvg.bullish = e.target.checked;
      saveSettingsToLocalStorage();
      scheduleOverlayRender();
      updateTableAndStats();
    });
    el.fvgBearish.addEventListener('change', (e) => {
      state.fvg.bearish = e.target.checked;
      saveSettingsToLocalStorage();
      scheduleOverlayRender();
      updateTableAndStats();
    });
    el.fvgUnmitigatedOnly.addEventListener('change', (e) => {
      state.fvg.unmitigatedOnly = e.target.checked;
      saveSettingsToLocalStorage();
      scheduleOverlayRender();
      updateTableAndStats();
    });
    el.fvgJoinConsecutive.addEventListener('change', (e) => {
      state.fvg.joinConsecutive = e.target.checked;
      saveSettingsToLocalStorage();
      recalculateFVG();
    });
    el.sliderMinGap.addEventListener('input', (e) => {
      state.minGapPercent = parseFloat(e.target.value);
      el.lblMinGap.textContent = `${state.minGapPercent.toFixed(2)}%`;
      saveSettingsToLocalStorage();
      scheduleOverlayRender();
      updateTableAndStats();
    });
    el.sliderOpacity.addEventListener('input', (e) => {
      state.boxOpacity = parseInt(e.target.value, 10) / 100;
      el.lblOpacity.textContent = `${e.target.value}%`;
      saveSettingsToLocalStorage();
      scheduleOverlayRender();
    });

    // Sidebar VSR Toggles
    el.toggleVSR.addEventListener('change', (e) => {
      state.vsr.enable = e.target.checked;
      saveSettingsToLocalStorage();
      updateMarkers();
      scheduleOverlayRender();
      updateActiveCount();
    });
    el.vsrShowZone.addEventListener('change', (e) => {
      state.vsr.showZone = e.target.checked;
      saveSettingsToLocalStorage();
      scheduleOverlayRender();
    });
    el.vsrShowSpikes.addEventListener('change', (e) => {
      state.vsr.showSpikes = e.target.checked;
      saveSettingsToLocalStorage();
      updateMarkers();
      scheduleOverlayRender();
    });
    const recomputeVSR = () => {
      state.vsr.length = parseInt(el.vsrLength.value, 10) || 10;
      state.vsr.threshold = parseFloat(el.vsrThreshold.value) || 10.0;
      saveSettingsToLocalStorage();
      recalculateVSR();
    };
    el.vsrLength.addEventListener('change', recomputeVSR);
    el.vsrThreshold.addEventListener('change', recomputeVSR);

    // Sidebar ATR Bot 1 (Slow)
    el.toggleATR1.addEventListener('change', (e) => {
      state.atr1.enable = e.target.checked;
      saveSettingsToLocalStorage();
      updateMarkers();
      scheduleOverlayRender();
      updateActiveCount();
    });
    el.atr1ShowLines.addEventListener('change', (e) => {
      state.atr1.showLines = e.target.checked;
      saveSettingsToLocalStorage();
      scheduleOverlayRender();
    });
    el.atr1ShowRibbon.addEventListener('change', (e) => {
      state.atr1.showRibbon = e.target.checked;
      saveSettingsToLocalStorage();
      scheduleOverlayRender();
    });
    el.atr1ShowSignals.addEventListener('change', (e) => {
      state.atr1.showSignals = e.target.checked;
      saveSettingsToLocalStorage();
      updateMarkers();
    });
    const recomputeATR1 = () => {
      state.atr1.length = parseInt(el.atr1Length.value, 10) || 14;
      state.atr1.mult = parseFloat(el.atr1Mult.value) || 4.0;
      state.atr1.maType = el.atr1MAType.value;
      state.atr1MALength = parseInt(el.atr1MALength.value, 10) || 55;
      saveSettingsToLocalStorage();
      recalculateATR1();
    };
    el.atr1Length.addEventListener('change', recomputeATR1);
    el.atr1Mult.addEventListener('change', recomputeATR1);
    el.atr1MAType.addEventListener('change', recomputeATR1);
    el.atr1MALength.addEventListener('change', recomputeATR1);

    // Sidebar ATR Bot 2 (Fast)
    el.toggleATR2.addEventListener('change', (e) => {
      state.atr2.enable = e.target.checked;
      saveSettingsToLocalStorage();
      updateMarkers();
      scheduleOverlayRender();
      updateActiveCount();
    });
    el.atr2ShowLines.addEventListener('change', (e) => {
      state.atr2.showLines = e.target.checked;
      saveSettingsToLocalStorage();
      scheduleOverlayRender();
    });
    el.atr2ShowRibbon.addEventListener('change', (e) => {
      state.atr2.showRibbon = e.target.checked;
      saveSettingsToLocalStorage();
      scheduleOverlayRender();
    });
    el.atr2ShowSignals.addEventListener('change', (e) => {
      state.atr2.showSignals = e.target.checked;
      saveSettingsToLocalStorage();
      updateMarkers();
    });
    const recomputeATR2 = () => {
      state.atr2.length = parseInt(el.atr2Length.value, 10) || 14;
      state.atr2.mult = parseFloat(el.atr2Mult.value) || 2.0;
      state.atr2.maType = el.atr2MAType.value;
      state.atr2.maLength = parseInt(el.atr2MALength.value, 10) || 21;
      saveSettingsToLocalStorage();
      recalculateATR2();
    };
    el.atr2Length.addEventListener('change', recomputeATR2);
    el.atr2Mult.addEventListener('change', recomputeATR2);
    el.atr2MAType.addEventListener('change', recomputeATR2);
    el.atr2MALength.addEventListener('change', recomputeATR2);
  }

  function updateActiveCount() {
    let count = 0;
    if (state.fvg.enable) count++;
    if (state.vsr.enable) count++;
    if (state.atr1.enable) count++;
    if (state.atr2.enable) count++;
    el.activeIndicatorsCount.textContent = `${count} Active`;
  }

  // --- Initialize TradingView Chart ---
  function initChart() {
    const width = el.chartContainer.clientWidth || 800;
    const height = el.chartContainer.clientHeight || 500;

    chart = LightweightCharts.createChart(el.chartContainer, {
      width: width,
      height: height,
      layout: {
        background: { type: 'solid', color: '#0b0e14' },
        textColor: '#94a3b8',
        fontSize: 11,
        fontFamily: "'JetBrains Mono', monospace"
      },
      grid: {
        vertLines: { color: 'rgba(38, 48, 66, 0.4)' },
        horzLines: { color: 'rgba(38, 48, 66, 0.4)' }
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: {
          color: '#38bdf8',
          width: 1,
          style: LightweightCharts.LineStyle.Dashed,
          labelBackgroundColor: '#0284c7'
        },
        horzLine: {
          color: '#38bdf8',
          width: 1,
          style: LightweightCharts.LineStyle.Dashed,
          labelBackgroundColor: '#0284c7'
        }
      },
      rightPriceScale: {
        borderColor: '#263042',
        autoScale: true,
        scaleMargins: { top: 0.06, bottom: 0.22 }
      },
      timeScale: {
        borderColor: '#263042',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 12,
        barSpacing: 8,
        minBarSpacing: 2
      }
    });

    candleSeries = chart.addCandlestickSeries({
      upColor: '#10b981',
      downColor: '#f43f5e',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#f43f5e'
    });

    volumeSeries = chart.addHistogramSeries({
      color: '#10b981',
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol_pane',
      scaleMargins: { top: 0.82, bottom: 0 }
    });

    chart.priceScale('vol_pane').applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 }
    });

    ctx = el.overlayCanvas.getContext('2d');
    resizeCanvas();

    resizeObserver = new ResizeObserver(() => {
      if (chart && el.chartContainer) {
        const w = el.chartContainer.clientWidth;
        const h = el.chartContainer.clientHeight;
        chart.resize(w, h);
        resizeCanvas();
        scheduleOverlayRender();
      }
    });
    resizeObserver.observe(el.chartContainer);

    chart.timeScale().subscribeVisibleLogicalRangeChange(() => scheduleOverlayRender());
    chart.timeScale().subscribeVisibleTimeRangeChange(() => scheduleOverlayRender());
    chart.subscribeCrosshairMove((p) => updateCrosshairLegend(p));
  }

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const w = el.chartContainer.clientWidth;
    const h = el.chartContainer.clientHeight;
    el.overlayCanvas.width = w * dpr;
    el.overlayCanvas.height = h * dpr;
    el.overlayCanvas.style.width = w + 'px';
    el.overlayCanvas.style.height = h + 'px';
    ctx.scale(dpr, dpr);
  }

  // --- Dynamic PriceScale Detection ---
  function detectAndApplyPriceScale(rows) {
    if (!rows || rows.length === 0) return;

    let maxDecimals = 2;
    let minPrice = Infinity, maxPrice = -Infinity;

    const checkCount = Math.min(rows.length, 100);
    for (let i = 0; i < checkCount; i++) {
      const r = rows[i];
      if (r.close === undefined) continue;
      const p = Number(r.close);
      if (p < minPrice) minPrice = p;
      if (p > maxPrice) maxPrice = p;
      const pStr = String(r.close);
      if (pStr.includes('.')) {
        const dec = pStr.split('.')[1].length;
        if (dec > maxDecimals) maxDecimals = dec;
      }
    }

    const avg = (minPrice + maxPrice) / 2;
    if (avg >= 1000) maxDecimals = Math.max(maxDecimals, 2);
    else if (avg >= 10) maxDecimals = Math.max(maxDecimals, 2);
    else if (avg >= 1) maxDecimals = Math.max(maxDecimals, 4);
    else if (avg >= 0.01) maxDecimals = Math.max(maxDecimals, 5);
    else if (avg >= 0.0001) maxDecimals = Math.max(maxDecimals, 6);
    else maxDecimals = Math.max(maxDecimals, 8);

    maxDecimals = Math.min(maxDecimals, 8);
    const minMove = parseFloat(Math.pow(10, -maxDecimals).toFixed(maxDecimals));

    state.pricePrecision = maxDecimals;
    state.priceMinMove = minMove;

    candleSeries.applyOptions({
      priceFormat: { type: 'price', precision: maxDecimals, minMove: minMove }
    });

    chart.priceScale('right').applyOptions({
      autoScale: true,
      scaleMargins: { top: 0.06, bottom: 0.22 }
    });

    el.statScale.textContent = `${maxDecimals} dec (${minMove})`;
  }

  function formatPrice(val) {
    if (val === null || val === undefined || isNaN(val)) return '--';
    return Number(val).toFixed(state.pricePrecision);
  }

  // --- Kline 20k LocalStorage Cache Engine ---
  const KLINE_CACHE_PREFIX = 'smc_kline_20k_';

  function getKlineCacheKey(symbol, interval) {
    return `${KLINE_CACHE_PREFIX}${symbol.toUpperCase()}_${interval}`;
  }

  function getIntervalDurationMs(interval) {
    const unit = interval.slice(-1);
    const val = parseInt(interval, 10) || 1;
    if (unit === 'm') return val * 60 * 1000;
    if (unit === 'h') return val * 60 * 60 * 1000;
    if (unit === 'd') return val * 24 * 60 * 60 * 1000;
    return 15 * 60 * 1000;
  }

  function saveKlinesToLocalStorage(symbol, interval, rows) {
    if (!rows || rows.length === 0) return;
    const key = getKlineCacheKey(symbol, interval);
    try {
      // Save compact format: [time_seconds, open, high, low, close, volume]
      const compact = rows.map(r => [
        r.time,
        r.open,
        r.high,
        r.low,
        r.close,
        r.volume
      ]);
      localStorage.setItem(key, JSON.stringify(compact));
    } catch (e) {
      console.warn('LocalStorage quota reached, pruning older symbol kline caches:', e);
      try {
        const toDelete = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith(KLINE_CACHE_PREFIX) && k !== key) {
            toDelete.push(k);
          }
        }
        for (const k of toDelete) localStorage.removeItem(k);

        const compact = rows.map(r => [r.time, r.open, r.high, r.low, r.close, r.volume]);
        localStorage.setItem(key, JSON.stringify(compact));
      } catch (err2) {
        console.warn('Could not save klines to localStorage after pruning:', err2);
      }
    }
  }

  function loadKlinesFromLocalStorage(symbol, interval) {
    const key = getKlineCacheKey(symbol, interval);
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const compact = JSON.parse(raw);
      if (!Array.isArray(compact) || compact.length === 0) return null;

      const rows = compact.map(c => ({
        open_time: c[0] * 1000,
        time: c[0],
        open: c[1],
        high: c[2],
        low: c[3],
        close: c[4],
        volume: c[5],
        datetime: new Date(c[0] * 1000).toISOString().replace('T', ' ').slice(0, 19)
      }));

      return rows;
    } catch (e) {
      console.warn('Failed to load klines from localStorage:', e);
      return null;
    }
  }

  // --- Fetch Live Binance Futures Data with 20k Storage Support ---
  async function fetchLiveBinance(symbol, interval, totalLimit = 20000, forceFullRefresh = false) {
    state.symbol = symbol;
    state.timeframe = interval;
    state.candleLimit = totalLimit;

    // 1. Cache-First: Try reading from browser localStorage
    const cachedRows = !forceFullRefresh ? loadKlinesFromLocalStorage(symbol, interval) : null;

    if (cachedRows && cachedRows.length > 0) {
      // Immediately render cached 20,000 candles (< 15ms)
      processRawData(cachedRows, `Cache 💾 (${cachedRows.length.toLocaleString()} candles)`);

      if (state.enableLiveWs) {
        connectWebSocket(symbol, interval);
      }

      // Check missing candles since last cached candle
      const lastCandle = cachedRows[cachedRows.length - 1];
      const lastCachedMs = lastCandle.open_time || (lastCandle.time * 1000);
      const tfDuration = getIntervalDurationMs(interval);
      const missingCount = Math.floor((Date.now() - lastCachedMs) / tfDuration);

      if (missingCount > 0 && missingCount <= 1500) {
        // Quick background delta update
        fetchDeltaCandles(symbol, interval, lastCachedMs, cachedRows, totalLimit);
      } else if (missingCount > 1500) {
        // Cache is too old, run full fetch
        fetchFullCandles(symbol, interval, totalLimit);
      }
      return;
    }

    // 2. No cache in localStorage or force refresh: Fetch full 20,000 candles in chunks
    await fetchFullCandles(symbol, interval, totalLimit);
  }

  // Fetch missing delta candles and merge into cached 20k array
  async function fetchDeltaCandles(symbol, interval, lastCachedMs, cachedRows, totalLimit) {
    try {
      const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&startTime=${lastCachedMs}&limit=1500`;
      const res = await fetch(url);
      if (!res.ok) return;
      const klines = await res.json();
      if (!klines || !Array.isArray(klines) || klines.length === 0) return;

      const deltaRows = klines.map(k => ({
        open_time: k[0],
        time: Math.floor(k[0] / 1000),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
        datetime: new Date(k[0]).toISOString().replace('T', ' ').slice(0, 19)
      }));

      // Merge and deduplicate
      const seen = new Set();
      const merged = [];
      for (const r of cachedRows) {
        if (!seen.has(r.open_time)) {
          seen.add(r.open_time);
          merged.push(r);
        }
      }
      for (const r of deltaRows) {
        if (!seen.has(r.open_time)) {
          seen.add(r.open_time);
          merged.push(r);
        } else {
          // Update the existing candle if open
          const idx = merged.findIndex(m => m.open_time === r.open_time);
          if (idx !== -1) merged[idx] = r;
        }
      }
      merged.sort((a, b) => a.open_time - b.open_time);

      // Keep up to totalLimit (e.g. 20,000) candles
      const finalRows = merged.length > totalLimit ? merged.slice(-totalLimit) : merged;

      saveKlinesToLocalStorage(symbol, interval, finalRows);
      processRawData(finalRows, `Cache + Synced 💾 (${finalRows.length.toLocaleString()})`);
    } catch (e) {
      console.warn('Delta fetch error:', e);
    }
  }

  // Fetch full dataset (up to 20,000 candles) chunk by chunk from Binance Futures
  async function fetchFullCandles(symbol, interval, totalLimit = 20000) {
    setStatus('loading', `Downloading ${totalLimit.toLocaleString()} candles for ${symbol} (${interval})...`);
    const url = 'https://fapi.binance.com/fapi/v1/klines';
    let allCandles = [];
    let endTime = null;
    let remaining = totalLimit;

    try {
      while (remaining > 0) {
        const fetchLimit = Math.min(remaining, 1500);
        let fetchUrl = `${url}?symbol=${symbol}&interval=${interval}&limit=${fetchLimit}`;
        if (endTime) fetchUrl += `&endTime=${endTime}`;

        const res = await fetch(fetchUrl);
        if (!res.ok) throw new Error(`Binance API error HTTP ${res.status}`);
        const klines = await res.json();
        if (!klines || !Array.isArray(klines) || klines.length === 0) break;

        allCandles = klines.concat(allCandles);
        remaining -= klines.length;
        endTime = klines[0][0] - 1;

        const downloaded = allCandles.length;
        setStatus('loading', `Downloading ${totalLimit.toLocaleString()} candles: ${downloaded.toLocaleString()} / ${totalLimit.toLocaleString()}...`);

        if (klines.length < fetchLimit) break;
      }

      if (allCandles.length === 0) throw new Error('No candles returned for ' + symbol);

      const rows = allCandles.map(k => ({
        open_time: k[0],
        time: Math.floor(k[0] / 1000),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
        datetime: new Date(k[0]).toISOString().replace('T', ' ').slice(0, 19)
      }));

      const seen = new Set();
      const uniqueRows = [];
      for (const r of rows) {
        if (!seen.has(r.open_time)) {
          seen.add(r.open_time);
          uniqueRows.push(r);
        }
      }
      uniqueRows.sort((a, b) => a.open_time - b.open_time);

      // Save full 20k to browser localStorage
      saveKlinesToLocalStorage(symbol, interval, uniqueRows);

      state.symbol = symbol;
      state.timeframe = interval;
      processRawData(uniqueRows, `Saved to Storage 💾 (${uniqueRows.length.toLocaleString()} candles)`);

      if (state.enableLiveWs) {
        connectWebSocket(symbol, interval);
      }

    } catch (err) {
      console.error('Binance fetch error:', err);
      setStatus('error', `Download failed: ${err.message}`);
    }
  }

  // --- Binance Futures Real-Time WebSocket Streaming ---
  function connectWebSocket(symbol, interval) {
    closeWebSocket();

    const streamName = `${symbol.toLowerCase()}@kline_${interval}`;
    const wsUrl = `wss://fstream.binance.com/ws/${streamName}`;

    try {
      liveWs = new WebSocket(wsUrl);

      liveWs.onopen = () => {
        setStatus('ready', `Live WebSocket: ${symbol} (${interval})`);
      };

      liveWs.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data && data.e === 'kline' && data.k) {
            handleLiveKlineUpdate(data.k);
          }
        } catch (e) {
          console.error('WS parse error:', e);
        }
      };

      liveWs.onerror = (err) => {
        console.warn('WS error:', err);
      };

      liveWs.onclose = () => {};
    } catch (e) {
      console.warn('WebSocket init failed:', e);
    }
  }

  function closeWebSocket() {
    if (liveWs) {
      try {
        liveWs.close();
      } catch (e) {}
      liveWs = null;
    }
  }

  function handleLiveKlineUpdate(k) {
    if (!state.chartData || state.chartData.length === 0) return;

    const candleTime = Math.floor(k.t / 1000);
    const open = parseFloat(k.o);
    const high = parseFloat(k.h);
    const low = parseFloat(k.l);
    const close = parseFloat(k.c);
    const vol = parseFloat(k.v);
    const isClosed = k.x;

    const lastIdx = state.chartData.length - 1;
    const lastCandle = state.chartData[lastIdx];

    if (lastCandle.time === candleTime) {
      lastCandle.open = open;
      lastCandle.high = high;
      lastCandle.low = low;
      lastCandle.close = close;
      lastCandle.volume = vol;
    } else if (candleTime > lastCandle.time) {
      state.chartData.push({
        time: candleTime,
        open: open,
        high: high,
        low: low,
        close: close,
        volume: vol
      });
      state.volumeData.push({
        time: candleTime,
        value: vol,
        color: close >= open ? 'rgba(16, 185, 129, 0.4)' : 'rgba(244, 63, 94, 0.4)'
      });
    }

    candleSeries.update({
      time: candleTime,
      open: open,
      high: high,
      low: low,
      close: close
    });

    volumeSeries.update({
      time: candleTime,
      value: vol,
      color: close >= open ? 'rgba(16, 185, 129, 0.4)' : 'rgba(244, 63, 94, 0.4)'
    });

    // Update real-time price in header
    el.tkPrice.textContent = `$${formatSymbolPrice(close)}`;

    const now = performance.now();
    if (isClosed || now - lastWsThrottle > 1000) {
      lastWsThrottle = now;
      recalculateFVG();
      recalculateVSR();
      recalculateATR1();
      recalculateATR2();
      updateMarkers();
      scheduleOverlayRender();
    }
  }

  // --- Process Raw OHLCV ---
  function processRawData(rows, sourceName) {
    if (!rows || rows.length === 0) {
      setStatus('error', 'Empty dataset');
      return;
    }

    state.rawData = rows;
    state.chartData = [];
    state.volumeData = [];

    const numRows = rows.length;

    for (let i = 0; i < numRows; i++) {
      const r = rows[i];
      if (r.open === undefined || r.high === undefined) continue;

      let candleTime = r.time;
      if (!candleTime && r.open_time) {
        candleTime = Math.floor(Number(r.open_time) / 1000);
      } else if (!candleTime && r.datetime) {
        candleTime = Math.floor(new Date(r.datetime).getTime() / 1000);
      }
      if (!candleTime) candleTime = i;

      const open = Number(r.open);
      const high = Number(r.high);
      const low = Number(r.low);
      const close = Number(r.close);
      const vol = Number(r.volume || 0);

      state.chartData.push({
        time: candleTime,
        open: open,
        high: high,
        low: low,
        close: close,
        volume: vol
      });

      state.volumeData.push({
        time: candleTime,
        value: vol,
        color: close >= open ? 'rgba(16, 185, 129, 0.4)' : 'rgba(244, 63, 94, 0.4)'
      });
    }

    detectAndApplyPriceScale(state.chartData);

    candleSeries.setData(state.chartData);
    volumeSeries.setData(state.volumeData);

    el.statCandles.textContent = state.chartData.length.toLocaleString();
    el.legendSymbol.textContent = `${state.symbol} (${state.timeframe}) • SMC + VSR + Dual ATR Bot`;

    // 100% Client-side JS calculations
    recalculateFVG();
    recalculateVSR();
    recalculateATR1();
    recalculateATR2();

    updateMarkers();
    updateHeaderTickerDisplay();
    chart.timeScale().fitContent();
    setStatus('ready', `Active: ${state.chartData.length.toLocaleString()} candles (${sourceName})`);
  }

  // --- 1. Calculate FVG ---
  function recalculateFVG() {
    if (!state.chartData || state.chartData.length === 0) return;

    const t0 = performance.now();
    const fvgResults = SMC.fvg(state.chartData, state.fvg.joinConsecutive);
    const duration = (performance.now() - t0).toFixed(1);

    state.fvgList = [];
    const numRows = state.chartData.length;

    for (let i = 0; i < numRows; i++) {
      const item = fvgResults[i];
      if (item && item.fvg !== null) {
        const isBull = item.fvg === 1;
        const topVal = Number(item.top);
        const btmVal = Number(item.bottom);
        const gapSize = Math.abs(topVal - btmVal);
        const basePrice = isBull ? btmVal : topVal;
        const sizePct = basePrice > 0 ? (gapSize / basePrice * 100) : 0;

        const mitIdx = (item.mitigatedIndex !== null && item.mitigatedIndex > 0) ? item.mitigatedIndex : null;
        let mitTime = null;
        let barsToMit = null;

        if (mitIdx !== null && mitIdx < numRows && state.chartData[mitIdx]) {
          mitTime = state.chartData[mitIdx].time;
          barsToMit = mitIdx - i;
        }

        state.fvgList.push({
          index: i,
          time: state.chartData[i].time,
          fvg: item.fvg,
          top: topVal,
          bottom: btmVal,
          size: gapSize,
          sizePct: sizePct,
          mitigatedIndex: mitIdx,
          mitigatedTime: mitTime,
          barsToMitigate: barsToMit
        });
      }
    }

    el.activeFVGCount.textContent = `${state.fvgList.length} FVGs (${duration}ms)`;
    updateTableAndStats();
    scheduleOverlayRender();
  }

  // --- 2. Calculate VSR (10-10) ---
  function recalculateVSR() {
    if (!state.chartData || state.chartData.length === 0) return;

    const vsrResults = VSR.calculate(state.chartData, {
      length: state.vsr.length,
      threshold: state.vsr.threshold
    });
    state.vsrData = vsrResults;

    const spikes = vsrResults.filter(r => r.isSpike);
    el.badgeVSRCount.textContent = `${spikes.length} Spikes`;

    updateMarkers();
    scheduleOverlayRender();
  }

  // --- 3. Calculate ATR Bot 1 (Slow / VIDYA 14/55/4) ---
  function recalculateATR1() {
    if (!state.chartData || state.chartData.length === 0) return;

    const atrResults = ATRBot.calculate(state.chartData, {
      atrLength: state.atr1.length,
      atrMult: state.atr1.mult,
      maType: state.atr1.maType,
      maLength: state.atr1.maLength,
      source: "close"
    });
    state.atr1Data = atrResults;

    if (atrResults.length > 0) {
      const lastTrend = atrResults[atrResults.length - 1].trend;
      el.badgeATR1Trend.textContent = lastTrend === 1 ? 'BULL' : 'BEAR';
      el.badgeATR1Trend.className = `badge-tag ${lastTrend === 1 ? 'badge-bull' : 'badge-bear'}`;
    }

    updateMarkers();
    scheduleOverlayRender();
  }

  // --- 4. Calculate ATR Bot 2 (Fast / VIDYA 14/21/2) ---
  function recalculateATR2() {
    if (!state.chartData || state.chartData.length === 0) return;

    const atrResults = ATRBot.calculate(state.chartData, {
      atrLength: state.atr2.length,
      atrMult: state.atr2.mult,
      maType: state.atr2.maType,
      maLength: state.atr2.maLength,
      source: "close"
    });
    state.atr2Data = atrResults;

    if (atrResults.length > 0) {
      const lastTrend = atrResults[atrResults.length - 1].trend;
      el.badgeATR2Trend.textContent = lastTrend === 1 ? 'BULL' : 'BEAR';
      el.badgeATR2Trend.className = `badge-tag ${lastTrend === 1 ? 'badge-bull' : 'badge-bear'}`;
    }

    updateMarkers();
    scheduleOverlayRender();
  }

  // --- Update Markers on Candlestick Series ---
  function updateMarkers() {
    const markers = [];

    // 1. ATR Bot 1 (Slow / Trend) Signals
    if (state.atr1.enable && state.atr1.showSignals && state.atr1Data.length > 0) {
      for (let i = 0; i < state.atr1Data.length; i++) {
        const item = state.atr1Data[i];
        if (item.isBuy) {
          markers.push({
            time: item.time,
            position: 'belowBar',
            color: '#a855f7',
            shape: 'arrowUp',
            text: 'T-BUY',
            size: 2
          });
        } else if (item.isSell) {
          markers.push({
            time: item.time,
            position: 'aboveBar',
            color: '#ec4899',
            shape: 'arrowDown',
            text: 'T-SELL',
            size: 2
          });
        }
      }
    }

    // 2. ATR Bot 2 (Fast / Scalp) Signals
    if (state.atr2.enable && state.atr2.showSignals && state.atr2Data.length > 0) {
      for (let i = 0; i < state.atr2Data.length; i++) {
        const item = state.atr2Data[i];
        if (item.isBuy) {
          markers.push({
            time: item.time,
            position: 'belowBar',
            color: '#10b981',
            shape: 'arrowUp',
            text: 'BUY',
            size: 1
          });
        } else if (item.isSell) {
          markers.push({
            time: item.time,
            position: 'aboveBar',
            color: '#f43f5e',
            shape: 'arrowDown',
            text: 'SELL',
            size: 1
          });
        }
      }
    }

    // 3. VSR Volume Spikes
    if (state.vsr.enable && state.vsr.showSpikes && state.vsrData.length > 0) {
      for (let i = 0; i < state.vsrData.length; i++) {
        const item = state.vsrData[i];
        if (item.isSpike) {
          markers.push({
            time: item.time,
            position: 'aboveBar',
            color: '#facc15',
            shape: 'circle',
            text: `⚡ VSR (${item.signal.toFixed(1)}x)`,
            size: 1
          });
        }
      }
    }

    markers.sort((a, b) => a.time - b.time);
    candleSeries.setMarkers(markers);
  }

  // --- Update FVG Table & Statistics ---
  function updateTableAndStats() {
    const list = state.fvgList;
    let bullCount = 0, bearCount = 0, mitCount = 0, unmitCount = 0;
    let totalBars = 0, mitBarsCount = 0, totalPct = 0;
    const filteredForDisplay = [];

    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      const isBull = item.fvg === 1;
      const isMit = item.mitigatedIndex !== null;

      if (isBull) bullCount++;
      else bearCount++;

      if (isMit) {
        mitCount++;
        if (item.barsToMitigate !== null) {
          totalBars += item.barsToMitigate;
          mitBarsCount++;
        }
      } else {
        unmitCount++;
      }

      totalPct += item.sizePct;

      if (isBull && !state.fvg.bullish) continue;
      if (!isBull && !state.fvg.bearish) continue;
      if (state.fvg.unmitigatedOnly && isMit) continue;
      if (item.sizePct < state.minGapPercent) continue;

      filteredForDisplay.push(item);
    }

    const total = list.length;
    const mitRate = total > 0 ? ((mitCount / total) * 100).toFixed(1) : '0.0';
    const avgBars = mitBarsCount > 0 ? (totalBars / mitBarsCount).toFixed(1) : '0';
    const avgGapPct = total > 0 ? (totalPct / total).toFixed(2) : '0.00';

    el.statTotalFVG.textContent = total.toLocaleString();
    el.statMitigationRate.textContent = `${mitRate}%`;
    el.statBullCount.textContent = bullCount.toLocaleString();
    el.statBearCount.textContent = bearCount.toLocaleString();
    el.statUnmitCount.textContent = unmitCount.toLocaleString();
    el.statAvgBars.textContent = `${avgBars} bars`;
    el.statAvgGapSize.textContent = `${avgGapPct}%`;
    el.listCounter.textContent = `${filteredForDisplay.length} / ${total} FVGs`;

    renderFVGTable(filteredForDisplay);
  }

  function renderFVGTable(filteredList) {
    if (filteredList.length === 0) {
      el.fvgTableBody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding:15px;color:#64748b;">No FVGs matching active filters</td></tr>';
      return;
    }

    const displayList = filteredList.slice(-150).reverse();
    let html = '';

    for (let i = 0; i < displayList.length; i++) {
      const item = displayList[i];
      const isBull = item.fvg === 1;
      const isMit = item.mitigatedIndex !== null;

      const typeBadge = isBull
        ? '<span class="badge-tbl badge-bull">+FVG</span>'
        : '<span class="badge-tbl badge-bear">-FVG</span>';

      const statusBadge = isMit
        ? `<span class="badge-tbl badge-mit">Mit @ #${item.mitigatedIndex} (+${item.barsToMitigate}b)</span>`
        : '<span class="badge-tbl badge-active">Active (Open)</span>';

      html += `<tr data-time="${item.time}">
        <td style="color:#64748b;">#${item.index}</td>
        <td>${typeBadge}</td>
        <td>${formatPrice(item.top)}</td>
        <td>${formatPrice(item.bottom)}</td>
        <td style="color:#38bdf8;">${item.sizePct.toFixed(2)}%</td>
        <td>${statusBadge}</td>
      </tr>`;
    }

    el.fvgTableBody.innerHTML = html;

    const rows = el.fvgTableBody.querySelectorAll('tr[data-time]');
    rows.forEach(r => {
      r.addEventListener('click', () => {
        const t = parseInt(r.dataset.time, 10);
        if (t && chart) {
          const step = state.chartData[1]?.time - state.chartData[0]?.time || 900;
          chart.timeScale().setVisibleRange({
            from: t - 50 * step,
            to: t + 50 * step
          });
        }
      });
    });
  }

  // --- Canvas Overlay Rendering: FVG + VSR + Dual ATR Bot ---
  function scheduleOverlayRender() {
    if (!renderScheduled) {
      renderScheduled = true;
      requestAnimationFrame(() => {
        renderOverlay();
        renderScheduled = false;
      });
    }
  }

  function renderOverlay() {
    if (!chart || !candleSeries || !ctx) return;

    const w = el.chartContainer.clientWidth;
    const h = el.chartContainer.clientHeight;
    ctx.clearRect(0, 0, w, h);

    const timeScale = chart.timeScale();
    const visibleRange = timeScale.getVisibleRange();
    if (!visibleRange) return;

    const fromTime = visibleRange.from;
    const toTime = visibleRange.to;

    const getX = (t) => (t !== null && t !== undefined) ? timeScale.timeToCoordinate(t) : null;
    const getY = (p) => (p !== null && p !== undefined && !isNaN(p)) ? candleSeries.priceToCoordinate(p) : null;
    const rightViewportX = w - 65;

    // 1. Draw ATR Bot 1 (Slow / VIDYA 14/55/4)
    if (state.atr1.enable && state.atr1Data.length > 0) {
      renderSingleATRBotOverlay(state.atr1Data, state.atr1, '#a855f7', '#ec4899', 'rgba(168, 85, 247, 0.14)', 'rgba(236, 72, 153, 0.14)', getX, getY, fromTime, toTime);
    }

    // 2. Draw ATR Bot 2 (Fast / VIDYA 14/21/2)
    if (state.atr2.enable && state.atr2Data.length > 0) {
      renderSingleATRBotOverlay(state.atr2Data, state.atr2, '#06b6d4', '#f59e0b', 'rgba(16, 185, 129, 0.16)', 'rgba(244, 63, 94, 0.16)', getX, getY, fromTime, toTime);
    }

    // 3. Draw VSR Zones
    if (state.vsr.enable && state.vsr.showZone && state.vsrData.length > 0) {
      renderVSROverlay(getX, getY, fromTime, toTime);
    }

    // 4. Draw FVG Boxes
    if (state.fvg.enable) {
      renderFVGOverlay(getX, getY, fromTime, toTime, rightViewportX);
    }

    // 5. Draw Measurement Tool (Shift + Click Measure)
    if (measure.start && measure.current && (measure.isMeasuring || measure.isPinned)) {
      renderMeasurementOverlay(getX, getY, fromTime, toTime);
    }
  }

  // --- Draw Measurement Tool Box & Metrics ---
  function renderMeasurementOverlay(getX, getY, fromTime, toTime) {
    const t1 = measure.start.time;
    const t2 = measure.current.time;
    const p1 = measure.start.price;
    const p2 = measure.current.price;

    const x1 = getX(t1);
    const x2 = getX(t2);
    const y1 = getY(p1);
    const y2 = getY(p2);

    if (x1 === null || x2 === null || y1 === null || y2 === null) return;

    const isBull = p2 >= p1;
    const color = isBull ? '#38bdf8' : '#f43f5e';
    const fillColor = isBull ? 'rgba(56, 189, 248, 0.18)' : 'rgba(244, 63, 94, 0.18)';
    const borderColor = isBull ? 'rgba(56, 189, 248, 0.9)' : 'rgba(244, 63, 94, 0.9)';

    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    const boxW = Math.max(maxX - minX, 2);
    const boxH = Math.max(maxY - minY, 2);

    ctx.save();

    // 1. Measure Shaded Box
    ctx.fillStyle = fillColor;
    ctx.fillRect(minX, minY, boxW, boxH);

    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(minX, minY, boxW, boxH);

    // 2. Diagonal Vector Line
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 2]);
    ctx.stroke();

    // 3. Anchor Points
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x1, y1, 4, 0, Math.PI * 2);
    ctx.arc(x2, y2, 4, 0, Math.PI * 2);
    ctx.fill();

    // 4. Calculate Detailed Metrics
    const deltaPrice = p2 - p1;
    const pct = p1 > 0 ? (deltaPrice / p1 * 100) : 0;
    const sign = isBull ? '+' : '';

    let barCount = 1;
    let volSum = 0;
    if (state.chartData && state.chartData.length > 0) {
      const idx1 = state.chartData.findIndex(c => c.time === t1);
      const idx2 = state.chartData.findIndex(c => c.time === t2);
      if (idx1 !== -1 && idx2 !== -1) {
        const startIdx = Math.min(idx1, idx2);
        const endIdx = Math.max(idx1, idx2);
        barCount = endIdx - startIdx + 1;
        for (let i = startIdx; i <= endIdx; i++) {
          volSum += (state.chartData[i].volume || 0);
        }
      }
    }

    const durationSec = Math.abs(t2 - t1);
    const durationStr = formatDuration(durationSec);

    // 5. Draw Floating Metric Card
    const cardW = 185;
    const cardH = 64;
    let cardX = (x1 + x2) / 2 - cardW / 2;
    let cardY = minY - cardH - 12;

    const maxViewportW = el.chartContainer.clientWidth || 800;
    if (cardX < 10) cardX = 10;
    if (cardX + cardW > maxViewportW - 65) cardX = maxViewportW - 65 - cardW;
    if (cardY < 10) cardY = maxY + 12;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(cardX, cardY, cardW, cardH, 6);
    } else {
      ctx.rect(cardX, cardY, cardW, cardH);
    }
    ctx.fill();
    ctx.stroke();

    // Tooltip Typography
    ctx.font = 'bold 12px "JetBrains Mono", monospace';
    ctx.fillStyle = isBull ? '#38bdf8' : '#fb7185';
    ctx.fillText(`${isBull ? '▲' : '▼'} ${sign}${formatPrice(deltaPrice)} (${sign}${pct.toFixed(2)}%)`, cardX + 10, cardY + 20);

    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = '#cbd5e1';
    ctx.fillText(`📅 ${barCount} bars • ${durationStr}`, cardX + 10, cardY + 38);

    ctx.fillStyle = '#94a3b8';
    ctx.fillText(`📊 Vol: ${formatUSDVolume(volSum)}`, cardX + 10, cardY + 54);

    ctx.restore();
  }

  function formatDuration(sec) {
    if (sec <= 0) return '0m';
    const days = Math.floor(sec / 86400);
    const hours = Math.floor((sec % 86400) / 3600);
    const mins = Math.floor((sec % 3600) / 60);

    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  }

  // --- Draw FVG Zones ---
  function renderFVGOverlay(getX, getY, fromTime, toTime, rightViewportX) {
    const list = state.fvgList;
    const numRows = state.chartData.length;
    const latestCandleTime = numRows > 0 ? state.chartData[numRows - 1].time : toTime;

    const opacity = state.boxOpacity;
    const borderOpacity = Math.min(opacity + 0.45, 1.0);

    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      const isBull = item.fvg === 1;
      const isMit = item.mitigatedIndex !== null;

      if (isBull && !state.fvg.bullish) continue;
      if (!isBull && !state.fvg.bearish) continue;
      if (state.fvg.unmitigatedOnly && isMit) continue;
      if (item.sizePct < state.minGapPercent) continue;

      const endTime = item.mitigatedTime || latestCandleTime;
      if (endTime < fromTime || item.time > toTime) continue;

      const x1 = getX(item.time);
      const x2 = item.mitigatedTime ? getX(item.mitigatedTime) : rightViewportX;

      const startX = x1 !== null ? x1 : 0;
      const endX = x2 !== null ? x2 : rightViewportX;
      const boxWidth = Math.max(endX - startX, 4);

      const yTop = getY(item.top);
      const yBottom = getY(item.bottom);
      if (yTop === null || yBottom === null) continue;

      const boxY = Math.min(yTop, yBottom);
      const boxHeight = Math.max(Math.abs(yBottom - yTop), 1.5);

      ctx.save();
      if (isBull) {
        ctx.fillStyle = `rgba(16, 185, 129, ${isMit ? opacity * 0.5 : opacity})`;
        ctx.strokeStyle = `rgba(16, 185, 129, ${isMit ? borderOpacity * 0.6 : borderOpacity})`;
      } else {
        ctx.fillStyle = `rgba(244, 63, 94, ${isMit ? opacity * 0.5 : opacity})`;
        ctx.strokeStyle = `rgba(244, 63, 94, ${isMit ? borderOpacity * 0.6 : borderOpacity})`;
      }

      ctx.lineWidth = 1;
      ctx.fillRect(startX, boxY, boxWidth, boxHeight);
      ctx.strokeRect(startX, boxY, boxWidth, boxHeight);

      if (boxWidth > 32) {
        ctx.fillStyle = isBull ? '#10b981' : '#f43f5e';
        ctx.font = '10px "JetBrains Mono", monospace';
        const label = isBull ? `+FVG (${item.sizePct.toFixed(2)}%)` : `-FVG (${item.sizePct.toFixed(2)}%)`;
        ctx.fillText(label, startX + 4, boxY + 11);
      }
      ctx.restore();
    }
  }

  // --- Draw VSR Zone ---
  function renderVSROverlay(getX, getY, fromTime, toTime) {
    const data = state.vsrData;
    if (data.length < 2) return;

    ctx.save();

    ctx.fillStyle = 'rgba(250, 204, 21, 0.12)';
    ctx.beginPath();
    let started = false;

    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      if (item.time < fromTime || item.time > toTime) continue;
      if (item.upper === null || item.lower === null) continue;

      const x = getX(item.time);
      const yUpper = getY(item.upper);
      if (x === null || yUpper === null) continue;

      if (!started) {
        ctx.moveTo(x, yUpper);
        started = true;
      } else {
        ctx.lineTo(x, yUpper);
      }
    }

    for (let i = data.length - 1; i >= 0; i--) {
      const item = data[i];
      if (item.time < fromTime || item.time > toTime) continue;
      if (item.upper === null || item.lower === null) continue;

      const x = getX(item.time);
      const yLower = getY(item.lower);
      if (x === null || yLower === null) continue;

      ctx.lineTo(x, yLower);
    }

    if (started) {
      ctx.closePath();
      ctx.fill();
    }

    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 2]);

    // Upper line
    ctx.beginPath();
    started = false;
    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      if (item.time < fromTime || item.time > toTime) continue;
      if (item.upper === null) continue;
      const x = getX(item.time);
      const y = getY(item.upper);
      if (x === null || y === null) continue;
      if (!started) { ctx.moveTo(x, y); started = true; }
      else { ctx.lineTo(x, y); }
    }
    if (started) ctx.stroke();

    // Lower line
    ctx.beginPath();
    started = false;
    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      if (item.time < fromTime || item.time > toTime) continue;
      if (item.lower === null) continue;
      const x = getX(item.time);
      const y = getY(item.lower);
      if (x === null || y === null) continue;
      if (!started) { ctx.moveTo(x, y); started = true; }
      else { ctx.lineTo(x, y); }
    }
    if (started) ctx.stroke();

    ctx.restore();
  }

  // --- Draw Single ATR Bot ---
  function renderSingleATRBotOverlay(data, config, colorT1, colorT2, fillBull, fillBear, getX, getY, fromTime, toTime) {
    if (data.length < 2) return;

    ctx.save();

    // 1. Ribbon fill
    if (config.showRibbon) {
      for (let i = 1; i < data.length; i++) {
        const p1 = data[i - 1];
        const p2 = data[i];
        if (p2.time < fromTime || p1.time > toTime) continue;

        const x1 = getX(p1.time);
        const x2 = getX(p2.time);
        const y1_t1 = getY(p1.trail1);
        const y1_t2 = getY(p1.trail2);
        const y2_t1 = getY(p2.trail1);
        const y2_t2 = getY(p2.trail2);

        if (x1 === null || x2 === null || y1_t1 === null || y2_t1 === null) continue;

        const isBull = p2.trail1 >= p2.trail2;
        ctx.fillStyle = isBull ? fillBull : fillBear;

        ctx.beginPath();
        ctx.moveTo(x1, y1_t1);
        ctx.lineTo(x2, y2_t1);
        ctx.lineTo(x2, y2_t2);
        ctx.lineTo(x1, y1_t2);
        ctx.closePath();
        ctx.fill();
      }
    }

    // 2. Stroke lines
    if (config.showLines) {
      // Trail 1 line
      ctx.lineWidth = 1.8;
      ctx.setLineDash([]);
      ctx.strokeStyle = colorT1;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < data.length; i++) {
        const item = data[i];
        if (item.time < fromTime || item.time > toTime) continue;
        const x = getX(item.time);
        const y = getY(item.trail1);
        if (x === null || y === null) continue;
        if (!started) { ctx.moveTo(x, y); started = true; }
        else { ctx.lineTo(x, y); }
      }
      if (started) ctx.stroke();

      // Trail 2 line
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = colorT2;
      ctx.beginPath();
      started = false;
      for (let i = 0; i < data.length; i++) {
        const item = data[i];
        if (item.time < fromTime || item.time > toTime) continue;
        const x = getX(item.time);
        const y = getY(item.trail2);
        if (x === null || y === null) continue;
        if (!started) { ctx.moveTo(x, y); started = true; }
        else { ctx.lineTo(x, y); }
      }
      if (started) ctx.stroke();
    }

    ctx.restore();
  }

  // --- Crosshair Hover Inspector ---
  function updateCrosshairLegend(param) {
    if (!param || !param.time || !param.seriesData || !param.seriesData.get(candleSeries)) {
      return;
    }

    // Update real-time measurement tracking
    if (param.point && param.time) {
      const price = candleSeries.coordinateToPrice(param.point.y);
      measure.lastCrosshair = {
        time: param.time,
        price: price !== null ? price : (candle ? candle.close : null),
        x: param.point.x,
        y: param.point.y
      };

      if (measure.isMeasuring && measure.start) {
        measure.current = { ...measure.lastCrosshair };
        scheduleOverlayRender();
      }
    }

    const candle = param.seriesData.get(candleSeries);
    const vol = param.seriesData.get(volumeSeries);

    const open = candle.open;
    const high = candle.high;
    const low = candle.low;
    const close = candle.close;
    const change = ((close - open) / open * 100).toFixed(2);
    const isUp = close >= open;

    el.legOpen.textContent = formatPrice(open);
    el.legHigh.textContent = formatPrice(high);
    el.legLow.textContent = formatPrice(low);
    el.legClose.textContent = formatPrice(close);
    el.legClose.className = `val ${isUp ? 'val-up' : 'val-down'}`;
    el.legChange.textContent = `${isUp ? '+' : ''}${change}%`;
    el.legChange.className = `val ${isUp ? 'val-up' : 'val-down'}`;

    if (vol && vol.value !== undefined) {
      el.legVol.textContent = Number(vol.value).toLocaleString(undefined, { maximumFractionDigits: 1 });
    }

    let detailsHtml = '';

    // FVG info
    const matchFVG = state.fvgList.find(f => f.time === param.time);
    if (matchFVG) {
      const isBull = matchFVG.fvg === 1;
      const statusStr = matchFVG.mitigatedIndex !== null ? `Mit @ #${matchFVG.mitigatedIndex}` : 'Active';
      detailsHtml += `<span class="badge-tag ${isBull ? 'badge-fvg-tag' : 'badge-bear'}">${isBull ? '+FVG' : '-FVG'} (${formatPrice(matchFVG.bottom)} - ${formatPrice(matchFVG.top)} • ${statusStr})</span>`;
    }

    // VSR info
    const matchVSR = state.vsrData.find(v => v.time === param.time);
    if (matchVSR && matchVSR.upper !== null) {
      const isSpike = matchVSR.isSpike;
      detailsHtml += `<span class="badge-tag badge-vsr-tag">VSR [${formatPrice(matchVSR.lower)} - ${formatPrice(matchVSR.upper)}]${isSpike ? ' ⚡ SPIKE' : ''}</span>`;
    }

    // ATR Bot 1 (Slow)
    const matchATR1 = state.atr1Data.find(a => a.time === param.time);
    if (matchATR1 && state.atr1.enable) {
      const isBull = matchATR1.trail1 >= matchATR1.trail2;
      detailsHtml += `<span class="badge-tag badge-purple-tag">ATR1(55): T1=${formatPrice(matchATR1.trail1)} | T2=${formatPrice(matchATR1.trail2)} (${isBull ? 'BULL' : 'BEAR'})</span>`;
    }

    // ATR Bot 2 (Fast)
    const matchATR2 = state.atr2Data.find(a => a.time === param.time);
    if (matchATR2 && state.atr2.enable) {
      const isBull = matchATR2.trail1 >= matchATR2.trail2;
      detailsHtml += `<span class="badge-tag badge-atr-tag">ATR2(21): T1=${formatPrice(matchATR2.trail1)} | T2=${formatPrice(matchATR2.trail2)} (${isBull ? 'BULL' : 'BEAR'})</span>`;
    }

    el.legendDetails.innerHTML = detailsHtml;
  }

  function setStatus(type, msg) {
    el.statusBadge.className = `status-badge status-${type}`;
    el.statusText.textContent = msg;
  }

  // Bootstrap
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
