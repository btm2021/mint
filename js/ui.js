function setLoadingText(msg) {
  const el = document.getElementById("loading-text");
  if (el) el.textContent = msg;
}

function hideLoadingScreen() {
  const screen = document.getElementById("loading-screen");
  if (screen) screen.classList.add("hidden");
}

function getCachedSymbolsList() {
  const cached = new Set();
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.endsWith("_DB_v6")) {
      const parts = key.split("_");
      if (parts.length >= 3) cached.add(parts[0]);
    }
  }
  return cached;
}

function getStartSymbol() {
  const last = localStorage.getItem("stat1_lastSymbol");
  if (last) return last;
  const cachedSet = getCachedSymbolsList();
  if (cachedSet.size > 0) return Array.from(cachedSet)[0];
  return "BTCUSDT";
}

function setupSymbolSearch() {
  const input = document.getElementById("symbol-input");
  const dropdown = document.getElementById("symbol-dropdown");
  const cachedSet = getCachedSymbolsList();

  function renderDropdown(query) {
    const q = query.trim().toUpperCase();
    let filtered = q ? allSymbols.filter((s) => s.includes(q)) : [...allSymbols];

    filtered.sort((a, b) => {
      const aC = cachedSet.has(a) ? 0 : 1;
      const bC = cachedSet.has(b) ? 0 : 1;
      return aC - bC || a.localeCompare(b);
    });

    const top = filtered.slice(0, 60);
    if (top.length === 0) {
      dropdown.innerHTML = `<div style="padding:12px 14px;color:#555;font-size:12px;">No results</div>`;
      dropdown.classList.add("open");
      return;
    }

    let html = "";
    let hasCachedSection = false;
    let hasOthersSection = false;

    for (const sym of top) {
      const isCached = cachedSet.has(sym);
      if (isCached && !hasCachedSection) {
        html += `<div class="sym-group-label">⚡ Cached</div>`;
        hasCachedSection = true;
      }
      if (!isCached && !hasOthersSection) {
        html += `<div class="sym-group-label">All Symbols</div>`;
        hasOthersSection = true;
      }
      const badge = isCached ? `<span class="sym-badge cached">CACHED</span>` : ``;
      html += `<div class="sym-item" data-sym="${sym}">
            <span class="sym-name">${sym}</span>${badge}
          </div>`;
    }

    dropdown.innerHTML = html;
    dropdown.classList.add("open");

    dropdown.querySelectorAll(".sym-item").forEach((el) => {
      el.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const sym = el.dataset.sym;
        selectSymbol(sym);
      });
    });
  }

  input.addEventListener("focus", () => renderDropdown(input.value));
  input.addEventListener("input", () => renderDropdown(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      dropdown.classList.remove("open");
      input.blur();
    }
    if (e.key === "Enter") {
      const q = input.value.trim().toUpperCase();
      if (allSymbols.includes(q)) selectSymbol(q);
    }
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest("#symbol-search-wrapper")) {
      dropdown.classList.remove("open");
    }
  });
}

async function selectSymbol(sym) {
  if (!sym || sym === SYMBOL) {
    document.getElementById("symbol-dropdown").classList.remove("open");
    return;
  }
  SYMBOL = sym;
  document.getElementById("symbol-input").value = sym;
  document.getElementById("symbol-dropdown").classList.remove("open");
  localStorage.setItem("stat1_lastSymbol", sym);

  setStatus("loading", `Loading ${sym}...`);
  if (window._tickerWS) {
    window._tickerWS.close();
    window._tickerWS = null;
  }
  await loadSymbol();
  setupTickerWS(sym);
}

function getPriceFormat(priceValue) {
  if (!priceValue || priceValue <= 0) return { precision: 4, minMove: 0.0001 };
  if (priceValue >= 10000) return { precision: 1, minMove: 0.1 };
  if (priceValue >= 1000) return { precision: 2, minMove: 0.01 };
  if (priceValue >= 100) return { precision: 3, minMove: 0.001 };
  return { precision: 4, minMove: 0.0001 };
}

function applyPriceFormat(bars) {
  if (!bars || bars.length === 0) return;
  const lastPrice = bars[bars.length - 1].close;
  const { precision, minMove } = getPriceFormat(lastPrice);
  const fmt = { type: "price", precision, minMove };
  [candleSeries, t1Series, t2Series, t1Series2, t2Series2, vwapSeries].forEach((s) => {
    if (s) s.applyOptions({ priceFormat: fmt });
  });
}

