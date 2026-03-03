// ==========================================================================
// analyse.js — Analyse Cycle Modal
// Tách riêng từ tools.js để dễ bảo trì.
// Phụ thuộc globals: globalBars, globalBot1, globalBot2, globalVsrZones,
//                    globalCycles, analyseChartInstance, analyseModeActive,
//                    ATR_LENGTH, EMA_LENGTH, ATR_MULT, VSR_LENGTH, SYMBOL, INTERVAL
// ==========================================================================

// ─────────────────────────────────────────────────────────────────────────────
// calculateFVGs — Tìm các Fair Value Gap (Imbalance) còn hiệu lực
//
// Bullish FVG : bars[i-2].high < bars[i].low  → gap phía trên
// Bearish FVG : bars[i-2].low  > bars[i].high → gap phía dưới
//
// Mitigation (FVG không còn hợp lệ):
//   • Bullish FVG bị mitigated khi có nến j > i mà bars[j].low  <= fvg.bottom
//   • Bearish FVG bị mitigated khi có nến j > i mà bars[j].high >= fvg.top
//
// Chỉ trả về các FVG CHƯA bị mitigated. barIndex là 0-based trong slice.
// ─────────────────────────────────────────────────────────────────────────────
function calculateFVGs(bars) {
    const fvgs = [];
    for (let i = 2; i < bars.length; i++) {
        const prev2 = bars[i - 2];
        const curr = bars[i];

        // ── Bullish FVG ────────────────────────────────────────────────────────
        if (prev2.high < curr.low) {
            const top = curr.low;
            const bottom = prev2.high;
            // Kiểm tra mitigation: nến j > i có low chạm vào vùng [bottom, top]
            let mitigated = false;
            for (let j = i + 1; j < bars.length; j++) {
                if (bars[j].low <= top) {   // high/low chạm vào vùng gap là đủ
                    mitigated = true;
                    break;
                }
            }
            if (!mitigated) {
                fvgs.push({ type: "bullish", top, bottom, startBar: i - 2, endBar: i });
            }
        }

        // ── Bearish FVG ────────────────────────────────────────────────────────
        if (prev2.low > curr.high) {
            const top = prev2.low;
            const bottom = curr.high;
            // Kiểm tra mitigation: nến j > i có high chạm vào vùng [bottom, top]
            let mitigated = false;
            for (let j = i + 1; j < bars.length; j++) {
                if (bars[j].high >= bottom) {
                    mitigated = true;
                    break;
                }
            }
            if (!mitigated) {
                fvgs.push({ type: "bearish", top, bottom, startBar: i - 2, endBar: i });
            }
        }
    }
    return fvgs;
}


