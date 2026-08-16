let stat3Chart = null;
let stat3CandleSeries = null;
let stat3OrderBlockPrimitive = null;
let stat3DebugMarkers = null;
let stat3StructureMarkers = null;
let stat3AnalysisPrimitive = null;
let stat3AtrSeries = null;
let stat3LastAnalysisData = {};

function stat3HexToRgba(hex, alpha) {
  const normalized = String(hex || "#ffffff").replace("#", "");
  const value = normalized.length === 3
    ? normalized.split("").map((c) => c + c).join("")
    : normalized.padEnd(6, "f").slice(0, 6);
  const number = parseInt(value, 16);
  return `rgba(${(number >> 16) & 255}, ${(number >> 8) & 255}, ${number & 255}, ${alpha})`;
}

class Stat3OrderBlockRenderer {
  constructor(view) {
    this.view = view;
  }

  draw(target) {
    const items = this.view.items;
    if (!items.length) return;
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const hRatio = scope.horizontalPixelRatio;
      const vRatio = scope.verticalPixelRatio;
      ctx.save();
      ctx.font = `${Math.round(10 * vRatio)}px Outfit, sans-serif`;
      ctx.textBaseline = "middle";

      items.forEach((item) => {
        const x1 = Math.round(item.x1 * hRatio);
        const x2 = item.x2 == null ? scope.bitmapSize.width : Math.round(item.x2 * hRatio);
        const top = Math.round(Math.min(item.y1, item.y2) * vRatio);
        const bottom = Math.round(Math.max(item.y1, item.y2) * vRatio);
        if (x2 <= x1 || bottom <= top) return;

        ctx.fillStyle = item.fill;
        ctx.fillRect(x1, top, x2 - x1, bottom - top);
        ctx.strokeStyle = item.stroke;
        ctx.lineWidth = Math.max(1, hRatio);
        ctx.setLineDash(item.dashed ? [5 * hRatio, 4 * hRatio] : []);
        ctx.strokeRect(x1 + 0.5, top + 0.5, Math.max(0, x2 - x1 - 1), Math.max(0, bottom - top - 1));

        if (item.showMidpoint !== false) {
          const mid = Math.round(((top + bottom) / 2));
          ctx.globalAlpha = 0.55;
          ctx.setLineDash([3 * hRatio, 3 * hRatio]);
          ctx.beginPath();
          ctx.moveTo(x1, mid);
          ctx.lineTo(x2, mid);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }

        if (x2 - x1 > 48 * hRatio && bottom - top > 13 * vRatio) {
          const label = item.label || `${item.direction === "bullish" ? "BULL" : "BEAR"} OB · ${item.score.toFixed(1)}`;
          const textWidth = ctx.measureText(label).width;
          const labelX = Math.min(x2 - textWidth - 5 * hRatio, x1 + 5 * hRatio);
          ctx.fillStyle = item.text;
          ctx.fillText(label, labelX, top + 8 * vRatio);
        }
      });
      ctx.restore();
    });
  }
}

class Stat3OrderBlockPaneView {
  constructor(source) {
    this.source = source;
    this.items = [];
    this.rendererImpl = new Stat3OrderBlockRenderer(this);
  }

  update() {
    const source = this.source;
    const range = source.chart?.timeScale().getVisibleLogicalRange();
    if (!source.visible || !range) {
      this.items = [];
      return;
    }

    const from = Math.floor(range.from) - 2;
    const to = Math.ceil(range.to) + 2;
    this.items = source.orderBlocks
      .filter((ob) => ob.score >= source.options.minScoreToRender)
      .filter((ob) => source.options.showHistorical || !["invalidated", "expired"].includes(ob.status))
      .filter((ob) => ob.originIndex <= to && (ob.endIndex == null || ob.endIndex >= from))
      .map((ob) => {
        const x1 = source.chart.timeScale().logicalToCoordinate(ob.originIndex);
        const x2 = ob.endIndex == null ? null : source.chart.timeScale().logicalToCoordinate(ob.endIndex);
        const y1 = source.series.priceToCoordinate(ob.high);
        const y2 = source.series.priceToCoordinate(ob.low);
        if (x1 == null || y1 == null || y2 == null) return null;
        const color = ob.direction === "bullish" ? source.options.bullishColor : source.options.bearishColor;
        const alphaByStatus = { active: 0.18, touched: 0.14, mitigated: 0.10, invalidated: 0.055, expired: 0.035 };
        return {
          x1,
          x2,
          y1,
          y2,
          direction: ob.direction,
          score: ob.score,
          label: `${ob.direction === "bullish" ? "BULL" : "BEAR"} OB · ${ob.score.toFixed(1)}`,
          fill: stat3HexToRgba(color, alphaByStatus[ob.status] ?? 0.08),
          stroke: stat3HexToRgba(color, ["invalidated", "expired"].includes(ob.status) ? 0.3 : 0.82),
          text: stat3HexToRgba(color, 0.95),
          dashed: ["invalidated", "expired"].includes(ob.status),
        };
      })
      .filter(Boolean);
  }

