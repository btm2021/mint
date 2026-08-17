// ============================================================
// layout.js — GIAO DIỆN HTML DÙNG CHUNG cho mọi strategy page
// Mỗi file strategy html chỉ cần <div id="app-root"></div>
// và gọi mountSharedUI() để dựng toàn bộ giao diện.
// ============================================================

const SHARED_UI_HTML = `
  <!-- TOPBAR -->
  <div id="topbar">
    <div class="tb-brand">
      <div class="tb-brand-icon">M</div>
      <span class="tb-brand-name">MINTCHART</span>
    </div>

    <div class="tb-symbol-block">
      <div id="symbol-search-wrapper">
        <span class="sym-search-icon">🔍</span>
        <input id="symbol-input" type="text" placeholder="Search market..." autocomplete="off" spellcheck="false" readonly aria-haspopup="dialog" aria-controls="symbol-modal" />
      </div>
    </div>

    <div class="tb-intervals" id="interval-pills">
      <button class="iv-btn" data-iv="1m">1m</button>
      <button class="iv-btn" data-iv="5m">5m</button>
      <button class="iv-btn active" data-iv="15m">15m</button>
      <button class="iv-btn" data-iv="1h">1h</button>
      <button class="iv-btn" data-iv="4h">4h</button>
      <button class="iv-btn" data-iv="1d">1D</button>
    </div>

    <div id="price-ticker">
      <span id="ticker-price">—</span>
      <span id="ticker-change" class="up">—</span>
    </div>

    <div id="status"><span style="color:#3a4255">Starting...</span></div>

    <div class="tb-actions">
      <a href="stat2.html" class="tb-btn" style="text-decoration:none;color:inherit;font-weight:700;display:inline-flex;align-items:center;padding:0 10px;" title="Mở trang Stat2">⚡ Stat2</a>
      <a href="snd.html" class="tb-btn" style="text-decoration:none;color:inherit;font-weight:700;display:inline-flex;align-items:center;padding:0 10px;" title="Mở trang Supply & Demand">⚡ S&amp;D</a>
      <a href="stat5.html" class="tb-btn" style="text-decoration:none;color:inherit;font-weight:700;display:inline-flex;align-items:center;padding:0 10px;" title="Mở trang Stat5 (S&D + ATRBot + VSR)">⚡ Stat5</a>
      <a href="stat6.html" class="tb-btn" style="text-decoration:none;color:inherit;font-weight:700;display:inline-flex;align-items:center;padding:0 10px;" title="Mở trang Stat6 (Light: 2 ATRBot + 2 VSR + S&D)">⚡ Stat6</a>
      <a href="stat7.html" class="tb-btn" style="text-decoration:none;color:inherit;font-weight:700;display:inline-flex;align-items:center;padding:0 10px;" title="Mở trang Stat7 (ForexFlow Full: mọi tính năng, 10k bars)">⚡ Stat7</a>
      <button class="tb-btn" id="cache-btn" title="Cache Manager">🗄</button>
    </div>
  </div>

  <!-- STRATEGY STATS BAR -->
  <div id="strategy-stats" style="display:none"></div>

  <!-- STRATEGY INDICATOR PANEL -->
  <div id="strat-indicators" style="display:none"></div>

  <!-- STRATEGY TRADE DETAIL MODAL -->
  <div id="strat-modal-overlay" class="strat-modal-overlay" style="display:none"></div>

  <!-- SETTINGS PANEL -->
  <div id="settings-panel" class="float-panel">
    <div class="panel-header">
      <span class="panel-title">Indicators &amp; Tools</span>
      <button class="panel-close" id="settings-close">✕</button>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">Indicators</div>
      <div class="settings-row">
        <span class="settings-label">ATR Bot 1 (Cloud)</span>
        <div class="settings-row-actions"><button class="indicator-settings-btn" data-indicator="atr1" type="button" title="ATR Bot 1 settings" aria-label="ATR Bot 1 settings">&#9881;</button><label class="toggle-switch"><input type="checkbox" id="toggle-atr1" checked /><span class="toggle-slider"></span></label></div>
      </div>
      <div class="settings-row">
        <span class="settings-label">ATR Bot 2 (Lines)</span>
        <div class="settings-row-actions"><button class="indicator-settings-btn" data-indicator="atr2" type="button" title="ATR Bot 2 settings" aria-label="ATR Bot 2 settings">&#9881;</button><label class="toggle-switch"><input type="checkbox" id="toggle-atr2" checked /><span class="toggle-slider"></span></label></div>
      </div>
      <div class="settings-row">
        <span class="settings-label">VSR Zones</span>
        <div class="settings-row-actions"><button class="indicator-settings-btn" data-indicator="vsr" type="button" title="VSR settings" aria-label="VSR settings">&#9881;</button><label class="toggle-switch"><input type="checkbox" id="toggle-vsr" checked /><span class="toggle-slider"></span></label></div>
      </div>
      <div class="settings-row">
        <span class="settings-label">VSR Dual Zones</span>
        <div class="settings-row-actions"><button class="indicator-settings-btn" data-indicator="vsrDual" type="button" title="VSR Dual Zones settings" aria-label="VSR Dual Zones settings">&#9881;</button><label class="toggle-switch"><input type="checkbox" id="toggle-vsr-dual" checked /><span class="toggle-slider"></span></label></div>
      </div>
      <div class="settings-row">
        <span class="settings-label">VSR Dual EMA</span>
        <label class="toggle-switch"><input type="checkbox" id="toggle-vsr-dual-ema" checked /><span class="toggle-slider"></span></label>
      </div>
      <div class="settings-row">
        <span class="settings-label">VSR Dual VIDYA</span>
        <label class="toggle-switch"><input type="checkbox" id="toggle-vsr-dual-vidya" checked /><span class="toggle-slider"></span></label>
      </div>
      <div class="settings-row">
        <span class="settings-label">VSR Dual VWAP</span>
        <label class="toggle-switch"><input type="checkbox" id="toggle-vsr-dual-vwap" checked /><span class="toggle-slider"></span></label>
      </div>
      <div class="settings-row">
        <span class="settings-label">Volume Profile</span>
        <div class="settings-row-actions"><button class="indicator-settings-btn" data-indicator="vp" type="button" title="Volume Profile settings" aria-label="Volume Profile settings">&#9881;</button><label class="toggle-switch"><input type="checkbox" id="toggle-vpvol" checked /><span class="toggle-slider"></span></label></div>
      </div>
      <div class="settings-row">
        <span class="settings-label">VWAP</span>
        <div class="settings-row-actions"><button class="indicator-settings-btn" data-indicator="vwap" type="button" title="VWAP settings" aria-label="VWAP settings">&#9881;</button><label class="toggle-switch"><input type="checkbox" id="toggle-vwap" checked /><span class="toggle-slider"></span></label></div>
      </div>
      <div class="settings-row">
        <span class="settings-label" id="strategy-settings-name">Strategy</span>
        <div class="settings-row-actions"><button class="indicator-settings-btn" id="strategy-settings-btn" type="button" title="Strategy settings" aria-label="Strategy settings">&#9881;</button></div>
      </div>
      <div class="settings-row" id="row-strat-entries">
        <span class="settings-label">Điểm vào lệnh</span>
        <label class="toggle-switch"><input type="checkbox" id="toggle-strat-entries" checked /><span class="toggle-slider"></span></label>
      </div>
      <div class="settings-row" id="row-strat-biascloud">
        <span class="settings-label">Cloud BIAS</span>
        <label class="toggle-switch"><input type="checkbox" id="toggle-strat-biascloud" checked /><span class="toggle-slider"></span></label>
      </div>
      <div class="settings-row" id="row-strat-entrycloud">
        <span class="settings-label">Cloud ENTRY</span>
        <label class="toggle-switch"><input type="checkbox" id="toggle-strat-entrycloud" checked /><span class="toggle-slider"></span></label>
      </div>
      <div class="settings-row" id="row-strat-vsr">
        <span class="settings-label">VSR zones</span>
        <label class="toggle-switch"><input type="checkbox" id="toggle-strat-vsr" checked /><span class="toggle-slider"></span></label>
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">Drawing Tools</div>
      <div class="settings-row">
        <span class="settings-label">Draw Volume Profile</span>
        <label class="toggle-switch"><input type="checkbox" id="toggle-draw-vp" /><span class="toggle-slider"></span></label>
      </div>
      <div class="settings-row">
        <span class="settings-label">Draw Rectangle</span>
        <label class="toggle-switch"><input type="checkbox" id="toggle-draw-rect" /><span class="toggle-slider"></span></label>
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">Chart Data</div>
      <div class="settings-row">
        <span class="settings-label">Stored candles</span>
        <button class="indicator-settings-btn" id="chart-data-settings-btn" type="button" title="Stored candles settings" aria-label="Stored candles settings">&#9881;</button>
      </div>
    </div>
  </div>

  <!-- CACHE MANAGER PANEL -->
  <div id="cache-panel" class="float-panel">
    <div class="panel-header">
      <span class="panel-title">Cache Manager</span>
      <button class="panel-close" id="cache-close">✕</button>
    </div>
    <div class="panel-body">
      <div class="cache-info-row" style="display:flex; justify-content: space-between; align-items: center; padding-bottom: 12px; border-bottom: 1px solid var(--border-color); margin-bottom: 12px;">
        <span id="cache-total-size" style="font-size: 12px; color: var(--text-dim);">0 entries</span>
        <button id="clear-all-cache" style="background: rgba(255, 82, 82, 0.1); color: #ff5252; border: 1px solid rgba(255, 82, 82, 0.3); padding: 4px 8px; border-radius: 4px; font-size: 11px; cursor: pointer;">Clear All</button>
      </div>
      <div id="cache-list" class="cache-list" style="max-height: 300px; overflow-y: auto;"></div>
    </div>
  </div>

  <!-- SYMBOL SEARCH MODAL -->
  <div id="symbol-modal" class="symbol-modal-overlay" hidden>
    <section class="symbol-modal" role="dialog" aria-modal="true" aria-labelledby="symbol-modal-title">
      <div class="symbol-modal-header">
        <div>
          <span class="symbol-modal-eyebrow">Binance Futures</span>
          <h2 id="symbol-modal-title">Select a market</h2>
        </div>
        <button id="symbol-modal-close" class="panel-close" type="button" aria-label="Close market search">×</button>
      </div>
      <input id="symbol-modal-input" class="symbol-modal-input" type="search" placeholder="Filter symbols, e.g. BTC or ETH" autocomplete="off" spellcheck="false" />
      <div class="symbol-filter-row">
        <label class="symbol-check"><input id="symbol-filter-cached" type="checkbox" /> Cached data only</label>
        <span id="symbol-result-count"></span>
      </div>
      <div id="symbol-modal-results" class="symbol-modal-results" role="listbox"></div>
      <p class="symbol-modal-note">Markets are loaded from Binance exchange info on first use.</p>
    </section>
  </div>

  <!-- INDICATOR SETTINGS MODAL -->
  <div id="indicator-config-modal" class="indicator-config-overlay" hidden>
    <section class="indicator-config-modal" role="dialog" aria-modal="true" aria-labelledby="indicator-config-title">
      <div class="symbol-modal-header">
        <div>
          <span class="symbol-modal-eyebrow">Indicator settings</span>
          <h2 id="indicator-config-title">Configure indicator</h2>
        </div>
        <button id="indicator-config-close" class="panel-close" type="button" aria-label="Close indicator settings">×</button>
      </div>
      <form id="indicator-config-form" class="indicator-config-fields"></form>
      <div class="indicator-config-actions"><button id="indicator-config-cancel" class="indicator-cancel" type="button">Cancel</button><button id="indicator-config-apply" class="settings-apply" type="button">Apply &amp; Load</button></div>
    </section>
  </div>

  <!-- LOADING SCREEN -->
  <div id="loading-screen">
    <div class="loading-logo">M</div>
    <div class="loading-title">MINTCHART</div>
    <div class="loading-bar-wrap">
      <div class="loading-bar"></div>
    </div>
    <div class="loading-text" id="loading-text">Initializing...</div>
  </div>

  <!-- MAIN AREA -->
  <div id="main-area">
    <div id="draw-sidebar">
      <button class="sidebar-btn active" id="sb-cursor" data-tip="Cursor (Esc)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5 3l14 9-7 1-4 6z" />
        </svg>
      </button>
      <div class="sidebar-divider"></div>
      <button class="sidebar-btn" id="sb-rect" data-tip="Draw Rectangle">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
        </svg>
      </button>
      <button class="sidebar-btn" id="sb-vp" data-tip="FRVP Zone">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4" width="6" height="16" rx="1" />
          <rect x="11" y="8" width="10" height="8" rx="1" />
          <line x1="3" y1="12" x2="21" y2="12" />
        </svg>
      </button>
      <div class="sidebar-divider"></div>
      <button class="sidebar-btn" id="sb-measure" data-tip="Measure (Shift)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="2" y1="12" x2="22" y2="12" />
          <line x1="2" y1="8" x2="2" y2="16" />
          <line x1="22" y1="8" x2="22" y2="16" />
          <line x1="12" y1="9" x2="12" y2="15" />
        </svg>
      </button>
      <div class="sidebar-divider"></div>
      <button class="sidebar-btn" id="sb-delete" data-tip="Delete Selected (Del)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <path d="M10 11v6M14 11v6" />
          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
        </svg>
      </button>
      <div class="sidebar-divider"></div>
      <button class="sidebar-btn" id="sb-analyse" data-tip="Analyse Cycle">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
          <line x1="11" y1="8" x2="11" y2="14" />
          <line x1="8" y1="11" x2="14" y2="11" />
        </svg>
      </button>
      <div class="sidebar-spacer"></div>
      <div class="sidebar-divider"></div>
      <button class="sidebar-btn" id="settings-btn" data-tip="Indicators &amp; Settings" title="Indicators &amp; Settings" aria-label="Indicators &amp; Settings">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.12 2.12-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V20.3h-3v-.08A1.7 1.7 0 0 0 10.68 18.66a1.7 1.7 0 0 0-1.88.34l-.06.06-2.12-2.12.06-.06A1.7 1.7 0 0 0 7.02 15a1.7 1.7 0 0 0-1.56-1.03H5.4v-3h.06A1.7 1.7 0 0 0 7.02 9.94a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.12-2.12.06.06a1.7 1.7 0 0 0 1.88.34 1.7 1.7 0 0 0 1.03-1.56V4.7h3v.08a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06L19.8 8l-.06.06a1.7 1.7 0 0 0-.34 1.88 1.7 1.7 0 0 0 1.56 1.03h.08v3h-.08A1.7 1.7 0 0 0 19.4 15Z" />
        </svg>
      </button>
    </div>
    <div id="chart-wrapper">
      <div id="chart-main-pane">
        <div id="chart-container"></div>
        <canvas id="overlay-canvas"></canvas>
      </div>
      <section id="vsr-dual-panel" aria-label="VSR Dual Zones panel">
        <div class="vsr-dual-header">
          <span class="vsr-dual-title">VSR Dual Zones</span>
          <span class="vsr-dual-legend"><i class="vsr1-swatch"></i>VSR 1 <i class="vsr2-swatch"></i>VSR 2 <i class="ema-swatch"></i>EMA <i class="vidya-swatch"></i>VIDYA <i class="vwap-swatch"></i>VWAP</span>
        </div>
        <div id="vsr-dual-chart"></div>
        <canvas id="vsr-dual-canvas"></canvas>
      </section>
    </div>
  </div>

  <!-- ANALYSE MODAL -->
  <div id="analyse-modal" class="analyse-modal-overlay" style="display:none">
    <div class="analyse-modal-box">
      <div class="analyse-modal-header">
        <div class="analyse-modal-title">
          <span id="analyse-title-sym"></span>
          <span class="analyse-badge" id="analyse-badge"></span>
        </div>
        <div class="analyse-header-right">
          <span class="analyse-meta" id="analyse-range-label"></span>
          <button class="analyse-close" id="analyse-close">✕</button>
        </div>
      </div>
      <div class="analyse-stats-bar" id="analyse-stats-bar"></div>
      <div class="analyse-chart-wrap" id="analyse-chart-wrap"></div>
    </div>
  </div>

  <div class="draw-hint" id="draw-hint"></div>
`;

// Dựng toàn bộ UI vào #app-root — gọi 1 lần khi load trang
function mountSharedUI() {
  const root = document.getElementById("app-root");
  if (root) root.innerHTML = SHARED_UI_HTML;
  return document;
}
