import os
import sys
import time
import json
import argparse
from datetime import datetime, timezone
import requests
import pandas as pd
import numpy as np

# Hide SMC credit message if desired
os.environ["SMC_CREDIT"] = "0"
try:
    from smartmoneyconcepts import smc
except ImportError:
    # In case running from parent repo folder directly
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "smart_money_concepts"))
    from smartmoneyconcepts import smc


BINANCE_FUTURES_KLINES_URL = "https://fapi.binance.com/fapi/v1/klines"
MAX_BATCH_SIZE = 1500  # Binance Futures allows up to 1500 klines per request


def fetch_binance_futures_klines(symbol: str, interval: str, total_limit: int = 20000) -> pd.DataFrame:
    """
    Fetch historical candlestick data from Binance USDT-M Futures with backward pagination.
    """
    symbol = symbol.upper()
    print(f"\n[1/3] Fetching {total_limit} candles for {symbol} ({interval}) from Binance Futures...")
    
    all_candles = []
    end_time = None
    remaining = total_limit

    session = requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    })

    batch_num = 1
    while remaining > 0:
        fetch_limit = min(remaining, MAX_BATCH_SIZE)
        params = {
            "symbol": symbol,
            "interval": interval,
            "limit": fetch_limit
        }
        if end_time is not None:
            params["endTime"] = end_time

        try:
            resp = session.get(BINANCE_FUTURES_KLINES_URL, params=params, timeout=15)
            resp.raise_for_status()
            klines = resp.json()
        except Exception as e:
            print(f"  [!] Error fetching batch {batch_num}: {e}")
            time.sleep(1.0)
            try:
                resp = session.get(BINANCE_FUTURES_KLINES_URL, params=params, timeout=15)
                resp.raise_for_status()
                klines = resp.json()
            except Exception as e2:
                print(f"  [X] Failed retry: {e2}. Stopping pagination.")
                break

        if not klines or not isinstance(klines, list):
            print("  [!] No more candles returned by Binance.")
            break

        all_candles = klines + all_candles
        remaining -= len(klines)
        oldest_open_time = klines[0][0]
        end_time = oldest_open_time - 1

        print(f"  -> Batch {batch_num}: Fetched {len(klines)} candles (Total so far: {len(all_candles)} / {total_limit})")
        batch_num += 1

        if len(klines) < fetch_limit:
            print("  [i] Reached the oldest available data on Binance.")
            break

        time.sleep(0.15)

    if not all_candles:
        raise ValueError(f"No candlestick data could be retrieved for {symbol} on {interval}.")

    cols = [
        "open_time", "open", "high", "low", "close", "volume",
        "close_time", "quote_volume", "count", "taker_buy_volume",
        "taker_buy_quote_volume", "ignore"
    ]
    df = pd.DataFrame(all_candles, columns=cols)
    
    df.drop_duplicates(subset=["open_time"], inplace=True)
    df.sort_values(by="open_time", ascending=True, inplace=True)
    df.reset_index(drop=True, inplace=True)

    if len(df) > total_limit:
        df = df.iloc[-total_limit:].reset_index(drop=True)

    numeric_cols = ["open", "high", "low", "close", "volume", "quote_volume", "taker_buy_volume", "taker_buy_quote_volume"]
    for col in numeric_cols:
        df[col] = df[col].astype(float)
    df["open_time"] = df["open_time"].astype(int)
    df["close_time"] = df["close_time"].astype(int)

    df["datetime"] = pd.to_datetime(df["open_time"], unit="ms", utc=True).dt.strftime("%Y-%m-%d %H:%M:%S")

    print(f"  [+] Successfully collected {len(df)} candles from {df['datetime'].iloc[0]} to {df['datetime'].iloc[-1]}")
    return df