  renderer() {
    return this.rendererImpl;
  }

  zOrder() {
    return "bottom";
  }
}

class Stat3OrderBlockPrimitive {
  constructor(options = {}) {
    this.options = options;
    this.orderBlocks = [];
    this.visible = true;
    this.paneView = new Stat3OrderBlockPaneView(this);
  }

  attached({ chart, series, requestUpdate }) {
    this.chart = chart;
    this.series = series;
    this.requestUpdate = requestUpdate;
  }

  detached() {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  paneViews() {
    return [this.paneView];
  }

  updateAllViews() {
    this.paneView.update();
  }

  setData(orderBlocks) {
    this.orderBlocks = orderBlocks || [];
    this.requestUpdate?.();
  }

  setOptions(options) {
    this.options = { ...this.options, ...options };
    this.requestUpdate?.();
  }

  setVisible(visible) {
    this.visible = !!visible;
    this.requestUpdate?.();
  }
}

class Stat3AnalysisRenderer {
  constructor(view) {
    this.view = view;
  }

  draw(target) {
    if (!this.view.rectangles.length && !this.view.structureLines.length) return;
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      ctx.save();

      this.view.rectangles.forEach((item) => {
        const x1 = Math.round(item.x1 * hr);
        const x2 = item.x2 == null ? scope.bitmapSize.width : Math.round(item.x2 * hr);
        const top = Math.round(Math.min(item.y1, item.y2) * vr);
        const bottom = Math.round(Math.max(item.y1, item.y2) * vr);
        if (x2 <= x1 || bottom <= top) return;
        ctx.fillStyle = item.fill;
        ctx.fillRect(x1, top, x2 - x1, bottom - top);
        ctx.strokeStyle = item.stroke;
        ctx.lineWidth = Math.max(1, hr);
        ctx.setLineDash(item.dashed ? [4 * hr, 3 * hr] : []);
        ctx.strokeRect(x1 + .5, top + .5, Math.max(0, x2 - x1 - 1), Math.max(0, bottom - top - 1));
        if (item.midpoint) {
          ctx.globalAlpha = .55;
          ctx.setLineDash([3 * hr, 3 * hr]);
          ctx.beginPath();
          ctx.moveTo(x1, Math.round((top + bottom) / 2));
          ctx.lineTo(x2, Math.round((top + bottom) / 2));
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        if (item.label && x2 - x1 > 54 * hr && bottom - top > 12 * vr) {
          ctx.font = `${Math.round(9 * vr)}px Outfit, sans-serif`;
          ctx.fillStyle = item.text;
          ctx.textBaseline = "middle";
          ctx.fillText(item.label, x1 + 5 * hr, top + 7 * vr);
        }
      });

      this.view.structureLines.forEach((item) => {
        const x1 = Math.round(item.x1 * hr);
        const x2 = Math.round(item.x2 * hr);
        const y = Math.round(item.y * vr);
        ctx.strokeStyle = item.color;
        ctx.lineWidth = Math.max(1, 1.25 * hr);
        ctx.setLineDash(item.status === "rejected"
          ? [1 * hr, 5 * hr]
          : item.type === "CHOCH" ? [7 * hr, 3 * hr] : [3 * hr, 3 * hr]);
        ctx.beginPath();
        ctx.moveTo(x1, y);
        ctx.lineTo(x2, y);
        ctx.stroke();
        if (Math.abs(x2 - x1) > 34 * hr) {
          const label = item.status === "rejected"
            ? `RAW × ${item.direction === "bullish" ? "↑" : "↓"}`
            : `${item.type} ✓${item.evidenceScore ? ` ${item.evidenceScore.toFixed(1)}` : ""}${item.confirmedIndex > item.breakIndex ? ` +${item.confirmedIndex - item.breakIndex}` : ""} ${item.direction === "bullish" ? "↑" : "↓"}`;
          ctx.font = `600 ${Math.round(10 * vr)}px Outfit, sans-serif`;
          const width = ctx.measureText(label).width;
          const labelX = Math.round((x1 + x2 - width) / 2);
          ctx.fillStyle = "rgba(8,8,16,.86)";
          ctx.fillRect(labelX - 3 * hr, y - 8 * vr, width + 6 * hr, 14 * vr);
          ctx.fillStyle = item.color;
          ctx.textBaseline = "middle";
          ctx.fillText(label, labelX, y - vr);
        }
      });
      ctx.restore();
    });
  }
}