function setStatus(type, text) {
  const el = document.getElementById("status");
  if (type === "loading") {
    el.innerHTML = `<div class="status-loading-spin"></div><span>${text}</span>`;
  } else if (type === "ready") {
    el.innerHTML = `<div class="status-dot"></div><span class="sym-tag">${SYMBOL}</span><span class="intv-tag">${INTERVAL}</span><span class="bars-tag">${text}</span>`;
  } else if (type === "error") {
    el.innerHTML = `<span style="color:var(--danger-color)">${text}</span>`;
  } else {
    el.innerHTML = `<span style="color:#3a4255">${text}</span>`;
  }
}

function setupIntervalPills() {
  const savedInterval = localStorage.getItem("stat1_interval");
  if (savedInterval) INTERVAL = savedInterval;
  const pills = document.querySelectorAll(".iv-btn");
  pills.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.iv === INTERVAL);
  });
  pills.forEach((btn) => {
    btn.addEventListener("click", async () => {
      const iv = btn.dataset.iv;
      if (iv === INTERVAL) return;
      INTERVAL = iv;
      localStorage.setItem("stat1_interval", iv);
      pills.forEach((b) => b.classList.toggle("active", b.dataset.iv === iv));
      if (SYMBOL) {
        setStatus("loading", `Loading ${SYMBOL} ${iv}...`);
        await loadSymbol();
      }
    });
  });
}

function setupSettingsPanel() {
  const btn = document.getElementById("settings-btn");
  const panel = document.getElementById("settings-panel");
  const closeBtn = document.getElementById("settings-close");
  function togglePanel(force) {
    const isOpen = force !== undefined ? force : !panel.classList.contains("open");
    panel.classList.toggle("open", isOpen);
    btn.classList.toggle("active", isOpen);
    if (isOpen) {
      document.getElementById("cache-panel").classList.remove("open");
      document.getElementById("cache-btn").classList.remove("active");
    }
  }
  btn.addEventListener("click", (e) => { e.stopPropagation(); togglePanel(); });
  closeBtn.addEventListener("click", () => togglePanel(false));
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#settings-panel") && !e.target.closest("#settings-btn")) togglePanel(false);
  });
}

function setupCacheManager() {
  const btn = document.getElementById("cache-btn");
  const panel = document.getElementById("cache-panel");
  const closeBtn = document.getElementById("cache-close");
  const clearAllBtn = document.getElementById("clear-all-cache");

  function getOHLCVKeys() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.endsWith("_DB_v6")) keys.push(key);
    }
    return keys.sort();
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1024 / 1024).toFixed(2) + " MB";
  }

  function renderCacheList() {
    const listEl = document.getElementById("cache-list");
    const totalEl = document.getElementById("cache-total-size");
    const keys = getOHLCVKeys();
    if (keys.length === 0) {
      listEl.innerHTML = `<div class="cache-empty">No cached data found</div>`;
      totalEl.textContent = "0 entries";
      return;
    }
    let totalBytes = 0;
    let html = "";
    for (const key of keys) {
      const val = localStorage.getItem(key) || "";
      const bytes = new Blob([val]).size;
      totalBytes += bytes;
      const parts = key.replace("_DB_v6", "").split("_");
      const sym = parts[0];
      const iv = parts.slice(1).join("_");
      let bars = 0;
      try { bars = JSON.parse(val).length; } catch (e) {}
      html += `
            <div class="cache-item">
              <span class="cache-sym">${sym}</span>
              <span class="cache-meta">${iv} &middot; ${bars.toLocaleString()} bars</span>
              <span class="cache-size">${formatBytes(bytes)}</span>
              <button class="cache-del-btn" data-key="${key}" title="Delete">✕</button>
            </div>`;
    }
    listEl.innerHTML = html;
    totalEl.textContent = `${keys.length} entries · ${formatBytes(totalBytes)}`;
    listEl.querySelectorAll(".cache-del-btn").forEach((b) => {
      b.addEventListener("click", () => {
        localStorage.removeItem(b.dataset.key);
        renderCacheList();
      });
    });
  }

  function togglePanel(force) {
    const isOpen = force !== undefined ? force : !panel.classList.contains("open");
    if (isOpen) renderCacheList();
    panel.classList.toggle("open", isOpen);
    btn.classList.toggle("active", isOpen);
    if (isOpen) {
      document.getElementById("settings-panel").classList.remove("open");
      document.getElementById("settings-btn").classList.remove("active");
    }
  }

  btn.addEventListener("click", (e) => { e.stopPropagation(); togglePanel(); });
  closeBtn.addEventListener("click", () => togglePanel(false));
  clearAllBtn.addEventListener("click", () => {
    const keys = getOHLCVKeys();
    if (keys.length === 0) return;
    if (confirm(`Delete all ${keys.length} cached datasets?`)) {
      keys.forEach((k) => localStorage.removeItem(k));
      renderCacheList();
    }
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#cache-panel") && !e.target.closest("#cache-btn")) togglePanel(false);
  });
}