def calculate_smc(df_raw: pd.DataFrame) -> pd.DataFrame:
    """
    Run the smart-money-concepts library calculations on the OHLCV dataset.
    """
    print("\n[2/3] Calculating Smart Money Concepts indicators...")
    
    ohlc = df_raw[["open", "high", "low", "close", "volume"]].copy()
    ohlc.index = pd.to_datetime(df_raw["open_time"], unit="ms", utc=True)

    # 1. Swing Highs and Lows
    print("  -> Computing Swing Highs and Lows (swing_length=20)...")
    shl = smc.swing_highs_lows(ohlc, swing_length=20)

    # 2. Break of Structure (BOS) and Change of Character (CHoCH)
    print("  -> Computing BOS & CHoCH...")
    bos_choch = smc.bos_choch(ohlc, shl, close_break=True)

    # 3. Order Blocks (OB)
    print("  -> Computing Order Blocks (OB)...")
    ob = smc.ob(ohlc, shl, close_mitigation=False)

    # 4. Fair Value Gaps (FVG)
    print("  -> Computing Fair Value Gaps (FVG)...")
    fvg = smc.fvg(ohlc, join_consecutive=False)

    # 5. Liquidity Pools
    print("  -> Computing Liquidity pools...")
    liquidity = smc.liquidity(ohlc, shl, range_percent=0.005)

    # 6. Previous High and Low (1D timeframe)
    print("  -> Computing Previous High/Low (1D)...")
    try:
        prev_hl = smc.previous_high_low(ohlc, time_frame="1D")
    except Exception as e:
        print(f"     [!] Warning computing previous_high_low: {e}")
        prev_hl = pd.DataFrame({
            "PreviousHigh": np.nan, "PreviousLow": np.nan,
            "BrokenHigh": np.nan, "BrokenLow": np.nan
        }, index=ohlc.index)

    # 7. Retracements
    print("  -> Computing Retracements...")
    try:
        retracements = smc.retracements(ohlc, shl)
    except Exception as e:
        print(f"     [!] Warning computing retracements: {e}")
        retracements = pd.DataFrame({
            "Direction": np.nan, "CurrentRetracement%": np.nan, "DeepestRetracement%": np.nan
        }, index=ohlc.index)

    # Combine all results into final DataFrame
    df_out = pd.DataFrame()
    df_out["time"] = (df_raw["open_time"] // 1000).astype(int)
    df_out["datetime"] = df_raw["datetime"]
    df_out["open"] = df_raw["open"]
    df_out["high"] = df_raw["high"]
    df_out["low"] = df_raw["low"]
    df_out["close"] = df_raw["close"]
    df_out["volume"] = df_raw["volume"]

    # Map indicators cleanly
    shl_res = shl.reset_index(drop=True)
    df_out["shl_highlow"] = shl_res["HighLow"]
    df_out["shl_level"] = shl_res["Level"]

    bc_res = bos_choch.reset_index(drop=True)
    df_out["bos"] = bc_res["BOS"]
    df_out["choch"] = bc_res["CHOCH"]
    df_out["bos_choch_level"] = bc_res["Level"]
    df_out["bos_choch_broken_index"] = bc_res["BrokenIndex"]

    ob_res = ob.reset_index(drop=True)
    df_out["ob"] = ob_res["OB"]
    df_out["ob_top"] = ob_res["Top"]
    df_out["ob_bottom"] = ob_res["Bottom"]
    df_out["ob_volume"] = ob_res["OBVolume"]
    df_out["ob_mitigated_index"] = ob_res["MitigatedIndex"]
    df_out["ob_percentage"] = ob_res["Percentage"]

    fvg_res = fvg.reset_index(drop=True)
    df_out["fvg"] = fvg_res["FVG"]
    df_out["fvg_top"] = fvg_res["Top"]
    df_out["fvg_bottom"] = fvg_res["Bottom"]
    df_out["fvg_mitigated_index"] = fvg_res["MitigatedIndex"]

    liq_res = liquidity.reset_index(drop=True)
    df_out["liquidity"] = liq_res["Liquidity"]
    df_out["liquidity_level"] = liq_res["Level"]
    df_out["liquidity_end"] = liq_res["End"]
    df_out["liquidity_swept"] = liq_res["Swept"]

    prev_res = prev_hl.reset_index(drop=True)
    df_out["prev_high_1d"] = prev_res["PreviousHigh"]
    df_out["prev_low_1d"] = prev_res["PreviousLow"]
    df_out["broken_high_1d"] = prev_res["BrokenHigh"]
    df_out["broken_low_1d"] = prev_res["BrokenLow"]

    ret_res = retracements.reset_index(drop=True)
    df_out["retracement_direction"] = ret_res["Direction"]
    df_out["retracement_current"] = ret_res["CurrentRetracement%"]
    df_out["retracement_deepest"] = ret_res["DeepestRetracement%"]

    print("  [+] All SMC indicators calculated successfully.")
    return df_out


def update_config(base_dir: str, data_analize_dir: str, current_symbol: str, current_timeframe: str, candle_count: int, file_name: str, df_analize: pd.DataFrame = None):
    """
    Save or update config.json at project root and data_analize/manifest.json for web selection.
    """
    config_path = os.path.join(base_dir, "config.json")
    manifest_path = os.path.join(data_analize_dir, "manifest.json")

    config_data = {
        "default_symbol": current_symbol.upper(),
        "default_timeframe": current_timeframe.lower(),
        "default_file": f"data_analize/{file_name}",
        "datasets": []
    }

    if os.path.exists(config_path):
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                loaded = json.load(f)
                if isinstance(loaded, dict) and "datasets" in loaded:
                    config_data["datasets"] = loaded["datasets"]
        except Exception:
            pass

    first_time = ""
    last_time = ""
    if df_analize is not None and len(df_analize) > 0:
        if "datetime" in df_analize.columns:
            first_time = str(df_analize["datetime"].iloc[0])
            last_time = str(df_analize["datetime"].iloc[-1])

    new_entry = {
        "symbol": current_symbol.upper(),
        "timeframe": current_timeframe.lower(),
        "filename": file_name,
        "filepath": f"data_analize/{file_name}",
        "candles": int(candle_count),
        "first_time": first_time,
        "last_time": last_time,
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    }

    # Filter out if same filename already existed
    datasets = [d for d in config_data["datasets"] if d.get("filename") != file_name]
    datasets.insert(0, new_entry)

    # Also scan data_analize folder for any other csv files not in config
    if os.path.exists(data_analize_dir):
        for fname in os.listdir(data_analize_dir):
            if fname.endswith(".csv") and fname != file_name:
                if not any(d.get("filename") == fname for d in datasets):
                    parts = fname.replace(".csv", "").split("_")
                    sym = parts[0] if len(parts) > 0 else "UNKNOWN"
                    tf = parts[1] if len(parts) > 1 else ""
                    datasets.append({
                        "symbol": sym.upper(),
                        "timeframe": tf.lower(),
                        "filename": fname,
                        "filepath": f"data_analize/{fname}",
                        "candles": 0,
                        "first_time": "",
                        "last_time": "",
                        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
                    })

    config_data["datasets"] = datasets

    # Write root config.json
    with open(config_path, "w", encoding="utf-8") as f:
        json.dump(config_data, f, indent=2)

    # Write data_analize/manifest.json
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump({"files": datasets}, f, indent=2)


def main():
    parser = argparse.ArgumentParser(description="Download Binance Futures data and calculate Smart Money Concepts (SMC)")
    parser.add_argument("symbol", nargs="?", default="BTCUSDT", help="Trading pair symbol, e.g. BTCUSDT, ETHUSDT")
    parser.add_argument("timeframe", nargs="?", default="15m", help="Timeframe / Interval, e.g. 1m, 5m, 15m, 1h, 4h, 1d")
    parser.add_argument("limit", nargs="?", type=int, default=20000, help="Number of historical candles to fetch, default 20000")

    args = parser.parse_args()

    symbol = args.symbol.upper()
    timeframe = args.timeframe.lower()
    limit = args.limit

    base_dir = os.path.abspath(os.path.dirname(__file__))
    raw_dir = os.path.join(base_dir, "data_raw")
    analize_dir = os.path.join(base_dir, "data_analize")

    os.makedirs(raw_dir, exist_ok=True)
    os.makedirs(analize_dir, exist_ok=True)

    # 1. Fetch data
    df_raw = fetch_binance_futures_klines(symbol, timeframe, total_limit=limit)
    
    # Save raw CSV
    raw_filename = f"{symbol}_{timeframe}.csv"
    raw_filepath = os.path.join(raw_dir, raw_filename)
    df_raw.to_csv(raw_filepath, index=False)
    print(f"  [+] Saved raw data to: {raw_filepath}")

    # 2. Compute SMC
    df_analize = calculate_smc(df_raw)

    # Save analyzed CSV
    analize_filename = f"{symbol}_{timeframe}.csv"
    analize_filepath = os.path.join(analize_dir, analize_filename)
    df_analize.to_csv(analize_filepath, index=False)
    print(f"\n[3/3] Export completed!")
    print(f"  [+] Analyzed CSV saved to: {analize_filepath} ({len(df_analize)} rows, {len(df_analize.columns)} columns)")

    # Update config.json and manifest
    update_config(base_dir, analize_dir, symbol, timeframe, len(df_analize), analize_filename, df_analize)
    print("  [+] Updated config.json and data_analize/manifest.json")
    print("\nReady! Open index.html using live-server to view the interactive chart.")


if __name__ == "__main__":
    main()