class Stat3AnalysisPaneView {
  constructor(source) {
    this.source = source;
    this.rectangles = [];
    this.structureLines = [];
    this.rendererImpl = new Stat3AnalysisRenderer(this);
  }

  update() {
    const source = this.source;
    const range = source.chart?.timeScale().getVisibleLogicalRange();
    if (!range) {
      this.rectangles = [];
      this.structureLines = [];
      return;
    }
    const from = Math.floor(range.from) - 2;
    const to = Math.ceil(range.to) + 2;
    const timeScale = source.chart.timeScale();
    const priceCoordinate = (price) => source.series.priceToCoordinate(price);
    const rectangles = [];

    const addVsr = (zones, config, label) => {
      if (!config.enabled) return;
      zones.filter((zone) => zone.startIndex <= to && zone.endIndex >= from).forEach((zone) => {
        const x1 = timeScale.logicalToCoordinate(Math.max(zone.startIndex, from));
        const x2 = timeScale.logicalToCoordinate(Math.min(zone.endIndex, to));
        const y1 = priceCoordinate(zone.upper);
        const y2 = priceCoordinate(zone.lower);
        if ([x1, x2, y1, y2].some((value) => value == null)) return;
        rectangles.push({
          x1, x2, y1, y2,
          fill: stat3HexToRgba(config.color, config.fillOpacity),
          stroke: stat3HexToRgba(config.color, .45),
          text: stat3HexToRgba(config.color, .9),
          label: zone.startIndex >= from ? label : null,
          midpoint: false,
          dashed: false,
        });
      });
    };
    addVsr(source.data.vsr1Zones, source.options.vsr1, "VSR1");
    addVsr(source.data.vsr2Zones, source.options.vsr2, "VSR2");

    if (source.options.fvg.enabled) {
      source.data.fvgs
        .filter((gap) => source.options.fvg.showHistorical || !["filled", "expired"].includes(gap.status))
        .filter((gap) => gap.originIndex <= to && (gap.endIndex == null || gap.endIndex >= from))
        .forEach((gap) => {
          const x1 = timeScale.logicalToCoordinate(Math.max(gap.originIndex, from));
          const x2 = gap.endIndex == null ? null : timeScale.logicalToCoordinate(Math.min(gap.endIndex, to));
          const y1 = priceCoordinate(gap.high);
          const y2 = priceCoordinate(gap.low);
          if ([x1, y1, y2].some((value) => value == null)) return;
          const color = gap.direction === "bullish" ? source.options.fvg.bullishColor : source.options.fvg.bearishColor;
          const alpha = { active: .13, touched: .10, mitigated: .075, filled: .035, expired: .025 }[gap.status] || .06;
          rectangles.push({
            x1, x2, y1, y2,
            fill: stat3HexToRgba(color, alpha),
            stroke: stat3HexToRgba(color, ["filled", "expired"].includes(gap.status) ? .28 : .72),
            text: stat3HexToRgba(color, .92),
            label: `${gap.direction === "bullish" ? "BULL" : "BEAR"} FVG`,
            midpoint: true,
            dashed: ["filled", "expired"].includes(gap.status),
          });
        });
    }
    this.rectangles = rectangles;

    this.structureLines = source.options.marketStructure.enabled
      ? source.data.structures
        .filter((event) => event.swingIndex <= to && event.breakIndex >= from)
        .map((event) => {
          const x1 = timeScale.logicalToCoordinate(Math.max(event.swingIndex, from));
          const x2 = timeScale.logicalToCoordinate(Math.min(event.breakIndex, to));
          const y = priceCoordinate(event.price);
          if ([x1, x2, y].some((value) => value == null)) return null;
          const color = event.status === "rejected"
            ? (source.options.marketStructure.neutralColor || "#6F7787")
            : event.direction === "bullish"
              ? source.options.marketStructure.bullishColor
              : source.options.marketStructure.bearishColor;
          return { ...event, x1, x2, y, color };
        })
        .filter(Boolean)
      : [];
  }

  renderer() { return this.rendererImpl; }
  zOrder() { return "normal"; }
}

