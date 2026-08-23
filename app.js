/**
 * Smart Money Concepts (SMC) Lightweight Charts Visualizer
 * Client-side rendering of Binance Futures SMC calculations
 * Dynamic priceScale auto-configuration & config.json integration
 */

(function () {
  'use strict';

  // --- State Management ---
  const state = {
    symbol: 'BTCUSDT',
    timeframe: '15m',
    currentFile: 'data_analize/BTCUSDT_15m.csv',
    pricePrecision: 2,
    priceMinMove: 0.01,
    rawData: [],        // Parsed rows
    chartData: [],      // Candlesticks [{ time, open, high, low, close }]
    volumeData: [],     // Volume [{ time, value, color }]
    smcData: {
      fvg: [],          // [{ index, time, fvg, top, bottom, mitigatedIndex, mitigatedTime }]
      ob: [],           // [{ index, time, ob, top, bottom, volume, mitigatedIndex, mitigatedTime, percentage }]
      structure: [],    // [{ index, time, type: 'BOS'|'CHOCH', dir: 1|-1, level, brokenIndex, brokenTime }]
      shl: [],          // [{ index, time, type: 'SH'|'SL', level }]
      liquidity: [],    // [{ index, time, dir: 1|-1, level, endIdx, endTime, sweptIdx, sweptTime }]
      pdhl: []          // [{ time, pdh, pdl, brokenHigh, brokenLow }]
    },
    toggles: {
      fvg: true,
      fvgBullish: true,
      fvgBearish: true,
      fvgUnmitigatedOnly: false,
      fvgJoinConsecutive: false,
      ob: true,
      obBullish: true,
      obBearish: true,
      obUnmitigatedOnly: false,
      structure: true,
      bos: true,
      choch: true,
      shl: true,
      shlHighs: true,
      shlLows: true,
      liquidity: true,
      liqBullish: true,
      liqBearish: true,
      pdhl: true,
      pdhLine: true,
      pdlLine: true,
      volume: true
    }
  };

  // --- DOM Elements ---
  const el = {
    datasetSelect: document.getElementById('datasetSelect'),
    btnRefreshConfig: document.getElementById('btnRefreshConfig'),
    symbolInput: document.getElementById('symbolInput'),
    timeframeSelect: document.getElementById('timeframeSelect'),
    btnLoadData: document.getElementById('btnLoadData'),
    csvFileInput: document.getElementById('csvFileInput'),
    statusBadge: document.getElementById('statusBadge'),
    statusText: document.getElementById('statusText'),
    statScale: document.getElementById('statScale'),
    statCandles: document.getElementById('statCandles'),
    statRange: document.getElementById('statRange'),
    chartContainer: document.getElementById('chartContainer'),
    overlayCanvas: document.getElementById('smcOverlayCanvas'),
    legendSymbol: document.getElementById('legendSymbol'),
    legOpen: document.getElementById('legOpen'),
    legHigh: document.getElementById('legHigh'),
    legLow: document.getElementById('legLow'),
    legClose: document.getElementById('legClose'),
    legVol: document.getElementById('legVol'),
    legChange: document.getElementById('legChange'),
    legendSMC: document.getElementById('legendSMC'),
    activeIndicatorsCount: document.getElementById('activeIndicatorsCount'),
    countFVG: document.getElementById('countFVG'),
    countOB: document.getElementById('countOB'),
    countStructure: document.getElementById('countStructure'),
    countSHL: document.getElementById('countSHL'),
    countLiquidity: document.getElementById('countLiquidity'),
    btnAllOn: document.getElementById('btnAllOn'),
    btnAllOff: document.getElementById('btnAllOff')
  };

  // --- Chart & Series Handles ---
  let chart = null;
  let candleSeries = null;
  let volumeSeries = null;
  let ctx = null;
  let resizeObserver = null;
  let renderScheduled = false;

  // --- Initialize Application ---
  function init() {
    setupUIEvents();
    initChart();
    loadConfigAndDatasets();
  }

  // --- Load config.json and populate dataset dropdown ---
  function loadConfigAndDatasets() {
    setStatus('loading', 'Loading config.json...');
    fetch(`config.json?t=${Date.now()}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((config) => {
        populateDatasetDropdown(config);
        const targetFile = config.default_file || (config.datasets && config.datasets[0] ? config.datasets[0].filepath : 'data_analize/BTCUSDT_15m.csv');
        loadCSVFile(targetFile);
      })
      .catch((err) => {
        console.warn('Could not load config.json, trying manifest.json or default BTCUSDT_15m.csv', err);
        fetch(`data_analize/manifest.json?t=${Date.now()}`)
          .then(r => r.json())
          .then(manifest => {
            populateDatasetDropdown({ datasets: manifest.files || [] });
            loadCSVFile('data_analize/BTCUSDT_15m.csv');
          })
          .catch(() => {
            loadCSVFile('data_analize/BTCUSDT_15m.csv');
          });
      });
  }

  function populateDatasetDropdown(config) {
    const datasets = config.datasets || [];
    el.datasetSelect.innerHTML = '';

    if (datasets.length === 0) {
      const opt = document.createElement('option');
      opt.value = 'data_analize/BTCUSDT_15m.csv';
      opt.textContent = 'BTCUSDT (15m)';
      el.datasetSelect.appendChild(opt);
      return;
    }

    datasets.forEach((item, index) => {
      const opt = document.createElement('option');
      const filepath = item.filepath || `data_analize/${item.filename}`;
      opt.value = filepath;
      opt.dataset.symbol = item.symbol;
      opt.dataset.timeframe = item.timeframe;

      const candleStr = item.candles ? `${Number(item.candles).toLocaleString()} candles` : '';
      opt.textContent = `${item.symbol} (${item.timeframe}) ${candleStr ? '• ' + candleStr : ''}`;
      
      if (index === 0) opt.selected = true;
      el.datasetSelect.appendChild(opt);
    });
  }

  // --- Dynamic PriceScale & Precision Detection ---
  function detectAndApplyPriceScale(rows) {
    if (!rows || rows.length === 0) return;

    let maxDecimals = 2;
    let minPrice = Infinity;
    let maxPrice = -Infinity;

    // Inspect first 100 rows to determine decimal precision & price level
    const checkCount = Math.min(rows.length, 100);
    for (let i = 0; i < checkCount; i++) {
      const r = rows[i];
      if (r.close === undefined) continue;

      const p = Number(r.close);
      if (p < minPrice) minPrice = p;
      if (p > maxPrice) maxPrice = p;

      const pStr = String(r.close);
      if (pStr.includes('.')) {
        const decimals = pStr.split('.')[1].length;
        if (decimals > maxDecimals) maxDecimals = decimals;
      }
    }

    const avgPrice = (minPrice + maxPrice) / 2;

    // Rule-based minimum precision based on price magnitude
    if (avgPrice >= 1000) {
      maxDecimals = Math.max(maxDecimals, 2);
    } else if (avgPrice >= 10) {
      maxDecimals = Math.max(maxDecimals, 2);
    } else if (avgPrice >= 1) {
      maxDecimals = Math.max(maxDecimals, 4);
    } else if (avgPrice >= 0.01) {
      maxDecimals = Math.max(maxDecimals, 5);
    } else if (avgPrice >= 0.0001) {
      maxDecimals = Math.max(maxDecimals, 6);
    } else {
      maxDecimals = Math.max(maxDecimals, 8);
    }

    // Limit maximum to 8 decimals
    maxDecimals = Math.min(maxDecimals, 8);
    const minMove = parseFloat(Math.pow(10, -maxDecimals).toFixed(maxDecimals));

    state.pricePrecision = maxDecimals;
    state.priceMinMove = minMove;

    // Apply to Candlestick Series
    candleSeries.applyOptions({
      priceFormat: {
        type: 'price',
        precision: maxDecimals,
        minMove: minMove
      }
    });

    // Ensure Right Price Scale has proper auto-scaling and padding
    chart.priceScale('right').applyOptions({
      autoScale: true,
      mode: LightweightCharts.PriceScaleMode.Normal,
      scaleMargins: {
        top: 0.06,
        bottom: 0.22
      },
      alignLabels: true
    });

    // Update UI Stat Badge
    el.statScale.textContent = `${maxDecimals} dec (${minMove})`;
  }

  // --- Format price helper ---
  function formatPrice(val) {
    if (val === null || val === undefined || isNaN(val)) return '--';
    return Number(val).toFixed(state.pricePrecision);
  }

  // --- Setup UI Event Listeners ---
  function setupUIEvents() {
    // Dataset Dropdown selection
    el.datasetSelect.addEventListener('change', (e) => {
      const selectedFile = e.target.value;
      const selectedOption = e.target.selectedOptions[0];
      if (selectedOption && selectedOption.dataset.symbol) {
        state.symbol = selectedOption.dataset.symbol;
        el.symbolInput.value = state.symbol;
      }
      if (selectedOption && selectedOption.dataset.timeframe) {
        state.timeframe = selectedOption.dataset.timeframe;
        el.timeframeSelect.value = state.timeframe;
      }
      loadCSVFile(selectedFile);
    });

    // Refresh Config button
    el.btnRefreshConfig.addEventListener('click', () => {
      loadConfigAndDatasets();
    });

    // Load Data button from manual input
    el.btnLoadData.addEventListener('click', () => {
      state.symbol = el.symbolInput.value.trim().toUpperCase() || 'BTCUSDT';
      state.timeframe = el.timeframeSelect.value;
      const targetFile = `data_analize/${state.symbol}_${state.timeframe}.csv`;
      loadCSVFile(targetFile);
    });

    el.symbolInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        el.btnLoadData.click();
      }
    });

    el.csvFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        setStatus('loading', `Reading ${file.name}...`);
        Papa.parse(file, {
          header: true,
          dynamicTyping: true,
          skipEmptyLines: true,
          complete: (results) => {
            processParsedData(results.data, file.name);
          },
          error: (err) => {
            setStatus('error', `CSV Parse Error: ${err.message}`);
          }
        });
      }
    });

    // Indicator Checkbox Toggles
    const bindToggle = (id, prop) => {
      const checkbox = document.getElementById(id);
      if (checkbox) {
        checkbox.addEventListener('change', (e) => {
          state.toggles[prop] = e.target.checked;
          if (prop === 'volume') {
            if (volumeSeries) {
              volumeSeries.applyOptions({ visible: e.target.checked });
            }
          }
          if (prop === 'shl' || prop === 'shlHighs' || prop === 'shlLows') {
            updateMarkers();
          }
          scheduleOverlayRender();
          updateActiveIndicatorsCount();
        });
      }
    };

    bindToggle('toggleFVG', 'fvg');
    bindToggle('fvgBullish', 'fvgBullish');
    bindToggle('fvgBearish', 'fvgBearish');
    bindToggle('fvgUnmitigatedOnly', 'fvgUnmitigatedOnly');
    
    // JS FVG Engine dynamic recomputation
    const cbJoinConsecutive = document.getElementById('fvgJoinConsecutive');
    if (cbJoinConsecutive) {
      cbJoinConsecutive.addEventListener('change', (e) => {
        state.toggles.fvgJoinConsecutive = e.target.checked;
        recomputeFVG();
      });
    }

    bindToggle('toggleOB', 'ob');
    bindToggle('obBullish', 'obBullish');
    bindToggle('obBearish', 'obBearish');
    bindToggle('obUnmitigatedOnly', 'obUnmitigatedOnly');

    bindToggle('toggleStructure', 'structure');
    bindToggle('toggleBOS', 'bos');
    bindToggle('toggleCHOCH', 'choch');

    bindToggle('toggleSHL', 'shl');
    bindToggle('shlHighs', 'shlHighs');
    bindToggle('shlLows', 'shlLows');

    bindToggle('toggleLiquidity', 'liquidity');
    bindToggle('liqBullish', 'liqBullish');
    bindToggle('liqBearish', 'liqBearish');

    bindToggle('togglePDHL', 'pdhl');
    bindToggle('pdhLine', 'pdhLine');
    bindToggle('pdlLine', 'pdlLine');

    bindToggle('toggleVolume', 'volume');

    // Quick All On / Off
    el.btnAllOn.addEventListener('click', () => {
      setAllToggles(true);
    });

    el.btnAllOff.addEventListener('click', () => {
      setAllToggles(false);
    });
  }

  function setAllToggles(val) {
    const ids = [
      'toggleFVG', 'fvgBullish', 'fvgBearish',
      'toggleOB', 'obBullish', 'obBearish',
      'toggleStructure', 'toggleBOS', 'toggleCHOCH',
      'toggleSHL', 'shlHighs', 'shlLows',
      'toggleLiquidity', 'liqBullish', 'liqBearish',
      'togglePDHL', 'pdhLine', 'pdlLine',
      'toggleVolume'
    ];
    ids.forEach(id => {
      const cb = document.getElementById(id);
      if (cb) {
        cb.checked = val;
        cb.dispatchEvent(new Event('change'));
      }
    });
  }

  function updateActiveIndicatorsCount() {
    let count = 0;
    if (state.toggles.fvg) count++;
    if (state.toggles.ob) count++;
    if (state.toggles.structure) count++;
    if (state.toggles.shl) count++;
    if (state.toggles.liquidity) count++;
    if (state.toggles.pdhl) count++;
    if (state.toggles.volume) count++;
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
        background: { type: 'solid', color: '#0e1117' },
        textColor: '#8b949e',
        fontSize: 11,
        fontFamily: "'JetBrains Mono', monospace"
      },
      grid: {
        vertLines: { color: 'rgba(48, 54, 61, 0.35)' },
        horzLines: { color: 'rgba(48, 54, 61, 0.35)' }
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: {
          color: '#58a6ff',
          width: 1,
          style: LightweightCharts.LineStyle.Dashed,
          labelBackgroundColor: '#1f6feb'
        },
        horzLine: {
          color: '#58a6ff',
          width: 1,
          style: LightweightCharts.LineStyle.Dashed,
          labelBackgroundColor: '#1f6feb'
        }
      },
      rightPriceScale: {
        borderColor: '#30363d',
        autoScale: true,
        scaleMargins: {
          top: 0.06,
          bottom: 0.22
        }
      },
      timeScale: {
        borderColor: '#30363d',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 12,
        barSpacing: 8,
        minBarSpacing: 2
      }
    });

    // Candlestick Series
    candleSeries = chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350'
    });

    // Dedicated Volume Series with separate PriceScaleId so it never compresses candlestick prices
    volumeSeries = chart.addHistogramSeries({
      color: '#26a69a',
      priceFormat: {
        type: 'volume'
      },
      priceScaleId: 'volume_pane',
      scaleMargins: {
        top: 0.82,
        bottom: 0
      }
    });

    chart.priceScale('volume_pane').applyOptions({
      scaleMargins: {
        top: 0.82,
        bottom: 0
      }
    });

    // Setup Canvas Overlay
    ctx = el.overlayCanvas.getContext('2d');
    resizeCanvas();

    // Responsive Resize
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

    // Chart Sync Events for Canvas Redraw
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
      scheduleOverlayRender();
    });

    chart.timeScale().subscribeVisibleTimeRangeChange(() => {
      scheduleOverlayRender();
    });

    // Crosshair Legend Sync
    chart.subscribeCrosshairMove((param) => {
      updateCrosshairLegend(param);
    });
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

  // --- Load CSV File ---
  function loadCSVFile(filepath) {
    state.currentFile = filepath;
    const url = `${filepath}?t=${Date.now()}`;

    // Extract symbol & timeframe from filepath if possible
    const cleanName = filepath.split('/').pop().replace('.csv', '');
    const parts = cleanName.split('_');
    if (parts.length >= 2) {
      state.symbol = parts[0].toUpperCase();
      state.timeframe = parts[1].toLowerCase();
      el.symbolInput.value = state.symbol;
      el.timeframeSelect.value = state.timeframe;
    }

    setStatus('loading', `Loading ${cleanName}...`);

    fetch(url)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: File ${filepath} not found.`);
        }
        return res.text();
      })
      .then((csvText) => {
        Papa.parse(csvText, {
          header: true,
          dynamicTyping: true,
          skipEmptyLines: true,
          complete: (results) => {
            processParsedData(results.data, cleanName);
          },
          error: (err) => {
            setStatus('error', `Parse error: ${err.message}`);
          }
        });
      })
      .catch((err) => {
        setStatus('error', `Failed to load ${cleanName}. Run python script first.`);
      });
  }

  // --- Process & Extract SMC Data ---
  function processParsedData(rows, sourceName) {
    if (!rows || rows.length === 0) {
      setStatus('error', 'CSV is empty or invalid.');
      return;
    }

    // 1. Auto detect and configure price scale
    detectAndApplyPriceScale(rows);

    state.rawData = rows;
    state.chartData = [];
    state.volumeData = [];
    state.smcData = {
      fvg: [],
      ob: [],
      structure: [],
      shl: [],
      liquidity: [],
      pdhl: []
    };

    const numRows = rows.length;

    for (let i = 0; i < numRows; i++) {
      const r = rows[i];
      if (r.time === undefined || r.open === undefined) continue;

      const candleTime = r.time;
      const open = Number(r.open);
      const high = Number(r.high);
      const low = Number(r.low);
      const close = Number(r.close);
      const vol = Number(r.volume || 0);

      // Candles
      state.chartData.push({
        time: candleTime,
        open: open,
        high: high,
        low: low,
        close: close
      });

      // Volume
      state.volumeData.push({
        time: candleTime,
        value: vol,
        color: close >= open ? 'rgba(38, 166, 154, 0.4)' : 'rgba(239, 83, 80, 0.4)'
      });
    }

    // 1. Fair Value Gaps (FVG) - Computed via 1:1 JavaScript SMC Engine
    recomputeFVG();

    for (let i = 0; i < numRows; i++) {
      const r = rows[i];
      if (r.time === undefined || r.open === undefined) continue;
      const candleTime = r.time;

      // 2. Order Blocks (OB)
      if (r.ob !== null && r.ob !== undefined && !isNaN(r.ob)) {
        const obDir = Number(r.ob);
        const top = Number(r.ob_top);
        const bottom = Number(r.ob_bottom);
        const obVol = Number(r.ob_volume || 0);
        const mitIdx = (r.ob_mitigated_index !== null && !isNaN(r.ob_mitigated_index)) ? Math.round(r.ob_mitigated_index) : null;
        const pct = Number(r.ob_percentage || 0);
        let mitTime = null;
        if (mitIdx !== null && mitIdx < numRows && rows[mitIdx]) {
          mitTime = rows[mitIdx].time;
        }

        state.smcData.ob.push({
          index: i,
          time: candleTime,
          ob: obDir,
          top: top,
          bottom: bottom,
          volume: obVol,
          mitigatedIndex: mitIdx,
          mitigatedTime: mitTime,
          percentage: pct
        });
      }

      // 3. BOS & CHoCH
      if (r.bos !== null && r.bos !== undefined && !isNaN(r.bos) && Number(r.bos) !== 0) {
        const brokenIdx = (r.bos_choch_broken_index !== null && !isNaN(r.bos_choch_broken_index)) ? Math.round(r.bos_choch_broken_index) : null;
        let brokenTime = null;
        if (brokenIdx !== null && brokenIdx < numRows && rows[brokenIdx]) {
          brokenTime = rows[brokenIdx].time;
        }

        state.smcData.structure.push({
          index: i,
          time: candleTime,
          type: 'BOS',
          dir: Number(r.bos),
          level: Number(r.bos_choch_level),
          brokenIndex: brokenIdx,
          brokenTime: brokenTime
        });
      } else if (r.choch !== null && r.choch !== undefined && !isNaN(r.choch) && Number(r.choch) !== 0) {
        const brokenIdx = (r.bos_choch_broken_index !== null && !isNaN(r.bos_choch_broken_index)) ? Math.round(r.bos_choch_broken_index) : null;
        let brokenTime = null;
        if (brokenIdx !== null && brokenIdx < numRows && rows[brokenIdx]) {
          brokenTime = rows[brokenIdx].time;
        }

        state.smcData.structure.push({
          index: i,
          time: candleTime,
          type: 'CHOCH',
          dir: Number(r.choch),
          level: Number(r.bos_choch_level),
          brokenIndex: brokenIdx,
          brokenTime: brokenTime
        });
      }

      // 4. Swing Highs & Lows
      if (r.shl_highlow !== null && r.shl_highlow !== undefined && !isNaN(r.shl_highlow)) {
        state.smcData.shl.push({
          index: i,
          time: candleTime,
          type: Number(r.shl_highlow) === 1 ? 'SH' : 'SL',
          level: Number(r.shl_level || (Number(r.shl_highlow) === 1 ? high : low))
        });
      }

      // 5. Liquidity Pools
      if (r.liquidity !== null && r.liquidity !== undefined && !isNaN(r.liquidity) && Number(r.liquidity) !== 0) {
        const endIdx = (r.liquidity_end !== null && !isNaN(r.liquidity_end)) ? Math.round(r.liquidity_end) : null;
        const sweptIdx = (r.liquidity_swept !== null && !isNaN(r.liquidity_swept) && Number(r.liquidity_swept) > 0) ? Math.round(r.liquidity_swept) : null;

        state.smcData.liquidity.push({
          index: i,
          time: candleTime,
          dir: Number(r.liquidity),
          level: Number(r.liquidity_level),
          endIndex: endIdx,
          endTime: (endIdx !== null && endIdx < numRows && rows[endIdx]) ? rows[endIdx].time : null,
          sweptIndex: sweptIdx,
          sweptTime: (sweptIdx !== null && sweptIdx < numRows && rows[sweptIdx]) ? rows[sweptIdx].time : null
        });
      }

      // 6. Previous High & Low (1D)
      if (r.prev_high_1d !== undefined && r.prev_high_1d !== null && !isNaN(r.prev_high_1d)) {
        state.smcData.pdhl.push({
          time: candleTime,
          pdh: Number(r.prev_high_1d),
          pdl: Number(r.prev_low_1d),
          brokenHigh: Number(r.broken_high_1d || 0),
          brokenLow: Number(r.broken_low_1d || 0)
        });
      }
    }

    // Update Chart Data
    candleSeries.setData(state.chartData);
    volumeSeries.setData(state.volumeData);

    // Update Counts & Badges
    el.countFVG.textContent = state.smcData.fvg.length;
    el.countOB.textContent = state.smcData.ob.length;
    el.countStructure.textContent = state.smcData.structure.length;
    el.countSHL.textContent = state.smcData.shl.length;
    el.countLiquidity.textContent = state.smcData.liquidity.length;

    el.statCandles.textContent = numRows.toLocaleString();
    if (numRows > 0) {
      const firstDate = rows[0].datetime || new Date(rows[0].time * 1000).toISOString().slice(0, 10);
      const lastDate = rows[numRows - 1].datetime || new Date(rows[numRows - 1].time * 1000).toISOString().slice(0, 10);
      el.statRange.textContent = `${firstDate.slice(5, 16)} -> ${lastDate.slice(5, 16)}`;
    }

    el.legendSymbol.textContent = `${state.symbol.toUpperCase()} (${state.timeframe})`;

    updateMarkers();
    chart.timeScale().fitContent();

    setStatus('ready', `Loaded ${numRows.toLocaleString()} candles (${sourceName})`);
    scheduleOverlayRender();
  }

  // --- Dynamic FVG Recomputation via JavaScript SMC Port ---
  function recomputeFVG() {
    if (!state.chartData || state.chartData.length === 0) return;

    const fvgResults = SMC.fvg(state.chartData, state.toggles.fvgJoinConsecutive);
    state.smcData.fvg = [];

    const numRows = state.chartData.length;
    for (let i = 0; i < numRows; i++) {
      const item = fvgResults[i];
      if (item && item.fvg !== null) {
        const mitIdx = (item.mitigatedIndex !== null && item.mitigatedIndex > 0) ? item.mitigatedIndex : null;
        let mitTime = null;
        if (mitIdx !== null && mitIdx < numRows && state.chartData[mitIdx]) {
          mitTime = state.chartData[mitIdx].time;
        }

        state.smcData.fvg.push({
          index: i,
          time: state.chartData[i].time,
          fvg: item.fvg,
          top: item.top,
          bottom: item.bottom,
          mitigatedIndex: mitIdx,
          mitigatedTime: mitTime
        });
      }
    }

    if (el.countFVG) {
      el.countFVG.textContent = state.smcData.fvg.length;
    }
    scheduleOverlayRender();
  }

  // --- Update Chart Markers (Swing Highs / Lows) ---
  function updateMarkers() {
    if (!state.toggles.shl) {
      candleSeries.setMarkers([]);
      return;
    }

    const markers = [];
    const shlList = state.smcData.shl;

    for (let i = 0; i < shlList.length; i++) {
      const item = shlList[i];
      const levelFormatted = formatPrice(item.level);
      if (item.type === 'SH' && state.toggles.shlHighs) {
        markers.push({
          time: item.time,
          position: 'aboveBar',
          color: '#f59e0b',
          shape: 'arrowDown',
          text: `SH ${levelFormatted}`,
          size: 1
        });
      } else if (item.type === 'SL' && state.toggles.shlLows) {
        markers.push({
          time: item.time,
          position: 'belowBar',
          color: '#38bdf8',
          shape: 'arrowUp',
          text: `SL ${levelFormatted}`,
          size: 1
        });
      }
    }

    // Sort markers chronologically by time
    markers.sort((a, b) => a.time - b.time);
    candleSeries.setMarkers(markers);
  }

  // --- Overlay Canvas SMC Renderer ---
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

    const getX = (t) => {
      if (t === null || t === undefined) return null;
      return timeScale.timeToCoordinate(t);
    };

    const getY = (price) => {
      if (price === null || price === undefined || isNaN(price)) return null;
      return candleSeries.priceToCoordinate(price);
    };

    const rightViewportX = w - 65; // Margin for right price axis

    // 1. Draw Fair Value Gaps (FVG)
    if (state.toggles.fvg) {
      renderFVG(getX, getY, fromTime, toTime, rightViewportX);
    }

    // 2. Draw Order Blocks (OB)
    if (state.toggles.ob) {
      renderOB(getX, getY, fromTime, toTime, rightViewportX);
    }

    // 3. Draw BOS & CHoCH Structure Lines
    if (state.toggles.structure) {
      renderStructure(getX, getY, fromTime, toTime, rightViewportX);
    }

    // 4. Draw Liquidity Pools
    if (state.toggles.liquidity) {
      renderLiquidity(getX, getY, fromTime, toTime, rightViewportX);
    }

    // 5. Draw Previous Day High/Low (PDH/PDL)
    if (state.toggles.pdhl) {
      renderPDHL(getX, getY, fromTime, toTime);
    }
  }

  // --- Draw FVG Zones ---
  function renderFVG(getX, getY, fromTime, toTime, rightViewportX) {
    const fvgList = state.smcData.fvg;
    const numRows = state.rawData.length;
    const latestCandleTime = numRows > 0 ? state.rawData[numRows - 1].time : toTime;

    for (let i = 0; i < fvgList.length; i++) {
      const item = fvgList[i];
      const isBull = item.fvg === 1;
      const isUnmitigated = (item.mitigatedIndex === null || item.mitigatedIndex === 0);

      if (isBull && !state.toggles.fvgBullish) continue;
      if (!isBull && !state.toggles.fvgBearish) continue;
      if (state.toggles.fvgUnmitigatedOnly && !isUnmitigated) continue;

      const endTime = item.mitigatedTime || latestCandleTime;
      if (endTime < fromTime || item.time > toTime) continue;

      const x1 = getX(item.time);
      let x2 = item.mitigatedTime ? getX(item.mitigatedTime) : rightViewportX;
      
      if (x1 === null && x2 === null) continue;
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
        ctx.fillStyle = isUnmitigated ? 'rgba(38, 166, 154, 0.28)' : 'rgba(38, 166, 154, 0.12)';
        ctx.strokeStyle = isUnmitigated ? 'rgba(38, 166, 154, 0.85)' : 'rgba(38, 166, 154, 0.4)';
      } else {
        ctx.fillStyle = isUnmitigated ? 'rgba(239, 83, 80, 0.28)' : 'rgba(239, 83, 80, 0.12)';
        ctx.strokeStyle = isUnmitigated ? 'rgba(239, 83, 80, 0.85)' : 'rgba(239, 83, 80, 0.4)';
      }

      ctx.lineWidth = 1;
      ctx.fillRect(startX, boxY, boxWidth, boxHeight);
      ctx.strokeRect(startX, boxY, boxWidth, boxHeight);

      if (boxWidth > 35) {
        ctx.fillStyle = isBull ? '#26a69a' : '#ef5350';
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.fillText(isBull ? '+FVG' : '-FVG', startX + 4, boxY + 11);
      }
      ctx.restore();
    }
  }

  // --- Draw Order Blocks (OB) ---
  function renderOB(getX, getY, fromTime, toTime, rightViewportX) {
    const obList = state.smcData.ob;
    const numRows = state.rawData.length;
    const latestCandleTime = numRows > 0 ? state.rawData[numRows - 1].time : toTime;

    for (let i = 0; i < obList.length; i++) {
      const item = obList[i];
      const isBull = item.ob === 1;
      const isUnmitigated = (item.mitigatedIndex === null || item.mitigatedIndex === 0);

      if (isBull && !state.toggles.obBullish) continue;
      if (!isBull && !state.toggles.obBearish) continue;
      if (state.toggles.obUnmitigatedOnly && !isUnmitigated) continue;

      const endTime = item.mitigatedTime || latestCandleTime;
      if (endTime < fromTime || item.time > toTime) continue;

      const x1 = getX(item.time);
      let x2 = item.mitigatedTime ? getX(item.mitigatedTime) : rightViewportX;

      const startX = x1 !== null ? x1 : 0;
      const endX = x2 !== null ? x2 : rightViewportX;
      const boxWidth = Math.max(endX - startX, 6);

      const yTop = getY(item.top);
      const yBottom = getY(item.bottom);
      if (yTop === null || yBottom === null) continue;

      const boxY = Math.min(yTop, yBottom);
      const boxHeight = Math.max(Math.abs(yBottom - yTop), 2);

      ctx.save();
      if (isBull) {
        ctx.fillStyle = isUnmitigated ? 'rgba(14, 165, 233, 0.32)' : 'rgba(14, 165, 233, 0.14)';
        ctx.strokeStyle = isUnmitigated ? 'rgba(14, 165, 233, 0.95)' : 'rgba(14, 165, 233, 0.45)';
      } else {
        ctx.fillStyle = isUnmitigated ? 'rgba(217, 70, 239, 0.32)' : 'rgba(217, 70, 239, 0.14)';
        ctx.strokeStyle = isUnmitigated ? 'rgba(217, 70, 239, 0.95)' : 'rgba(217, 70, 239, 0.45)';
      }

      ctx.lineWidth = 1.2;
      ctx.fillRect(startX, boxY, boxWidth, boxHeight);
      ctx.strokeRect(startX, boxY, boxWidth, boxHeight);

      if (boxWidth > 45) {
        ctx.fillStyle = isBull ? '#38bdf8' : '#e879f9';
        ctx.font = '10px "JetBrains Mono", monospace';
        const label = isBull ? `OB+ (${Math.round(item.percentage)}%)` : `OB- (${Math.round(item.percentage)}%)`;
        ctx.fillText(label, startX + 4, boxY + 11);
      }
      ctx.restore();
    }
  }

  // --- Draw BOS & CHoCH Structure Lines ---
  function renderStructure(getX, getY, fromTime, toTime, rightViewportX) {
    const list = state.smcData.structure;
    const numRows = state.rawData.length;
    const latestCandleTime = numRows > 0 ? state.rawData[numRows - 1].time : toTime;

    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      const isBOS = item.type === 'BOS';
      const isCHOCH = item.type === 'CHOCH';

      if (isBOS && !state.toggles.bos) continue;
      if (isCHOCH && !state.toggles.choch) continue;

      const endTime = item.brokenTime || latestCandleTime;
      if (endTime < fromTime || item.time > toTime) continue;

      const x1 = getX(item.time);
      const x2 = item.brokenTime ? getX(item.brokenTime) : rightViewportX;
      const y = getY(item.level);

      if (y === null) continue;
      const startX = x1 !== null ? x1 : 0;
      const endX = x2 !== null ? x2 : rightViewportX;

      ctx.save();
      const isBull = item.dir === 1;
      const color = isBOS ? '#38bdf8' : '#f59e0b';

      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);

      ctx.beginPath();
      ctx.moveTo(startX, y);
      ctx.lineTo(endX, y);
      ctx.stroke();

      // Badge Label
      const midX = (startX + endX) / 2;
      const labelText = `${item.type} ${isBull ? '+' : '-'}`;

      ctx.setLineDash([]);
      ctx.font = 'bold 9px "JetBrains Mono", monospace';
      const textWidth = ctx.measureText(labelText).width;

      ctx.fillStyle = isBOS ? 'rgba(3, 105, 161, 0.9)' : 'rgba(180, 83, 9, 0.9)';
      ctx.beginPath();
      ctx.roundRect(midX - textWidth / 2 - 4, y - 7, textWidth + 8, 14, 3);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.fillText(labelText, midX - textWidth / 2, y + 3);
      ctx.restore();
    }
  }

  // --- Draw Liquidity Pools ---
  function renderLiquidity(getX, getY, fromTime, toTime, rightViewportX) {
    const liqList = state.smcData.liquidity;
    const numRows = state.rawData.length;
    const latestCandleTime = numRows > 0 ? state.rawData[numRows - 1].time : toTime;

    for (let i = 0; i < liqList.length; i++) {
      const item = liqList[i];
      const isBull = item.dir === 1;

      if (isBull && !state.toggles.liqBullish) continue;
      if (!isBull && !state.toggles.liqBearish) continue;

      const endTime = item.sweptTime || item.endTime || latestCandleTime;
      if (endTime < fromTime || item.time > toTime) continue;

      const x1 = getX(item.time);
      const x2 = item.sweptTime ? getX(item.sweptTime) : (item.endTime ? getX(item.endTime) : rightViewportX);
      const y = getY(item.level);
      if (y === null) continue;

      const startX = x1 !== null ? x1 : 0;
      const endX = x2 !== null ? x2 : rightViewportX;

      ctx.save();
      const color = isBull ? '#eab308' : '#ca8a04';
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([2, 2]);

      ctx.beginPath();
      ctx.moveTo(startX, y);
      ctx.lineTo(endX, y);
      ctx.stroke();

      ctx.setLineDash([]);
      ctx.fillStyle = item.sweptTime ? '#ef4444' : '#eab308';
      ctx.font = '9px "JetBrains Mono", monospace';
      const label = item.sweptTime ? '$$$ SWEPT' : '$$$ LIQ';
      ctx.fillText(label, endX + 4, y + 3);
      ctx.restore();
    }
  }

  // --- Draw Previous Day High / Low (PDH / PDL) ---
  function renderPDHL(getX, getY, fromTime, toTime) {
    const list = state.smcData.pdhl;
    if (list.length < 2) return;

    ctx.save();

    if (state.toggles.pdhLine) {
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.75)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      let started = false;

      for (let i = 0; i < list.length; i++) {
        const item = list[i];
        if (item.time < fromTime || item.time > toTime) continue;
        const x = getX(item.time);
        const y = getY(item.pdh);
        if (x === null || y === null) continue;

        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }

    if (state.toggles.pdlLine) {
      ctx.strokeStyle = 'rgba(244, 63, 94, 0.75)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      let started = false;

      for (let i = 0; i < list.length; i++) {
        const item = list[i];
        if (item.time < fromTime || item.time > toTime) continue;
        const x = getX(item.time);
        const y = getY(item.pdl);
        if (x === null || y === null) continue;

        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }

    ctx.restore();
  }

  // --- Crosshair Hover Inspector ---
  function updateCrosshairLegend(param) {
    if (!param || !param.time || !param.seriesData || !param.seriesData.get(candleSeries)) {
      return;
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

    // Find SMC features on this exact candle
    const matchRow = state.rawData.find(r => r.time === param.time);
    let smcDetails = '';
    if (matchRow) {
      if (matchRow.shl_highlow === 1) smcDetails += `<span class="tag" style="background:#f59e0b;color:#000;">Swing High: ${formatPrice(matchRow.shl_level)}</span> `;
      if (matchRow.shl_highlow === -1) smcDetails += `<span class="tag" style="background:#38bdf8;color:#000;">Swing Low: ${formatPrice(matchRow.shl_level)}</span> `;
      if (matchRow.fvg === 1) smcDetails += `<span class="tag" style="background:#26a69a;color:#fff;">+FVG (${formatPrice(matchRow.fvg_bottom)} - ${formatPrice(matchRow.fvg_top)})</span> `;
      if (matchRow.fvg === -1) smcDetails += `<span class="tag" style="background:#ef5350;color:#fff;">-FVG (${formatPrice(matchRow.fvg_bottom)} - ${formatPrice(matchRow.fvg_top)})</span> `;
      if (matchRow.ob === 1) smcDetails += `<span class="tag" style="background:#0ea5e9;color:#fff;">+OB (${formatPrice(matchRow.ob_bottom)} - ${formatPrice(matchRow.ob_top)})</span> `;
      if (matchRow.ob === -1) smcDetails += `<span class="tag" style="background:#d946ef;color:#fff;">-OB (${formatPrice(matchRow.ob_bottom)} - ${formatPrice(matchRow.ob_top)})</span> `;
      if (matchRow.bos === 1 || matchRow.bos === -1) smcDetails += `<span class="tag tag-bos">BOS @ ${formatPrice(matchRow.bos_choch_level)}</span> `;
      if (matchRow.choch === 1 || matchRow.choch === -1) smcDetails += `<span class="tag tag-choch">CHoCH @ ${formatPrice(matchRow.bos_choch_level)}</span> `;
    }
    el.legendSMC.innerHTML = smcDetails;
  }

  // --- Helper: Status Badge ---
  function setStatus(type, msg) {
    el.statusBadge.className = `status-badge status-${type}`;
    el.statusText.textContent = msg;
  }

  // Bootstrap when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
