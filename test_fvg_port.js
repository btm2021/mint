const fs = require('fs');
const path = require('path');
const SMC = require('./smc.js');

// Parse CSV manually or simply
function runVerification(csvFilename) {
  console.log(`\n========================================`);
  console.log(`Testing FVG Port on: ${csvFilename}`);
  console.log(`========================================`);

  const filepath = path.join(__dirname, 'data_analize', csvFilename);
  if (!fs.existsSync(filepath)) {
    console.error(`File not found: ${filepath}`);
    return false;
  }

  const content = fs.readFileSync(filepath, 'utf8').trim();
  const lines = content.split('\n');
  const headers = lines[0].trim().split(',');

  const idxOpen = headers.indexOf('open');
  const idxHigh = headers.indexOf('high');
  const idxLow = headers.indexOf('low');
  const idxClose = headers.indexOf('close');

  const idxPyFVG = headers.indexOf('fvg');
  const idxPyTop = headers.indexOf('fvg_top');
  const idxPyBtm = headers.indexOf('fvg_bottom');
  const idxPyMit = headers.indexOf('fvg_mitigated_index');

  const ohlc = [];
  const pythonResults = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(',');

    ohlc.push({
      open: parseFloat(parts[idxOpen]),
      high: parseFloat(parts[idxHigh]),
      low: parseFloat(parts[idxLow]),
      close: parseFloat(parts[idxClose])
    });

    const pyFVG = parts[idxPyFVG] !== '' && !isNaN(parts[idxPyFVG]) ? parseFloat(parts[idxPyFVG]) : null;
    const pyTop = parts[idxPyTop] !== '' && !isNaN(parts[idxPyTop]) ? parseFloat(parts[idxPyTop]) : null;
    const pyBtm = parts[idxPyBtm] !== '' && !isNaN(parts[idxPyBtm]) ? parseFloat(parts[idxPyBtm]) : null;
    const pyMit = parts[idxPyMit] !== '' && !isNaN(parts[idxPyMit]) ? parseFloat(parts[idxPyMit]) : null;

    pythonResults.push({
      fvg: pyFVG,
      top: pyTop,
      bottom: pyBtm,
      mitigatedIndex: pyMit
    });
  }

  console.log(`Loaded ${ohlc.length} candles. Running JS SMC.fvg()...`);
  const t0 = Date.now();
  const jsResults = SMC.fvg(ohlc, false);
  const duration = Date.now() - t0;
  console.log(`JS Calculation finished in ${duration}ms (${(ohlc.length / (duration || 1)).toFixed(0)} candles/ms)`);

  let mismatches = 0;
  let totalFVGs = 0;

  for (let i = 0; i < ohlc.length; i++) {
    const py = pythonResults[i];
    const js = jsResults[i];

    if (py.fvg !== null || js.fvg !== null) {
      totalFVGs++;

      // Check fvg direction match
      if (py.fvg !== js.fvg) {
        console.error(`[Mismatch at candle ${i}] FVG: Python=${py.fvg}, JS=${js.fvg}`);
        mismatches++;
        continue;
      }

      // Check Top
      if (Math.abs((py.top || 0) - (js.top || 0)) > 1e-5) {
        console.error(`[Mismatch at candle ${i}] Top: Python=${py.top}, JS=${js.top}`);
        mismatches++;
        continue;
      }

      // Check Bottom
      if (Math.abs((py.bottom || 0) - (js.bottom || 0)) > 1e-5) {
        console.error(`[Mismatch at candle ${i}] Bottom: Python=${py.bottom}, JS=${js.bottom}`);
        mismatches++;
        continue;
      }

      // Check MitigatedIndex
      if (py.mitigatedIndex !== js.mitigatedIndex) {
        console.error(`[Mismatch at candle ${i}] MitigatedIndex: Python=${py.mitigatedIndex}, JS=${js.mitigatedIndex}`);
        mismatches++;
        continue;
      }
    }
  }

  if (mismatches === 0) {
    console.log(`[PASS] 100% Exact Match with Python script! Total ${totalFVGs} FVGs checked across ${ohlc.length} candles.`);
    return true;
  } else {
    console.error(`[FAIL] Found ${mismatches} mismatches.`);
    return false;
  }
}

const files = ['BTCUSDT_15m.csv', 'ETHUSDT_15m.csv', 'SOLUSDT_15m.csv', 'DOGEUSDT_15m.csv'];
let allPassed = true;
for (const f of files) {
  const ok = runVerification(f);
  if (!ok) allPassed = false;
}

if (allPassed) {
  console.log(`\n🎉 ALL DATASETS MATCH PYTHON RESULTS EXACTLY (100.000% ACCURACY)!`);
} else {
  process.exit(1);
}
