// ============================================================
// db.js — QUẢN LÝ DATABASE TRÌNH DUYỆT (INDEXEDDB) CHO OHLCV
// Lưu trữ dung lượng lớn không giới hạn, không làm đơ giao diện
// ============================================================

const DB_NAME = "MintChart_OHLCV_DB";
const DB_VERSION = 1;
const DB_STORE_NAME = "candles";

let dbInstancePromise = null;

function openOHLCVDatabase() {
  if (dbInstancePromise) return dbInstancePromise;

  dbInstancePromise = new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      console.warn("IndexedDB không được hỗ trợ trên trình duyệt này. Sử dụng fallback localStorage.");
      resolve(null);
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(DB_STORE_NAME)) {
        const store = db.createObjectStore(DB_STORE_NAME, { keyPath: "key" });
        store.createIndex("source_symbol", ["sourceId", "symbol"], { unique: false });
        store.createIndex("lastUpdated", "lastUpdated", { unique: false });
      }
    };

    request.onsuccess = (event) => {
      resolve(event.target.result);
    };

    request.onerror = (event) => {
      console.error("Lỗi mở IndexedDB:", event.target.error);
      resolve(null); // Fallback
    };
  });

  return dbInstancePromise;
}

// 1. Lấy dữ liệu nến từ IndexedDB (kèm fallback localStorage)
async function getDBCachedBars(sourceId, symbol, interval) {
  const key = `${sourceId}_${symbol}_${interval}`;
  const db = await openOHLCVDatabase();

  if (db) {
    try {
      const tx = db.transaction(DB_STORE_NAME, "readonly");
      const store = tx.objectStore(DB_STORE_NAME);
      const req = store.get(key);

      const record = await new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

      if (record && Array.isArray(record.bars) && record.bars.length > 0) {
        return record.bars;
      }
    } catch (e) {
      console.warn("Lỗi đọc IndexedDB record:", e);
    }
  }

  // Fallback đọc từ localStorage nếu có
  const localKey = `${sourceId}_${symbol}_${interval}_DB_v6`;
  const cachedLocal = localStorage.getItem(localKey) || localStorage.getItem(`${symbol}_${interval}_DB_v6`);
  if (cachedLocal) {
    try {
      const parsed = JSON.parse(cachedLocal);
      if (Array.isArray(parsed) && parsed.length > 0 && Array.isArray(parsed[0])) {
        const bars = parsed.map((p) => ({
          time: p[0],
          open: p[1],
          high: p[2],
          low: p[3],
          close: p[4],
          volume: p[5],
          buyVolume: p[6] || 0,
        }));
        // Tự động migrate sang IndexedDB
        saveDBCachedBars(sourceId, symbol, interval, bars);
        return bars;
      }
    } catch (e) { }
  }

  return null;
}

// 2. Lưu nến vào IndexedDB
async function saveDBCachedBars(sourceId, symbol, interval, bars) {
  if (!bars || !bars.length) return;
  const key = `${sourceId}_${symbol}_${interval}`;
  const db = await openOHLCVDatabase();

  if (db) {
    try {
      const tx = db.transaction(DB_STORE_NAME, "readwrite");
      const store = tx.objectStore(DB_STORE_NAME);
      store.put({
        key,
        sourceId,
        symbol,
        interval,
        lastUpdated: Date.now(),
        bars,
      });
    } catch (e) {
      console.warn("Lỗi lưu vào IndexedDB:", e);
    }
  }

  // Lưu index key nhanh vào localStorage để nhận diện badge CACHED tức thì
  try {
    localStorage.setItem(`cached_tag_${sourceId}_${symbol}`, "1");
  } catch (e) { }
}

// 3. Lấy danh sách tất cả các mã đã cache
async function getDBAllCachedKeys() {
  const cachedSet = new Set();

  // Đọc từ IndexedDB
  const db = await openOHLCVDatabase();
  if (db) {
    try {
      const tx = db.transaction(DB_STORE_NAME, "readonly");
      const store = tx.objectStore(DB_STORE_NAME);
      const req = store.getAllKeys();

      const keys = await new Promise((resolve) => {
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });

      keys.forEach((k) => {
        // key format: ${sourceId}_${symbol}_${interval}
        const parts = String(k).split("_");
        if (parts.length >= 2) {
          cachedSet.add(`${parts[0]}_${parts[1]}`);
        }
      });
    } catch (e) { }
  }

  // Đọc thêm từ localStorage
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith("cached_tag_")) {
      cachedSet.add(k.replace("cached_tag_", ""));
    } else if (k && k.endsWith("_DB_v6")) {
      const parts = k.split("_");
      if (parts.length >= 2) cachedSet.add(parts[0]);
    }
  }

  return cachedSet;
}

// 4. Xóa cache cho 1 symbol hoặc toàn bộ
async function clearDBCache(key = null) {
  const db = await openOHLCVDatabase();
  if (db) {
    const tx = db.transaction(DB_STORE_NAME, "readwrite");
    const store = tx.objectStore(DB_STORE_NAME);
    if (key) {
      store.delete(key);
    } else {
      store.clear();
    }
  }
}
