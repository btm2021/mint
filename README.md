# Smart Money Concepts (SMC) Binance Futures Visualizer

Hệ thống tải dữ liệu Binance Futures, tự động tính toán toàn bộ chỉ báo Smart Money Concepts (SMC) bằng thư viện Python `joshyattridge/smart-money-concepts`, lưu trữ CSV và hiển thị biểu đồ tương tác qua **TradingView Lightweight Charts**.

---

## 📁 Cấu trúc thư mục

```
testforexflow/
│
├── smart_money_concepts/       # Thư viện gốc được clone từ github joshyattridge/smart-money-concepts
├── config.json                 # Danh sách các dataset đã tải về (symbol, tf, candles, date)
├── main.py                     # Script tải nến Binance Futures, tính toán SMC, cập nhật config.json
├── run.py                      # Alias chạy script nhanh (python run.py ...)
│
├── data_raw/                   # Thư mục chứa dữ liệu thô (OHLCV) tải từ Binance Futures
│   ├── BTCUSDT_15m.csv
│   ├── ETHUSDT_15m.csv
│   └── ...
│
├── data_analize/               # Thư mục chứa dữ liệu đã tính toán SMC (CSV)
│   ├── BTCUSDT_15m.csv
│   ├── ETHUSDT_15m.csv
│   └── manifest.json
│
├── smc.js                      # JavaScript Engine port 1:1 thuật toán SMC (FVG)
├── index.html                  # Giao diện tổng hợp hiển thị toàn bộ chỉ báo SMC
├── stat2.html                  # Giao diện chuyên sâu phân tích FVG 100% Pure JavaScript (không qua Python)
├── stat2.js                    # Logic tính toán & thống kê FVG trực tiếp trên trình duyệt
├── stat2.css                   # Giao diện Dark Theme cho stat2
├── style.css                   # Giao diện Dark Theme cho index.html
└── libs/                       # Bản offline của Lightweight Charts & PapaParse
```

---

## ⚡ Giao diện Pure JavaScript FVG (`stat2.html`)

File [`stat2.html`](file:///c:/Users/Admin/Desktop/testforexflow/stat2.html) hoạt động **hoàn toàn trên trình duyệt** bằng `smc.js`, không cần chạy qua bất kỳ script Python nào:
- **Tùy chọn nguồn dữ liệu**:
  1. Đọc trực tiếp các file thô `data_raw/*.csv`.
  2. Hoặc **Fetch Live trực tiếp từ Binance Futures API** ngay trên Web cho bất kỳ Symbol nào (BTC, ETH, SOL, XRP, DOGE,...) và timeframe nào.
  3. Hoặc Upload file CSV từ máy tính.
- **Tính toán FVG tức thì**: Gọi hàm `SMC.fvg()` trong `smc.js` tính toán 20.000 nến chỉ trong 15ms.
- **Bảng thống kê FVG Dashboard**:
  - Tổng số FVG, Tỷ lệ Mitigate (%), Số FVG Bullish / Bearish / Active.
  - Số nến trung bình để Mitigate (`Avg Bars to Mitigate`), Kích thước Gap trung bình (`Avg Gap Size %`).
  - Thanh trượt lọc khoảng cách tối thiểu (`Min Gap Size %`), lọc `Unmitigated Only`, `Merge Consecutive`.
- **Bảng danh sách FVG tương tác**: Cho phép click vào bất kỳ FVG nào trong danh sách để biểu đồ tự động cuộn và phóng to đến đúng cây nến đó.

---

## 🚀 Hướng dẫn sử dụng

### 1. Tải và tính toán dữ liệu SMC qua Python CLI

Cú pháp lệnh:
```bash
python main.py <symbol> <timeframe> <limit>
```

**Ví dụ:**
- Tải 20.000 nến BTCUSDT khung 15 phút (mặc định):
  ```bash
  python main.py BTCUSDT 15m 20000
  ```
- Tải 5.000 nến ETHUSDT khung 1h:
  ```bash
  python main.py ETHUSDT 1h 5000
  ```
- Tải 10.000 nến SOLUSDT khung 5m:
  ```bash
  python main.py SOLUSDT 5m 10000
  ```

> Script sẽ tự động:
> 1. Tải nến từ Binance Futures với cơ chế phân trang ngược thời gian.
> 2. Lưu file gốc vào `data_raw/<symbol>_<timeframe>.csv`.
> 3. Tính toán toàn bộ các thành phần SMC bằng thư viện Python.
> 4. Xuất file kết quả vào `data_analize/<symbol>_<timeframe>.csv`.

---

### 2. Mở giao diện biểu đồ HTML qua Live Server

1. Cài đặt extension **Live Server** trên VS Code (hoặc chạy lệnh `npx live-server` trong thư mục này).
2. Chuột phải vào file `index.html` chọn **Open with Live Server**.
3. Biểu đồ sẽ tự động load file `data_analize/BTCUSDT_15m.csv`.
4. Bạn có thể chọn cặp coin / timeframe khác trên thanh công cụ và nhấn **Load Data** hoặc bấm **Select CSV** để duyệt file tùy ý.

---

## 📊 Các thành phần Smart Money Concepts được hiển thị

| Thành phần SMC | Mô tả & Cách hiển thị |
| :--- | :--- |
| **Fair Value Gaps (FVG)** | Vùng mất cân bằng giá (Imbalance), hiển thị dạng hộp bán trong suốt màu Xanh (Bullish) và Đỏ (Bearish) kéo dài từ nến xuất hiện đến nến Mitigated. |
| **Order Blocks (OB)** | Vùng gom lệnh tổ chức, hiển thị dạng hộp màu Xanh lam / Tím kèm phần trăm sức mạnh volume. |
| **Market Structure (BOS & CHoCH)** | Đường đứt nét Break of Structure (BOS) và Change of Character (CHoCH) kèm huy hiệu phân loại. |
| **Swing Highs & Lows (SH / SL)** | Điểm đỉnh/đáy đảo chiều kèm mức giá (▲ SH / ▼ SL). |
| **Liquidity Pools** | Vùng thanh khoản ngang (Equal Highs / Lows) và đánh dấu khi thanh khoản bị quét (`$$$ SWEPT`). |
| **Previous Day High / Low (PDH / PDL)** | Các mức đỉnh và đáy ngày hôm trước. |
| **Volume Sub-Pane** | Thanh khối lượng mua/bán ở khung dưới biểu đồ. |

---

## 🛠️ Tùy chỉnh & Tắt mở trên giao diện

- Mỗi chỉ báo đều có công tắc **Bật / Tắt riêng biệt**.
- Có bộ lọc chuyên sâu (VD: Chỉ xem FVG / Order Blocks chưa bị mitigate - *Unmitigated Only*).
- Nút **Enable All** / **Disable All** để chuyển đổi nhanh toàn bộ chỉ báo.