class Stat3AnalysisPrimitive {
  constructor(options) {
    this.options = options;
    this.data = { fvgs: [], structures: [], vsr1Zones: [], vsr2Zones: [] };
    this.paneView = new Stat3AnalysisPaneView(this);
  }
  attached({ chart, series, requestUpdate }) {
    this.chart = chart; this.series = series; this.requestUpdate = requestUpdate;
  }
  detached() { this.chart = null; this.series = null; this.requestUpdate = null; }
  paneViews() { return [this.paneView]; }
  updateAllViews() { this.paneView.update(); }
  setData(data) { this.data = { ...this.data, ...data }; this.requestUpdate?.(); }
  setOptions(options) { this.options = options; this.requestUpdate?.(); }
}

function getStat3PriceFormat(price) {
  const absolute = Math.abs(Number(price) || 0);
  const precision = absolute >= 1000 ? 2 : absolute >= 10 ? 3 : absolute >= 1 ? 4 : absolute >= 0.1 ? 5 : 6;
  return { type: "price", precision, minMove: 10 ** -precision };
}

function initStat3Chart() {
  const container = document.getElementById("stat2-chart-container");
  stat3Chart = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: container.clientHeight,
    layout: {
      background: { type: "solid", color: STAT3_CFG.chart.bgColor },
      textColor: "#9aa0ad",
      fontFamily: "Outfit, sans-serif",
    },
    grid: {
      vertLines: { color: STAT3_CFG.chart.showGrid ? STAT3_CFG.chart.gridColor : "transparent" },
      horzLines: { color: STAT3_CFG.chart.showGrid ? STAT3_CFG.chart.gridColor : "transparent" },
    },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    rightPriceScale: { borderColor: "#222633", scaleMargins: { top: 0.06, bottom: 0.05 } },
    timeScale: { borderColor: "#222633", timeVisible: true, secondsVisible: false, rightOffset: 8 },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
    handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
  });

  stat3CandleSeries = stat3Chart.addSeries(LightweightCharts.CandlestickSeries, {
    upColor: STAT3_CFG.chart.upColor,
    downColor: STAT3_CFG.chart.downColor,
    wickUpColor: STAT3_CFG.chart.upColor,
    wickDownColor: STAT3_CFG.chart.downColor,
    borderVisible: false,
    priceLineVisible: true,
    lastValueVisible: true,
  });

  stat3OrderBlockPrimitive = new Stat3OrderBlockPrimitive({
    ...STAT3_CFG.orderBlock,
  });
  stat3CandleSeries.attachPrimitive(stat3OrderBlockPrimitive);

  stat3AnalysisPrimitive = new Stat3AnalysisPrimitive({
    fvg: { ...STAT3_CFG.fvg },
    marketStructure: { ...STAT3_CFG.marketStructure },
    vsr1: { ...STAT3_CFG.vsr1 },
    vsr2: { ...STAT3_CFG.vsr2 },
  });
  stat3CandleSeries.attachPrimitive(stat3AnalysisPrimitive);

  const addAtrLine = (color, width) => stat3Chart.addSeries(LightweightCharts.LineSeries, {
    color,
    lineWidth: Math.max(1, Math.min(4, Math.round(width))),
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
  });
  stat3AtrSeries = {
    atr1T1: addAtrLine(STAT3_CFG.atr1.t1Color, STAT3_CFG.atr1.lineWidth),
    atr1T2: addAtrLine(STAT3_CFG.atr1.t2Color, STAT3_CFG.atr1.lineWidth),
    atr2T1: addAtrLine(STAT3_CFG.atr2.t1Color, STAT3_CFG.atr2.lineWidth),
    atr2T2: addAtrLine(STAT3_CFG.atr2.t2Color, STAT3_CFG.atr2.lineWidth),
  };

  const observer = new ResizeObserver(() => {
    stat3Chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
  });
  observer.observe(container);
}