// ─────────────────────────────────────────────────────────────────────────────
// setupAnalyseTool — Khởi tạo toàn bộ logic modal Analyse Cycle
// ─────────────────────────────────────────────────────────────────────────────
function setupAnalyseTool() {
    const modal = document.getElementById("analyse-modal");
    const closeBtn = document.getElementById("analyse-close");
    const wrapper = document.getElementById("chart-wrapper");

    function fmt(v, prec) { return v.toFixed(prec ?? 4); }
    function fmtDate(ts) {
        const d = new Date(ts * 1000);
        return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
            + " " + d.toTimeString().slice(0, 5);
    }
    function pct(a, b) { return (((b - a) / a) * 100).toFixed(2); }

    function findCycleForBar(barIdx) {
        for (let i = globalCycles.length - 1; i >= 0; i--) {
            if (globalCycles[i].startIndex <= barIdx) return i;
        }
        return 0;
    }

    // ── Auto-analysis engine ──────────────────────────────────────────────────
    function generateAnalysisHTML({ slice, bot1CyclesSlice, vsrZonesSlice, fvgList, vpData, precision }) {
        const f = (v) => v != null ? v.toFixed(precision) : '—';
        const fpct = (v) => (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
        const lastBar = slice[slice.length - 1];
        const currentPrice = lastBar.close;

        // ATRBot cycle states
        const lastCyc = bot1CyclesSlice[bot1CyclesSlice.length - 1];
        const prevCyc = bot1CyclesSlice.length >= 2 ? bot1CyclesSlice[bot1CyclesSlice.length - 2] : null;
        const lastState = lastCyc ? lastCyc.state : null;
        const prevState = prevCyc ? prevCyc.state : null;
        const isPullbackInUptrend = prevState === 1 && lastState === -1;
        const isContinueDown = prevState === -1 && lastState === -1;
        const isContinueUp = prevState === 1 && lastState === 1;
        const isRecovery = prevState === -1 && lastState === 1;
        const atrChanged = prevState !== null && lastState !== prevState;

        // VSR zones split by current price
        const vsrAbove = vsrZonesSlice.filter(z => z.lower > currentPrice);
        const vsrBelow = vsrZonesSlice.filter(z => z.upper < currentPrice);

        // FVG split by current price
        const fvgAbove = fvgList.filter(f => f.bottom > currentPrice).sort((a, b) => a.bottom - b.bottom);
        const fvgBelow = fvgList.filter(f => f.top < currentPrice).sort((a, b) => b.top - a.top);

        // POC
        const pocPrice = vpData?.pocPrice ?? null;

        // Trade setup
        let trade = null;
        if (isPullbackInUptrend || isContinueDown) {
            const entry = currentPrice;
            let slRef = fvgAbove.length > 0
                ? Math.max(...fvgAbove.map(f => f.top))
                : vsrAbove.length > 0
                    ? Math.max(...vsrAbove.map(z => z.upper))
                    : Math.max(...slice.slice(-10).map(b => b.high));
            const sl = slRef * 1.001;
            const risk = Math.abs(sl - entry);
            const tp = entry - 2 * risk;
            trade = {
                dir: 'SHORT', entry, sl, tp,
                riskPct: (sl - entry) / entry * 100,
                rewardPct: (entry - tp) / entry * 100
            };
        } else if (isRecovery || isContinueUp) {
            const entry = currentPrice;
            let slRef = fvgBelow.length > 0
                ? Math.min(...fvgBelow.map(f => f.bottom))
                : vsrBelow.length > 0
                    ? Math.min(...vsrBelow.map(z => z.lower))
                    : Math.min(...slice.slice(-10).map(b => b.low));
            const sl = slRef * 0.999;
            const risk = Math.abs(entry - sl);
            const tp = entry + 2 * risk;
            trade = {
                dir: 'LONG', entry, sl, tp,
                riskPct: (entry - sl) / entry * 100,
                rewardPct: (tp - entry) / entry * 100
            };
        }

        const stLabel = s => s === 1
            ? '<span class="ap-text up">▲ Tăng</span>'
            : '<span class="ap-text down">▼ Giảm</span>';

        let html = '';

        // Section 1: ATRBot
        html += `<div class="ap-section">
          <div class="ap-title">ATRBot Signal</div>
          ${prevCyc ? `<div class="ap-row"><span class="ap-icon">🔄</span>
            <span class="ap-text">${stLabel(prevState)} → ${stLabel(lastState)}
            ${atrChanged ? '<strong> (ĐỔI CHIỀU)</strong>' : '<strong> (giữ nguyên)</strong>'}
            </span></div>` : ''}
          <div class="ap-row"><span class="ap-icon">📍</span>
            <span class="ap-text">Giá hiện tại: <strong>${f(currentPrice)}</strong></span></div>
        </div>`;

        // Section 2: VSR
        html += `<div class="ap-section"><div class="ap-title">VSR Zone</div>`;
        if (vsrAbove.length) {
            html += `<div class="ap-row"><span class="ap-icon">🟡</span>
              <span class="ap-text warn"><strong>${vsrAbove.length} zone trên</strong> (kháng cự):<br>`;
            vsrAbove.slice(0, 2).forEach(z => {
                html += `<span class="ap-text dim">&nbsp;${f(z.lower)} – ${f(z.upper)}</span><br>`;
            });
            html += `</span></div>`;
        }
        if (vsrBelow.length) {
            html += `<div class="ap-row"><span class="ap-icon">🟡</span>
              <span class="ap-text warn"><strong>${vsrBelow.length} zone dưới</strong> (hỗ trợ):<br>`;
            vsrBelow.slice(0, 2).forEach(z => {
                html += `<span class="ap-text dim">&nbsp;${f(z.lower)} – ${f(z.upper)}</span><br>`;
            });
            html += `</span></div>`;
        }
        if (!vsrZonesSlice.length) {
            html += `<div class="ap-row"><span class="ap-icon">⚫</span>
              <span class="ap-text dim">Không có VSR trong vùng</span></div>`;
        }
        html += `</div>`;

        // Section 3: FVG
        html += `<div class="ap-section"><div class="ap-title">FVG còn hiệu lực</div>`;
        if (fvgAbove.length) {
            html += `<div class="ap-row"><span class="ap-icon">⬆️</span>
              <span class="ap-text purple">Trên giá (<strong>${fvgAbove.length}</strong>):<br>`;
            fvgAbove.slice(0, 3).forEach(z => {
                html += `<span class="ap-text dim">&nbsp;${f(z.bottom)} – ${f(z.top)}</span><br>`;
            });
            html += `</span></div>`;
        }
        if (fvgBelow.length) {
            html += `<div class="ap-row"><span class="ap-icon">⬇️</span>
              <span class="ap-text purple">Dưới giá (<strong>${fvgBelow.length}</strong>):<br>`;
            fvgBelow.slice(0, 3).forEach(z => {
                html += `<span class="ap-text dim">&nbsp;${f(z.bottom)} – ${f(z.top)}</span><br>`;
            });
            html += `</span></div>`;
        }
        if (!fvgList.length) {
            html += `<div class="ap-row"><span class="ap-icon">✅</span>
              <span class="ap-text dim">Tất cả FVG đã được lấp đầy</span></div>`;
        }
        html += `</div>`;

        // Section 4: Verdict
        let vClass = 'neutral', vText = '';
        if (isPullbackInUptrend) {
            vClass = 'bearish';
            const vsrNote = vsrAbove.length
                ? `VSR <strong>giữ nguyên phía trên</strong> (${vsrAbove.length} zone),
                   xác nhận pullback tạm thời — tiếp tục xu hướng tăng.`
                : 'VSR phía trên không rõ ràng — thận trọng hơn.';
            vText = `🔴 <strong>ATRBot đổi chiều GIẢM</strong> trong xu hướng tăng.<br>${vsrNote}<br><br>
                📌 <strong>Kịch bản:</strong> Pullback ngắn để lấy thanh khoản,
                kỳ vọng tăng tiếp sau đó.<br><br>
                ⚡ <strong>Hành động:</strong> SHORT ngắn sau ATRBot candle+1.
                Vào tại FVG / POC gần nhất.`;
        } else if (isContinueDown) {
            vClass = 'bearish';
            vText = `🔴 <strong>ATRBot duy trì GIẢM.</strong><br>Xu hướng giảm tiếp tục.
                SHORT theo momentum.
                ${vsrAbove.length ? `<br>VSR trên <strong>${f(vsrAbove[0].upper)}</strong> = kháng cự.` : ''}`;
        } else if (isContinueUp) {
            vClass = 'bullish';
            vText = `🟢 <strong>ATRBot duy trì TĂNG.</strong><br>Xu hướng tăng tiếp tục.
                LONG theo momentum.
                ${vsrBelow.length ? `<br>VSR dưới <strong>${f(vsrBelow[0].lower)}</strong> = hỗ trợ.` : ''}`;
        } else if (isRecovery) {
            vClass = 'bullish';
            vText = `🟢 <strong>ATRBot đổi chiều TĂNG.</strong><br>Phục hồi xu hướng.
                LONG sau xác nhận candle+1.
                ${vsrBelow.length ? `<br>VSR dưới <strong>${f(vsrBelow[0].lower)}</strong> = hỗ trợ.` : ''}`;
        } else {
            vText = '⚪ Chưa xác định kịch bản rõ ràng.';
        }
        html += `<div class="ap-verdict ${vClass}">${vText}</div>`;

        // Section 5: POC
        if (pocPrice != null) {
            html += `<div class="ap-section"><div class="ap-title">POC</div>
              <div class="ap-row"><span class="ap-icon">🎯</span>
                <span class="ap-text info"><strong>${f(pocPrice)}</strong>
                ${pocPrice < currentPrice ? ' (dưới — hỗ trợ)' : ' (trên — kháng cự)'}</span></div>
            </div>`;
        }

        // Section 6: Trade plan
        if (trade) {
            const dIcon = trade.dir === 'LONG' ? '⬆️' : '⬇️';
            const dClass = trade.dir === 'LONG' ? 'up' : 'down';
            html += `<div class="ap-section"><div class="ap-title">Kế hoạch giao dịch</div>
              <div class="ap-row"><span class="ap-icon">${dIcon}</span>
                <span class="ap-text ${dClass}"><strong>${trade.dir}</strong> — ATRBot candle+1</span></div>
            </div>
            <div class="ap-trade-card">
              <div class="ap-trade-row">
                <span class="ap-trade-label">Entry (ATRBot+1)</span>
                <span class="ap-trade-val entry">${f(trade.entry)}</span>
              </div>
              <div class="ap-trade-row">
                <span class="ap-trade-label">Stop Loss</span>
                <span class="ap-trade-val sl">${f(trade.sl)}
                  <span style="font-size:9px;opacity:.6">(${fpct(trade.riskPct)})</span></span>
              </div>
              <div class="ap-trade-row">
                <span class="ap-trade-label">Take Profit (2R)</span>
                <span class="ap-trade-val tp">${f(trade.tp)}
                  <span style="font-size:9px;opacity:.6">(${fpct(trade.rewardPct)})</span></span>
              </div>
              <div class="ap-trade-row">
                <span class="ap-trade-label">Risk : Reward</span>
                <span class="ap-trade-val rr">1 : 2.0 RR</span>
              </div>
            </div>`;
        } else {
            html += `<div class="ap-section"><div class="ap-title">Kế hoạch giao dịch</div>
              <div class="ap-row"><span class="ap-icon">⏳</span>
                <span class="ap-text dim">Chờ ATRBot xác nhận tín hiệu.</span></div>
            </div>`;
        }

        return html;
    }

    // Per-modal toggle state (persisted via localStorage)
    let amShowBot1 = localStorage.getItem("am_showBot1") !== "0";
    let amShowBot2 = localStorage.getItem("am_showBot2") !== "0";
    let amShowVSR = localStorage.getItem("am_showVSR") !== "0";
    let amShowVP = localStorage.getItem("am_showVP") !== "0";
    let amShowFVG = localStorage.getItem("am_showFVG") !== "0";

    // ──────────────────────────────────────────────────────────────────────────
    // openAnalyseModal(fromIdx, signalIdx, currentCycle)
    //   fromIdx    : bắt đầu hiển thị (start của prevCycle)
    //   signalIdx  : bar ATRBot đổi chiều (start của currentCycle) — điểm phân tích
    //   currentCycle: cycle hiện tại (chưa diễn ra) — sẽ được replay từng nến
    // ──────────────────────────────────────────────────────────────────────────
    function openAnalyseModal(fromIdx, signalIdx, currentCycle) {
        if (fromIdx < 0) fromIdx = 0;
        if (signalIdx >= globalBars.length) signalIdx = globalBars.length - 1;
        const _initSlice = globalBars.slice(fromIdx, signalIdx + 1);
        if (!_initSlice.length) return;



        if (analyseChartInstance) {
            try { analyseChartInstance.remove(); } catch (e) { }
            analyseChartInstance = null;
        }

        const isUp = currentCycle ? currentCycle.state === 1 : true;

        document.getElementById("analyse-title-sym").textContent = SYMBOL + " · " + INTERVAL;
        const badge = document.getElementById("analyse-badge");
        badge.textContent = isUp ? "▲ Uptrend" : "▼ Downtrend";
        badge.className = "analyse-badge" + (isUp ? "" : " down");
        document.getElementById("analyse-range-label").textContent =
            fmtDate(_initSlice[0].time) + " → " + fmtDate(_initSlice[_initSlice.length - 1].time);

        const { precision } = getPriceFormat(_initSlice[0].close);
        const openPrice = _initSlice[0].open;
        const closePrice = _initSlice[_initSlice.length - 1].close;
        const highPrice = Math.max(..._initSlice.map(b => b.high));
        const lowPrice = Math.min(..._initSlice.map(b => b.low));
        const totalVol = _initSlice.reduce((s, b) => s + (b.volume || 0), 0);
        const pctChange = parseFloat(pct(openPrice, closePrice));
        const barCount = _initSlice.length;
        const durationH = ((_initSlice[_initSlice.length - 1].time - _initSlice[0].time) / 3600).toFixed(1);
        const cls = pctChange >= 0 ? "up" : "down";

        document.getElementById("analyse-stats-bar").innerHTML = `
      <div class="analyse-stat"><span class="analyse-stat-label">Open</span><span class="analyse-stat-value">${fmt(openPrice, precision)}</span></div>
      <div class="analyse-stat"><span class="analyse-stat-label">High</span><span class="analyse-stat-value up">${fmt(highPrice, precision)}</span></div>
      <div class="analyse-stat"><span class="analyse-stat-label">Low</span><span class="analyse-stat-value down">${fmt(lowPrice, precision)}</span></div>
      <div class="analyse-stat"><span class="analyse-stat-label">Close</span><span class="analyse-stat-value">${fmt(closePrice, precision)}</span></div>
      <div class="analyse-stat"><span class="analyse-stat-label">Change</span><span class="analyse-stat-value ${cls}">${pctChange >= 0 ? "+" : ""}${pctChange}%</span></div>
      <div class="analyse-stat"><span class="analyse-stat-label">Volume</span><span class="analyse-stat-value warn">${totalVol >= 1e6 ? (totalVol / 1e6).toFixed(2) + "M" : totalVol >= 1e3 ? (totalVol / 1e3).toFixed(1) + "K" : totalVol.toFixed(0)}</span></div>
      <div class="analyse-stat"><span class="analyse-stat-label">Bars</span><span class="analyse-stat-value">${barCount}</span></div>
      <div class="analyse-stat"><span class="analyse-stat-label">Duration</span><span class="analyse-stat-value">${durationH}h</span></div>
    `;

        modal.style.display = "flex";
        const wrap = document.getElementById("analyse-chart-wrap");
        wrap.innerHTML = "";
        const priceFmt = getPriceFormat(closePrice);

        // ── SNAPSHOT data tại signalIdx (tính 1 lần, không tái tính trong replay) ───────────
        // slice dùng cho analysis panel & overlay
        const slice = globalBars.slice(fromIdx, signalIdx + 1);

        // Bot2 line series — chỉ đến signalIdx
        const bot2T1Snap = globalBot2.t1Data.slice(fromIdx, signalIdx + 1);
        const bot2T2Snap = globalBot2.t2Data.slice(fromIdx, signalIdx + 1);

        // Bot1 cycles til signalIdx
        const bot1CyclesSlice = [];
        for (const cyc of globalBot1.cycles) {
            const cS = Math.max(cyc.startIndex, fromIdx);
            const cE = Math.min(cyc.endIndex ?? signalIdx, signalIdx);
            if (cS > cE) continue;
            const barsForCycle = [];
            for (let gi = cS; gi <= cE; gi++) {
                barsForCycle.push({
                    ...globalBars[gi],
                    t1: globalBot1.t1Data[gi].value,
                    t2: globalBot1.t2Data[gi].value
                });
            }
            bot1CyclesSlice.push({ state: cyc.state, startIndex: cS - fromIdx, endIndex: cE - fromIdx, bars: barsForCycle });
        }

        // VSR zones til signalIdx
        const vsrZonesSlice = [];
        for (const z of globalVsrZones) {
            if (z.endIndex < fromIdx || z.startIndex > signalIdx) continue;
            vsrZonesSlice.push({
                upper: z.upper, lower: z.lower,
                startIndex: Math.max(z.startIndex, fromIdx) - fromIdx,
                endIndex: Math.min(z.endIndex, signalIdx) - fromIdx,
            });
        }

        const vpData = calculateFRVP(slice);
        const fvgList = calculateFVGs(slice);

        // Replay bars — dữ liệu thô OHLCV của currentCycle (không tái tính indicator)
        const replayCycleEnd = currentCycle
            ? Math.min((currentCycle.endIndex ?? globalBars.length - 1), globalBars.length - 1)
            : globalBars.length - 1;
        const replayBars = globalBars.slice(signalIdx + 1, replayCycleEnd + 1);
        let replayIdx = 0; // con trỏ trong replayBars

        // Pre-extract ATRBot1 + VSR cho phần replay (từ globalBars, không tính lại)
        const replayBot1Cycles = [];
        for (const cyc of globalBot1.cycles) {
            const cS = Math.max(cyc.startIndex, signalIdx + 1);
            const cE = Math.min(cyc.endIndex ?? replayCycleEnd, replayCycleEnd);
            if (cS > cE) continue;
            const barsForCycle = [];
            for (let gi = cS; gi <= cE; gi++) {
                barsForCycle.push({
                    time: globalBars[gi].time,
                    t1: globalBot1.t1Data[gi].value, t2: globalBot1.t2Data[gi].value
                });
            }
            replayBot1Cycles.push({ state: cyc.state, startIndex: cS - fromIdx, endIndex: cE - fromIdx, bars: barsForCycle });
        }
        const replayVsrZones = [];
        for (const z of globalVsrZones) {
            if (z.endIndex < signalIdx + 1 || z.startIndex > replayCycleEnd) continue;
            replayVsrZones.push({
                upper: z.upper, lower: z.lower,
                startIndex: Math.max(z.startIndex, signalIdx + 1) - fromIdx,
                endIndex: Math.min(z.endIndex, replayCycleEnd) - fromIdx,
            });
        }




        // ── LAYOUT: chartSection (70%) | analysisPanel (30%) ───────────────────
        const chartSection = document.createElement('div');
        chartSection.className = 'analyse-chart-section';
        wrap.appendChild(chartSection);

        const analysisPanel = document.createElement('div');
        analysisPanel.className = 'analyse-panel';
        wrap.appendChild(analysisPanel);

        // ── TOOLBAR ─────────────────────────────────────────────────────────────
        const toolbar = document.createElement("div");
        toolbar.id = "analyse-toolbar";

        function makeToggle(id, label, checked, color1, color2, onChange) {
            const btn = document.createElement("button");
            btn.className = "am-toggle" + (checked ? " am-toggle-on" : "");
            btn.dataset.id = id;
            btn.innerHTML =
                `<span class="am-toggle-dot" style="background:${color1}"></span>` +
                (color2 ? `<span class="am-toggle-dot" style="background:${color2}"></span>` : "") +
                `<span class="am-toggle-label">${label}</span>`;
            btn.addEventListener("click", () => {
                const on = !btn.classList.contains("am-toggle-on");
                btn.classList.toggle("am-toggle-on", on);
                onChange(on);
                requestAnimationFrame(drawOverlayCanvas);
            });
            return btn;
        }

        // bot1 / bot2 toggles rewired after series creation (see block below)
        toolbar.appendChild(makeToggle("bot1", `ATRBot 1 (${ATR_LENGTH}/${EMA_LENGTH}/${ATR_MULT})`, amShowBot1, "#00E676", "#FF5252", () => { }));
        toolbar.appendChild(makeToggle("bot2", "ATRBot 2 (10/14/1.0)", amShowBot2, "#00BCD4", "#FF9800", () => { }));
        toolbar.appendChild(makeToggle("vsr", "VSR", amShowVSR, "#FFEB3B", null, v => { amShowVSR = v; localStorage.setItem("am_showVSR", v ? "1" : "0"); }));
        toolbar.appendChild(makeToggle("vp", "Volume Profile", amShowVP, "#5B8CFF", null, v => { amShowVP = v; localStorage.setItem("am_showVP", v ? "1" : "0"); }));
        toolbar.appendChild(makeToggle("fvg", "FVG", amShowFVG, "#A78BFA", null, v => { amShowFVG = v; localStorage.setItem("am_showFVG", v ? "1" : "0"); }));

        // Nút Replay — bar-by-bar (chỉ feed OHLCV, không tái tính indicator)
        const replayBtn = document.createElement('button');
        replayBtn.className = 'am-toggle am-replay-btn';
        replayBtn.id = 'am-replay-btn';

        // Speed selector
        const speedSel = document.createElement('select');
        speedSel.className = 'am-speed-sel';
        [['0.5×', 600], ['1×', 300], ['2×', 150], ['4×', 70]].forEach(([label, ms]) => {
            const o = document.createElement('option');
            o.value = ms; o.textContent = label;
            if (ms === 300) o.selected = true;
            speedSel.appendChild(o);
        });

        let replayTimer = null;
        const remaining = () => replayBars.length - replayIdx;

        function updateReplayBtn() {
            const r = remaining();
            const playing = replayTimer !== null;
            replayBtn.disabled = r <= 0 && !playing;
            if (r <= 0) {
                replayBtn.innerHTML = `<span>⏹️</span><span class="am-toggle-label" style="opacity:.4">Hết dữ liệu</span>`;
                replayBtn.classList.remove('am-replay-playing');
            } else if (playing) {
                replayBtn.innerHTML = `<span>⏸️</span><span class="am-toggle-label">⏸ Dừng <span style="opacity:.5;font-size:9px">${r} nến còn</span></span>`;
                replayBtn.classList.add('am-replay-playing');
            } else {
                replayBtn.innerHTML = `<span>▶️</span><span class="am-toggle-label">Replay <span style="opacity:.5;font-size:9px">${r} nến</span></span>`;
                replayBtn.classList.remove('am-replay-playing');
            }
        }

        function stopReplay() {
            if (replayTimer) { clearInterval(replayTimer); replayTimer = null; }
            updateReplayBtn();
        }

        function startReplay() {
            if (replayTimer || remaining() <= 0) return;
            const MARGIN = 100;       // USDT
            const LEVERAGE = 20;
            const POS_SIZE = MARGIN * LEVERAGE; // 2000 USDT

            replayTimer = setInterval(() => {
                if (replayIdx >= replayBars.length) { stopReplay(); return; }

                // Feed OHLCV bar
                const b = replayBars[replayIdx++];
                candleSeries2.update({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close });

                // ── Kiểm tra từng trade: hit SL / TP, cập nhật PnL / ROE ─────────────────
                let needRefreshPanel = false;
                for (const t of trades) {
                    if (t.status && t.status !== 'open') continue; // đã đóng

                    // Trade chưa vào (chưa có status) -> set open ngay lần đầu
                    if (!t.status) { t.status = 'open'; t.margin = MARGIN; t.leverage = LEVERAGE; }

                    // Kiểm tra SL/TP hit (check candle high/low)
                    let closed = false;
                    if (t.dir === 'LONG') {
                        if (b.low <= t.sl) {
                            t.status = 'sl'; t.closePrice = t.sl; closed = true;
                        } else if (b.high >= t.tp) {
                            t.status = 'tp'; t.closePrice = t.tp; closed = true;
                        }
                    } else { // SHORT
                        if (b.high >= t.sl) {
                            t.status = 'sl'; t.closePrice = t.sl; closed = true;
                        } else if (b.low <= t.tp) {
                            t.status = 'tp'; t.closePrice = t.tp; closed = true;
                        }
                    }

                    // Tính PnL / ROE theo giá hiện tại (hoặc giá đóng)
                    const curPrice = closed ? t.closePrice : b.close;
                    const priceDelta = t.dir === 'LONG'
                        ? (curPrice - t.entryPrice) / t.entryPrice
                        : (t.entryPrice - curPrice) / t.entryPrice;
                    t.pnl = priceDelta * POS_SIZE;
                    t.roe = priceDelta * LEVERAGE * 100; // %

                    needRefreshPanel = true;
                }
                if (needRefreshPanel) refreshTradePanel();

                // Overlay: vẽ lại ATRBot1 + VSR phần replay
                requestAnimationFrame(drawOverlayCanvas);

                updateReplayBtn();

            }, parseInt(speedSel.value, 10));
            updateReplayBtn();
        }


        replayBtn.addEventListener('click', () => replayTimer ? stopReplay() : startReplay());
        speedSel.addEventListener('change', () => { if (replayTimer) { stopReplay(); startReplay(); } });

        updateReplayBtn();
        toolbar.appendChild(replayBtn);
        toolbar.appendChild(speedSel);
        wrap._stopReplay = stopReplay;


        chartSection.appendChild(toolbar);

        // ── CHART CONTAINER ─────────────────────────────────────────────────────
        const chartDiv = document.createElement("div");
        chartDiv.style.cssText = "position:relative; flex:1; min-height:0;";
        chartSection.appendChild(chartDiv);

        analyseChartInstance = LightweightCharts.createChart(chartDiv, {
            width: chartDiv.clientWidth,
            height: chartDiv.clientHeight,
            layout: {
                background: { type: "solid", color: "#0b0b16" },
                textColor: "#8892a4",
                fontFamily: "'Outfit', sans-serif",
                fontSize: 11,
            },
            grid: { vertLines: { color: "rgba(255,255,255,0.03)" }, horzLines: { color: "rgba(255,255,255,0.03)" } },
            crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
            rightPriceScale: { borderColor: "#1e2435", scaleMargins: { top: 0.08, bottom: 0.12 } },
            timeScale: { borderColor: "#1e2435", timeVisible: true, secondsVisible: false },
        });

        // Candlestick: tắt đường last-price ngang trên price scale
        const candleSeries2 = analyseChartInstance.addSeries(LightweightCharts.CandlestickSeries, {
            upColor: "#00E676", downColor: "#FF5252",
            wickUpColor: "#00E676", wickDownColor: "#FF5252",
            borderVisible: false,
            priceLineVisible: false,   // ← tắt đường gạch ngang last price
            lastValueVisible: false,   // ← tắt label giá cuối trên price scale
        });
        candleSeries2.applyOptions({
            priceFormat: { type: "price", precision: priceFmt.precision, minMove: priceFmt.minMove },
        });
        candleSeries2.setData(slice.map(b => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close })));

        // ATRBot 2 — nét đứt (LineSeries)
        const b2t1s = analyseChartInstance.addSeries(LightweightCharts.LineSeries, {
            color: "#00BCD4", lineWidth: 1.5, lineStyle: LightweightCharts.LineStyle.Dashed,
            priceLineVisible: false, lastValueVisible: false, visible: amShowBot2,
        });
        const b2t2s = analyseChartInstance.addSeries(LightweightCharts.LineSeries, {
            color: "#FF9800", lineWidth: 1.5, lineStyle: LightweightCharts.LineStyle.Dashed,
            priceLineVisible: false, lastValueVisible: false, visible: amShowBot2,
        });
        b2t1s.setData(bot2T1Snap);
        b2t2s.setData(bot2T2Snap);


        analyseChartInstance.timeScale().fitContent();

        // ── RENDER ANALYSIS PANEL ────────────────────────────────────────────────
        analysisPanel.innerHTML = generateAnalysisHTML({
            slice, bot1CyclesSlice, vsrZonesSlice, fvgList, vpData,
            precision: priceFmt.precision,
        });



        // ── CANVAS OVERLAY ──────────────────────────────────────────────────────
        const overlayCanvas = document.createElement("canvas");
        overlayCanvas.style.cssText = "position:absolute; top:0; left:0; pointer-events:none; z-index:10;";
        chartDiv.appendChild(overlayCanvas);

        // ── ENTRY TOOL (multi-trade, draggable) ─────────────────────────────────
        const entryBtn = document.createElement('button');
        entryBtn.className = 'am-toggle am-entry-btn';
        entryBtn.innerHTML = `<span>📌</span><span class="am-toggle-label">Đặt lệnh</span>`;
        toolbar.insertBefore(entryBtn, replayBtn);

        // trade = { id, dir, entryPrice, sl, tp, entryLine, slLine, tpLine }
        const trades = [];
        let entryMode = false;
        let dragging = null;  // { trade, handle:'entry'|'sl'|'tp' }
        const DRAG_TOL = 7;    // px tolerance để nhận line kéo

        const LS = LightweightCharts.LineStyle;
        const pr = priceFmt.precision;
        const pf = v => v.toFixed(pr);

        // ── Helper: tính SL gợi ý dựa FVG ──────────────────────────────────────
        function calcSL(dir, entryPrice) {
            const lastCyc = bot1CyclesSlice[bot1CyclesSlice.length - 1];
            if (dir === 'SHORT') {
                const abv = fvgList.filter(fg => fg.bottom > entryPrice);
                const ref = abv.length > 0 ? Math.max(...abv.map(fg => fg.top))
                    : Math.max(...slice.slice(-10).map(b => b.high));
                return ref * 1.001;
            } else {
                const bel = fvgList.filter(fg => fg.top < entryPrice);
                const ref = bel.length > 0 ? Math.min(...bel.map(fg => fg.bottom))
                    : Math.min(...slice.slice(-10).map(b => b.low));
                return ref * 0.999;
            }
        }

        // ── Refresh analysis panel: vẽ lại tất cả trade cards ──────────────────
        function refreshTradePanel() {
            let container = analysisPanel.querySelector('.ap-trades-container');
            if (!container) {
                container = document.createElement('div');
                container.className = 'ap-trades-container';
                analysisPanel.prepend(container);
            }
            if (trades.length === 0) { container.innerHTML = ''; return; }

            container.innerHTML = `<div class="ap-title">📌 Lệnh đã đặt (${trades.length})</div>` +
                trades.map(t => {
                    const risk = Math.abs(t.sl - t.entryPrice);
                    const reward = Math.abs(t.tp - t.entryPrice);
                    const rr = risk > 0 ? (reward / risk).toFixed(2) : '—';
                    const riskPct = (risk / t.entryPrice * 100).toFixed(2);
                    const rwPct = (reward / t.entryPrice * 100).toFixed(2);

                    // Status badge
                    const status = t.status || 'pending';
                    const statusMap = {
                        pending: ['⏳ Chờ', 'rgba(148,163,184,.6)', '#fff'],
                        open: ['🔵 Đang chạy', 'rgba(59,130,246,.25)', '#60A5FA'],
                        tp: ['✅ TP HIT', 'rgba(0,200,100,.2)', '#00E676'],
                        sl: ['❌ SL HIT', 'rgba(255,82,82,.2)', '#FF5252'],
                    };
                    const [statusLabel, statusBg, statusColor] = statusMap[status] || statusMap.pending;

                    // PnL / ROE (chỉ hiển thị khi đã open)
                    let pnlHtml = '';
                    if (t.pnl !== undefined) {
                        const pnlColor = t.pnl >= 0 ? '#00E676' : '#FF5252';
                        const sign = t.pnl >= 0 ? '+' : '';
                        pnlHtml = `
                <div class="ap-trade-pnl-block" style="margin-top:6px;padding:6px 8px;border-radius:6px;background:${t.pnl >= 0 ? 'rgba(0,230,118,.08)' : 'rgba(255,82,82,.08)'};border:1px solid ${t.pnl >= 0 ? 'rgba(0,230,118,.25)' : 'rgba(255,82,82,.25)'}">
                  <div style="display:flex;justify-content:space-between;align-items:center">
                    <span style="color:rgba(255,255,255,.4);font-size:9px">PnL (100U×20×)</span>
                    <span style="color:${pnlColor};font-weight:700;font-size:12px">${sign}${t.pnl.toFixed(2)} USDT</span>
                  </div>
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-top:2px">
                    <span style="color:rgba(255,255,255,.4);font-size:9px">ROE%</span>
                    <span style="color:${pnlColor};font-weight:700;font-size:12px">${sign}${t.roe.toFixed(2)}%</span>
                  </div>
                  ${t.closePrice ? `<div style="color:rgba(255,255,255,.35);font-size:9px;margin-top:2px">Đóng @ ${pf(t.closePrice)}</div>` : ''}
                </div>`;
                    }

                    return `
              <div class="ap-trade-card" data-id="${t.id}">
                <div class="ap-trade-card-header">
                  <span class="ap-trade-val ${t.dir === 'LONG' ? 'tp' : 'sl'}">${t.dir === 'LONG' ? '⬆ LONG' : '⬇ SHORT'}</span>
                  <span class="ap-trade-status-badge" style="background:${statusBg};color:${statusColor}">${statusLabel}</span>
                  <button class="ap-trade-del" onclick="window._delTrade(${t.id})">✕</button>
                </div>
                <div class="ap-trade-row"><span class="ap-trade-label">Entry</span>
                  <span class="ap-trade-val entry">${pf(t.entryPrice)}</span></div>
                <div class="ap-trade-row"><span class="ap-trade-label">SL</span>
                  <span class="ap-trade-val sl">${pf(t.sl)} <span class="ap-trade-pct">−${riskPct}%</span></span></div>
                <div class="ap-trade-row"><span class="ap-trade-label">TP</span>
                  <span class="ap-trade-val tp">${pf(t.tp)} <span class="ap-trade-pct">+${rwPct}%</span></span></div>
                <div class="ap-trade-row"><span class="ap-trade-label">R:R</span>
                  <span class="ap-trade-val rr">1 : ${rr}</span></div>
                ${pnlHtml}
              </div>`;
                }).join('');
        }


        // ── Add trade ───────────────────────────────────────────────────────────
        function addTrade(entryPrice) {
            const lastCyc = bot1CyclesSlice[bot1CyclesSlice.length - 1];
            const dir = (lastCyc && lastCyc.state === -1) ? 'SHORT' : 'LONG';
            const sl = calcSL(dir, entryPrice);
            const risk = Math.abs(sl - entryPrice);
            const tp = dir === 'LONG' ? entryPrice + 2 * risk : entryPrice - 2 * risk;
            const id = Date.now();
            const riskPct = (Math.abs(sl - entryPrice) / entryPrice * 100).toFixed(2);
            const rewardPct = (Math.abs(tp - entryPrice) / entryPrice * 100).toFixed(2);
            const trade = {
                id, dir, entryPrice, sl, tp,
                entryLine: candleSeries2.createPriceLine({ price: entryPrice, color: '#E2E8F0', lineWidth: 2, lineStyle: LS.Solid, title: `#${trades.length + 1} Entry ${dir}`, axisLabelVisible: true }),
                slLine: candleSeries2.createPriceLine({ price: sl, color: '#FF5252', lineWidth: 1, lineStyle: LS.Dashed, title: `SL −${riskPct}%`, axisLabelVisible: true }),
                tpLine: candleSeries2.createPriceLine({ price: tp, color: '#00E676', lineWidth: 1, lineStyle: LS.Dashed, title: `TP +${rewardPct}% (2R)`, axisLabelVisible: true }),
            };
            trades.push(trade);
            refreshTradePanel();
            updateClickCanvasEvents();
            return trade;
        }

        // ── Remove trade ────────────────────────────────────────────────────────
        function removeTrade(id) {
            const idx = trades.findIndex(t => t.id === id);
            if (idx < 0) return;
            const t = trades[idx];
            try { candleSeries2.removePriceLine(t.entryLine); } catch (_) { }
            try { candleSeries2.removePriceLine(t.slLine); } catch (_) { }
            try { candleSeries2.removePriceLine(t.tpLine); } catch (_) { }
            trades.splice(idx, 1);
            refreshTradePanel();
            updateClickCanvasEvents();
        }
        window._delTrade = removeTrade;  // truy cập từ onclick inline

        // ── Update price lines sau khi drag ────────────────────────────────────
        function applyTrade(t) {
            const riskPct = (Math.abs(t.sl - t.entryPrice) / t.entryPrice * 100).toFixed(2);
            const rewardPct = (Math.abs(t.tp - t.entryPrice) / t.entryPrice * 100).toFixed(2);
            t.entryLine.applyOptions({ price: t.entryPrice });
            t.slLine.applyOptions({ price: t.sl, title: `SL −${riskPct}%` });
            t.tpLine.applyOptions({ price: t.tp, title: `TP +${rewardPct}% (2R)` });
            refreshTradePanel();
        }

        // ── Click canvas (pointer-events controlled) ────────────────────────────
        const entryClickCanvas = document.createElement('canvas');
        entryClickCanvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:11;';
        chartDiv.appendChild(entryClickCanvas);

        function updateClickCanvasEvents() {
            const need = entryMode || trades.length > 0;
            entryClickCanvas.style.pointerEvents = need ? 'all' : 'none';
            entryClickCanvas.style.cursor = entryMode ? 'crosshair' : 'default';
        }

        function setEntryMode(on) {
            entryMode = on;
            entryBtn.classList.toggle('am-toggle-on', on);
            updateClickCanvasEvents();
        }

        entryBtn.addEventListener('click', () => setEntryMode(!entryMode));

        // ── Sync size với overlayCanvas ─────────────────────────────────────────
        const syncClickCanvas = () => {
            entryClickCanvas.width = overlayCanvas.width;
            entryClickCanvas.height = overlayCanvas.height;
            entryClickCanvas.style.width = overlayCanvas.style.width;
            entryClickCanvas.style.height = overlayCanvas.style.height;
        };

        // ── Hit-test: tìm trade và handle gần nhất ──────────────────────────────
        function hitTest(y) {
            for (const t of trades) {
                const ey = candleSeries2.priceToCoordinate(t.entryPrice);
                const sy = candleSeries2.priceToCoordinate(t.sl);
                const ty = candleSeries2.priceToCoordinate(t.tp);
                if (ey !== null && Math.abs(y - ey) <= DRAG_TOL) return { trade: t, handle: 'entry' };
                if (sy !== null && Math.abs(y - sy) <= DRAG_TOL) return { trade: t, handle: 'sl' };
                if (ty !== null && Math.abs(y - ty) <= DRAG_TOL) return { trade: t, handle: 'tp' };
            }
            return null;
        }

        // ── Pointer events: mousedown / mousemove / mouseup ──────────────────────
        entryClickCanvas.addEventListener('mousedown', (e) => {
            const rect = entryClickCanvas.getBoundingClientRect();
            const y = e.clientY - rect.top;
            const hit = hitTest(y);
            if (hit) {
                dragging = hit;
                e.preventDefault();
                return;
            }
            // Không trúng line nào → nếu đang ở entry mode thì đặt lệnh mới
            if (entryMode) {
                const price = candleSeries2.coordinateToPrice(y);
                if (price != null) { addTrade(price); setEntryMode(false); }
            }
        });

        entryClickCanvas.addEventListener('mousemove', (e) => {
            const rect = entryClickCanvas.getBoundingClientRect();
            const y = e.clientY - rect.top;

            if (dragging) {
                const newPrice = candleSeries2.coordinateToPrice(y);
                if (newPrice == null) return;
                const t = dragging.trade;

                if (dragging.handle === 'entry') {
                    // Shift toàn bộ (entry + SL + TP cùng delta)
                    const delta = newPrice - t.entryPrice;
                    t.entryPrice += delta;
                    t.sl += delta;
                    t.tp += delta;
                } else if (dragging.handle === 'sl') {
                    // SL mới → tính lại TP 2R
                    t.sl = newPrice;
                    const risk = Math.abs(t.sl - t.entryPrice);
                    t.tp = t.dir === 'LONG' ? t.entryPrice + 2 * risk : t.entryPrice - 2 * risk;
                } else if (dragging.handle === 'tp') {
                    // TP tự do (user tự chọn)
                    t.tp = newPrice;
                }
                applyTrade(t);
                return;
            }

            // Hover: đổi cursor
            if (entryMode) {
                entryClickCanvas.style.cursor = 'crosshair';
            } else {
                const hit = hitTest(y);
                entryClickCanvas.style.cursor = hit ? 'ns-resize' : 'default';
            }
        });

        const stopDrag = () => { dragging = null; };
        entryClickCanvas.addEventListener('mouseup', stopDrag);
        entryClickCanvas.addEventListener('mouseleave', stopDrag);


        // Rewire bot1 & bot2 toggles (b2t1s / b2t2s now available)
        {
            const bot1Btn = toolbar.querySelector('[data-id="bot1"]');
            if (bot1Btn) {
                const nb = bot1Btn.cloneNode(true);
                nb.addEventListener("click", () => {
                    const on = !nb.classList.contains("am-toggle-on");
                    nb.classList.toggle("am-toggle-on", on);
                    amShowBot1 = on;
                    localStorage.setItem("am_showBot1", on ? "1" : "0");
                    requestAnimationFrame(drawOverlayCanvas);
                });
                bot1Btn.replaceWith(nb);
            }
            const bot2Btn = toolbar.querySelector('[data-id="bot2"]');
            if (bot2Btn) {
                const nb = bot2Btn.cloneNode(true);
                nb.addEventListener("click", () => {
                    const on = !nb.classList.contains("am-toggle-on");
                    nb.classList.toggle("am-toggle-on", on);
                    amShowBot2 = on;
                    localStorage.setItem("am_showBot2", on ? "1" : "0");
                    b2t1s.applyOptions({ visible: on });
                    b2t2s.applyOptions({ visible: on });
                });
                bot2Btn.replaceWith(nb);
            }
        }

        // ── DRAW FUNCTION ────────────────────────────────────────────────────────
        function drawOverlayCanvas() {
            if (!analyseChartInstance) return;
            const chartW = chartDiv.clientWidth;
            const chartH = Math.max(1, chartDiv.clientHeight - 26);
            overlayCanvas.width = chartW;
            overlayCanvas.height = chartH;
            overlayCanvas.style.width = chartW + "px";
            overlayCanvas.style.height = chartH + "px";
            const oc = overlayCanvas.getContext("2d");
            oc.clearRect(0, 0, chartW, chartH);
            syncClickCanvas();


            const ts = analyseChartInstance.timeScale();
            if (!ts.getVisibleLogicalRange()) return;

            // ── Pass 0: VSR zones ────────────────────────────────────────────────
            if (amShowVSR) {
                for (const z of vsrZonesSlice) {
                    const xS = ts.logicalToCoordinate(z.startIndex);
                    const xE = ts.logicalToCoordinate(z.endIndex);
                    const xL = xS !== null ? xS : -1000;
                    const xR = xE !== null ? xE : chartW + 1000;
                    const zW = xR - xL;
                    if (zW <= 0) continue;
                    const y1 = candleSeries2.priceToCoordinate(z.upper);
                    const y2 = candleSeries2.priceToCoordinate(z.lower);
                    if (y1 === null || y2 === null) continue;
                    const topY = Math.min(y1, y2), botY = Math.max(y1, y2);
                    oc.fillStyle = "rgba(255,235,59,0.12)";
                    oc.fillRect(xL, topY, zW, botY - topY);
                    oc.strokeStyle = "rgba(255,235,59,0.5)";
                    oc.lineWidth = 1; oc.setLineDash([]);
                    oc.beginPath();
                    oc.moveTo(xL, topY); oc.lineTo(xR, topY);
                    oc.moveTo(xL, botY); oc.lineTo(xR, botY);
                    oc.stroke();
                }
            }

            // ── Pass 1: ATRBot1 cloud fill only (không vẽ trail lines) ──────────────
            if (amShowBot1) {
                // Vẽ cả analysis slice lẫn replay cycles
                const allBot1 = [...bot1CyclesSlice, ...replayBot1Cycles];
                for (const cyc of allBot1) {
                    const bars = cyc.bars;
                    if (!bars.length) continue;
                    oc.beginPath();
                    let moved = false;
                    for (let i = 0; i < bars.length; i++) {
                        const x = ts.logicalToCoordinate(cyc.startIndex + i);
                        const y = candleSeries2.priceToCoordinate(bars[i].t1);
                        if (x !== null && y !== null) { moved ? oc.lineTo(x, y) : (oc.moveTo(x, y), moved = true); }
                    }
                    if (moved) {
                        for (let i = bars.length - 1; i >= 0; i--) {
                            const x = ts.logicalToCoordinate(cyc.startIndex + i);
                            const y = candleSeries2.priceToCoordinate(bars[i].t2);
                            if (x !== null && y !== null) oc.lineTo(x, y);
                        }
                        oc.closePath();
                        oc.fillStyle = cyc.state === 1 ? 'rgba(0,230,118,0.18)' : 'rgba(255,82,82,0.18)';
                        oc.fill();
                    }
                    // Chỉ fill, KHÔNG vẽ trail lines
                }
            }

            // ── Pass 1b: VSR zones phần replay (từ globalData) ────────────────────
            if (amShowVSR) {
                for (const z of replayVsrZones) {
                    const xS = ts.logicalToCoordinate(z.startIndex);
                    const xE = ts.logicalToCoordinate(z.endIndex);
                    const xL = xS !== null ? xS : -1000;
                    const xR = xE !== null ? xE : chartW + 1000;
                    const zW = xR - xL;
                    if (zW <= 0) continue;
                    const y1 = candleSeries2.priceToCoordinate(z.upper);
                    const y2 = candleSeries2.priceToCoordinate(z.lower);
                    if (y1 === null || y2 === null) continue;
                    const topY = Math.min(y1, y2), botY = Math.max(y1, y2);
                    oc.fillStyle = 'rgba(255,235,59,0.1)';
                    oc.fillRect(xL, topY, zW, botY - topY);
                    oc.strokeStyle = 'rgba(255,235,59,0.45)';
                    oc.lineWidth = 1; oc.setLineDash([4, 4]);
                    oc.beginPath();
                    oc.moveTo(xL, topY); oc.lineTo(xR, topY);
                    oc.moveTo(xL, botY); oc.lineTo(xR, botY);
                    oc.stroke(); oc.setLineDash([]);
                }
            }


            // ── Pass 2: Volume Profile (left-aligned) ────────────────────────────
            if (amShowVP && vpData && vpData.rows && vpData.rows.length) {
                const maxBarW = Math.min(120, chartW * 0.22);
                const xLeft = 4;
                for (const r of vpData.rows) {
                    const yT = candleSeries2.priceToCoordinate(r.priceTop);
                    const yB = candleSeries2.priceToCoordinate(r.priceBottom);
                    if (yT === null || yB === null) continue;
                    const topY = Math.min(yT, yB);
                    const rowH = Math.max(1, Math.abs(yB - yT) - 1);
                    const buyW = (r.buyVol / vpData.maxVol) * maxBarW;
                    const sellW = (r.sellVol / vpData.maxVol) * maxBarW;
                    const totalW = buyW + sellW;
                    const isBuyDom = r.buyVol >= r.sellVol;
                    const inVA = r.inVA;
                    if (sellW > 0) {
                        oc.fillStyle = isBuyDom
                            ? (inVA ? "rgba(23,72,111,0.85)" : "rgba(23,72,111,0.35)")
                            : (inVA ? "rgba(130,60,0,0.85)" : "rgba(130,60,0,0.35)");
                        oc.fillRect(xLeft, topY, sellW, rowH);
                    }
                    if (buyW > 0) {
                        oc.fillStyle = isBuyDom
                            ? (inVA ? "rgba(22,112,175,0.95)" : "rgba(22,112,175,0.4)")
                            : (inVA ? "rgba(183,110,0,0.95)" : "rgba(183,110,0,0.4)");
                        oc.fillRect(xLeft + sellW, topY, buyW, rowH);
                    }
                    if (r.poc) {
                        oc.strokeStyle = vpData.pocDelta >= 0 ? "rgba(76,175,80,1)" : "rgba(255,82,82,1)";
                        oc.lineWidth = 2; oc.setLineDash([]);
                        oc.beginPath();
                        oc.moveTo(xLeft - 2, topY + rowH / 2);
                        oc.lineTo(xLeft + totalW + 2, topY + rowH / 2);
                        oc.stroke();
                    }
                }
                const drawHLine = (price, color, label, labelOffset) => {
                    const yCo = candleSeries2.priceToCoordinate(price);
                    if (yCo === null) return;
                    const lineEnd = xLeft + maxBarW + 10;
                    oc.setLineDash([4, 4]); oc.strokeStyle = color; oc.lineWidth = 1;
                    oc.beginPath(); oc.moveTo(xLeft, yCo); oc.lineTo(lineEnd, yCo); oc.stroke();
                    oc.setLineDash([]);
                    oc.fillStyle = color; oc.font = "10px Outfit, sans-serif"; oc.textAlign = "left";
                    oc.fillText(label, lineEnd + 4, yCo + labelOffset);
                };
                if (vpData.vahPrice != null) drawHLine(vpData.vahPrice, "rgba(33,150,243,0.9)", "VAH", -3);
                if (vpData.valPrice != null) drawHLine(vpData.valPrice, "rgba(255,193,7,0.9)", "VAL", 11);
            }

            // ── Pass 3: FVG (Fair Value Gap / Imbalance) ─────────────────────────
            if (amShowFVG && fvgList.length) {
                for (const fvg of fvgList) {
                    const yTop = candleSeries2.priceToCoordinate(fvg.top);
                    const yBot = candleSeries2.priceToCoordinate(fvg.bottom);
                    if (yTop === null || yBot === null) continue;
                    const xStart = ts.logicalToCoordinate(fvg.startBar);
                    const xEnd = ts.logicalToCoordinate(slice.length - 1); // kéo đến cuối
                    if (xStart === null || xEnd === null) continue;
                    const fvgW = Math.max(0, xEnd - xStart);
                    const topY = Math.min(yTop, yBot);
                    const fvgH = Math.max(2, Math.abs(yBot - yTop));

                    if (fvg.type === "bullish") {
                        // Vùng Bullish FVG — màu tím nhạt, border tím
                        oc.fillStyle = "rgba(167,139,250,0.13)";
                        oc.fillRect(xStart, topY, fvgW, fvgH);
                        oc.strokeStyle = "rgba(167,139,250,0.6)";
                        oc.lineWidth = 1; oc.setLineDash([3, 3]);
                        oc.strokeRect(xStart, topY, fvgW, fvgH);
                        // Label "BFVG"
                        oc.setLineDash([]);
                        oc.fillStyle = "rgba(167,139,250,0.9)";
                        oc.font = "9px Outfit, sans-serif";
                        oc.textAlign = "left";
                        oc.fillText("BFVG", xStart + 3, topY + fvgH / 2 + 3);
                    } else {
                        // Vùng Bearish FVG — màu cam đỏ nhạt
                        oc.fillStyle = "rgba(251,146,60,0.13)";
                        oc.fillRect(xStart, topY, fvgW, fvgH);
                        oc.strokeStyle = "rgba(251,146,60,0.6)";
                        oc.lineWidth = 1; oc.setLineDash([3, 3]);
                        oc.strokeRect(xStart, topY, fvgW, fvgH);
                        // Label "SFVG"
                        oc.setLineDash([]);
                        oc.fillStyle = "rgba(251,146,60,0.9)";
                        oc.font = "9px Outfit, sans-serif";
                        oc.textAlign = "left";
                        oc.fillText("SFVG", xStart + 3, topY + fvgH / 2 + 3);
                    }
                }
                oc.setLineDash([]);
            }
        }

        // ── Subscribe chart events để redraw overlay ─────────────────────────────
        analyseChartInstance.timeScale().subscribeVisibleLogicalRangeChange(() => {
            requestAnimationFrame(drawOverlayCanvas);
        });
        analyseChartInstance.subscribeCrosshairMove(() => {
            requestAnimationFrame(drawOverlayCanvas);
        });
        setTimeout(() => requestAnimationFrame(drawOverlayCanvas), 80);

        const ro = new ResizeObserver(() => {
            if (analyseChartInstance) {
                analyseChartInstance.applyOptions({ width: chartDiv.clientWidth, height: chartDiv.clientHeight });
                requestAnimationFrame(drawOverlayCanvas);
            }
        });
        ro.observe(chartDiv);
        wrap._ro = ro;
    }

    // ── Close modal ──────────────────────────────────────────────────────────
    function closeModal() {
        modal.style.display = "none";
        if (analyseChartInstance) {
            const wrap = document.getElementById("analyse-chart-wrap");
            // Stop replay nếu đang chạy
            if (wrap._stopReplay) { try { wrap._stopReplay(); } catch (_) { } wrap._stopReplay = null; }
            if (wrap._ro) { wrap._ro.disconnect(); wrap._ro = null; }
            try { analyseChartInstance.remove(); } catch (e) { }
            analyseChartInstance = null;
        }
        if (analyseModeActive) {
            analyseModeActive = false;
            syncSidebarFromState();
        }
    }


    closeBtn.addEventListener("click", closeModal);
    modal.addEventListener("pointerdown", e => { if (e.target === modal) closeModal(); });
    window.addEventListener("keydown", e => { if (e.key === "Escape" && modal.style.display !== "none") closeModal(); });

    // ── Sidebar button ───────────────────────────────────────────────────────
    const sbAnalyse = document.getElementById("sb-analyse");
    sbAnalyse.addEventListener("click", () => {
        if (analyseModeActive) { analyseModeActive = false; setDrawMode("cursor"); return; }
        setDrawMode("cursor");
        analyseModeActive = true;
        sbAnalyse.classList.add("active");
        wrapper.style.cursor = "crosshair";
        const hintEl = document.getElementById("draw-hint");
        if (hintEl) {
            hintEl.textContent = "Tap a candle to analyse its cycle";
            hintEl.classList.add("visible");
            clearTimeout(window._hintTimer);
            window._hintTimer = setTimeout(() => hintEl.classList.remove("visible"), 5000);
        }
    });

    // ── Click handler trên chart chính ──────────────────────────────────────
    wrapper.addEventListener("pointerdown", e => {
        if (!analyseModeActive) return;
        if (!e.isPrimary) return;
        const { logical } = ptrToChart(e);
        if (logical === null || !globalCycles.length || !globalBars.length) return;
        const barIdx = Math.max(0, Math.min(Math.round(logical), globalBars.length - 1));
        const cycleIdx = findCycleForBar(barIdx);
        const currentCycle = globalCycles[cycleIdx];
        const prevCycleIdx = cycleIdx > 0 ? cycleIdx - 1 : 0;
        const fromIdx = globalCycles[prevCycleIdx].startIndex;
        const signalIdx = currentCycle.startIndex; // bar ATRBot flip
        openAnalyseModal(fromIdx, signalIdx, currentCycle);
        analyseModeActive = false;
        wrapper.style.cursor = 'default';
        syncSidebarFromState();

    }, true);
}