function updateStat3AnalysisLayers({ bot1, bot2, vsr1, vsr2, fvgs, structures }) {
  if (!stat3AtrSeries || !stat3AnalysisPrimitive) return;
  if (stat3LastAnalysisData.bot1 !== bot1) {
    stat3AtrSeries.atr1T1.setData(bot1?.t1Data || []);
    stat3AtrSeries.atr1T2.setData(bot1?.t2Data || []);
  }
  if (stat3LastAnalysisData.bot2 !== bot2) {
    stat3AtrSeries.atr2T1.setData(bot2?.t1Data || []);
    stat3AtrSeries.atr2T2.setData(bot2?.t2Data || []);
  }
  stat3AtrSeries.atr1T1.applyOptions({ visible: !!STAT3_CFG.atr1.enabled, color: STAT3_CFG.atr1.t1Color });
  stat3AtrSeries.atr1T2.applyOptions({ visible: !!STAT3_CFG.atr1.enabled, color: STAT3_CFG.atr1.t2Color });
  stat3AtrSeries.atr2T1.applyOptions({ visible: !!STAT3_CFG.atr2.enabled, color: STAT3_CFG.atr2.t1Color });
  stat3AtrSeries.atr2T2.applyOptions({ visible: !!STAT3_CFG.atr2.enabled, color: STAT3_CFG.atr2.t2Color });
  stat3AnalysisPrimitive.setOptions({
    fvg: { ...STAT3_CFG.fvg },
    marketStructure: { ...STAT3_CFG.marketStructure },
    vsr1: { ...STAT3_CFG.vsr1 },
    vsr2: { ...STAT3_CFG.vsr2 },
  });
  if (
    stat3LastAnalysisData.fvgs !== fvgs
    || stat3LastAnalysisData.structures !== structures
    || stat3LastAnalysisData.vsr1 !== vsr1
    || stat3LastAnalysisData.vsr2 !== vsr2
  ) {
    stat3AnalysisPrimitive.setData({
      fvgs: fvgs || [],
      structures: structures || [],
      vsr1Zones: vsr1?.zones || [],
      vsr2Zones: vsr2?.zones || [],
    });
  }
  stat3LastAnalysisData = { bot1, bot2, vsr1, vsr2, fvgs, structures };
  updateStat3StructureMarkers(
    structures,
    !!STAT3_CFG.marketStructure.enabled && !!STAT3_CFG.marketStructure.confluenceMode,
    STAT3_CFG.marketStructure,
  );
}

function updateStat3StructureMarkers(events, enabled, options) {
  if (stat3StructureMarkers) {
    stat3StructureMarkers.detach?.();
    stat3StructureMarkers = null;
  }
  if (!enabled || !LightweightCharts.createSeriesMarkers) return;
  const markers = (events || [])
    .filter((event) => event.status === "confirmed")
    .map((event) => {
      const bullish = event.direction === "bullish";
      const delay = Math.max(0, (event.confirmedIndex ?? event.breakIndex) - event.breakIndex);
      return {
        time: event.breakTime,
        position: bullish ? "belowBar" : "aboveBar",
        shape: bullish ? "arrowUp" : "arrowDown",
        color: bullish ? options.bullishColor : options.bearishColor,
        text: `${event.type} ✓${delay ? ` +${delay}` : ""}`,
        size: 1.25,
      };
    })
    .sort((a, b) => Number(a.time) - Number(b.time));
  if (markers.length) stat3StructureMarkers = LightweightCharts.createSeriesMarkers(stat3CandleSeries, markers);
}

function updateStat3DebugMarkers(events, enabled) {
  if (stat3DebugMarkers) {
    stat3DebugMarkers.detach?.();
    stat3DebugMarkers = null;
  }
  if (!enabled || !events?.length || !LightweightCharts.createSeriesMarkers) return;

  const styles = {
    "swing-high": { position: "aboveBar", shape: "arrowDown", color: "#8e99ad", text: "SH" },
    "swing-low": { position: "belowBar", shape: "arrowUp", color: "#8e99ad", text: "SL" },
    sweep: { position: null, shape: "circle", color: "#ffd54f", text: "SWP" },
    "displacement-start": { position: null, shape: "square", color: "#40c4ff", text: "DS" },
    "displacement-end": { position: null, shape: "square", color: "#00b0ff", text: "DE" },
    "structure-break": { position: null, shape: "circle", color: "#e040fb", text: "BOS" },
    anchor: { position: null, shape: "square", color: "#69f0ae", text: "OB" },
  };
  const markers = events
    .map((event) => {
      const style = styles[event.type];
      if (!style) return null;
      return {
        time: event.time,
        position: style.position || (event.direction === "bullish" ? "belowBar" : "aboveBar"),
        shape: style.shape,
        color: style.color,
        text: style.text,
        size: event.type.startsWith("swing") ? 0.7 : 0.9,
      };
    })
    .filter(Boolean)
    .sort((a, b) => Number(a.time) - Number(b.time));
  stat3DebugMarkers = LightweightCharts.createSeriesMarkers(stat3CandleSeries, markers);
}
