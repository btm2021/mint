# CHIẾN LƯỢC VBT (VSR-Bias Trend) — Tài liệu chính thức

> Trạng thái: **ĐÃ XÁC MINH (backtest + out-of-sample)** — cập nhật 2026-08-08
> Dữ liệu: Binance Futures, 21 symbol, nến 15m, 5.7 năm (2020-11 → 2026-08), ~4 triệu nến.
> Nguồn code: `research-vsr/` — script chính: `backtest_final.js` (bản tham chiếu chuẩn).

---

## 1. TÓM TẮT CHIẾN LƯỢC

VBT là hệ thống **giao dịch theo xu hướng có lọc**, kết hợp 2 chu kỳ ATRBot + vùng VSR:

- **ATRBOT chậm (20, 3, 30, VIDYA)** → **BIAS**: chỉ giao dịch khi trend lớn đồng thuận hướng lệnh.
- **ATRBOT nhanh (14, 2, 14, VIDYA)** → **TIMING**: xác định điểm đảo trend ngắn hạn.
- **VSR (10, 10)** → **XÁC NHẬN**: chỉ vào lệnh khi giá cắt zone VSR cùng hướng trend (xuôi-confirm).
- **EMA20** → **GIÁ VÀO**: chờ giá hồi chạm EMA20 để vào lệnh với giá tốt.
- **TP 2% / SL 2%** → quản lý rủi ro cố định 1:1, kết hợp time-stop.

**Kết quả chính (5.7 năm, 21 symbol, sau phí + slippage 0.14%/lệnh):**
| Chỉ số | Giá trị |
|---|---|
| Tỷ lệ thắng | **70.1%** |
| Expectancy | **+0.36R** / lệnh (+0.72%) |
| Profit factor | **2.27** |
| Max Drawdown (tuần tự) | 15.2% (Monte Carlo: median 7.3%, P95 9.8%) |
| Out-of-sample 2025–2026 | **WIN 68.5% | +0.34R | PF 2.15** |
| Số lệnh | 2.673 (≈469 lệnh/năm, ~127 lệnh/symbol) |
| Chuỗi thua dài nhất | 9 lệnh |

---

## 2. THÔNG SỐ ĐẦY ĐỦ (SPEC — bản tham chiếu chuẩn)

### 2.1. Chỉ báo

| Thành phần | Thông số | Vai trò |
|---|---|---|
| ATRBot BIAS (chậm) | ATR Length **20**, Multiplier **3**, MA Length **30**, MA Type **VIDYA**, Source **close** | Lọc hướng lớn — chỉ LONG khi state = +1, SHORT khi state = -1 |
| ATRBot ENTRY (nhanh) | ATR Length **14**, Multiplier **2**, MA Length **14**, MA Type **VIDYA**, Source **close** | Điểm đảo trend ngắn hạn — tín hiệu ở nến flip state |
| VSR | Length **10**, Threshold **10** | Vùng giá sau volume spike — dùng để xác nhận hướng |
| EMA | **20** (close) | Điểm hồi để vào lệnh |
| (tham chiếu) VWAP phiên | reset theo ngày UTC | Không bắt buộc trong VBT, dùng để xác nhận phụ |

### 2.2. Điều kiện ENTRY (đủ TẤT CẢ — long làm ví dụ, short ngược lại)

1. **BIAS**: state ATRBot chậm tại nến entry = +1 (uptrend lớn).
2. **TIMING**: ATRBot nhanh vừa flip sang +1 (bắt đầu cycle uptrend mới).
3. **XÁC NHẬN (VSR xuôi-confirm)**: trong **8 nến** đầu cycle, có nến i mà:
   `close[i] > upper[i]` (giá đóng cắt zone VSR cùng hướng) **VÀ** `close[i] > EMA20[i]`.
4. **GIÁ VÀO (EMA pullback)**: trong **16 nến** sau nến confirm, nến đầu tiên có `low ≤ EMA20`
   → vào lệnh **market tại close nến đó** (nếu không có pullback, vào tại close nến confirm).
5. **BỘ LỌC CHẤT LƯỢNG (3 lệnh cấm — phát hiện từ tối ưu lệnh sai):**
   - ❌ **CẤM vào trễ**: tuổi fast cycle tại entry phải **≤ 4 nến** (flip→confirm→pull xảy ra nhanh).
   - ❌ **CẤM vào tại biên zone**: khoảng cách entry đến biên zone (tính theo ATR nhanh)
     không được nằm trong khoảng (-0.5, 0] — tức **không vào khi giá đang chạm/trong zone**.
   - ❌ **CẤM hồi sâu**: độ sâu pullback `(EMA20 − giá vào)/ATR` phải **≤ 0.5** (hồi nông).

### 2.3. Điều kiện EXIT

| Ưu tiên | Điều kiện | Thoát tại |
|---|---|---|
| 1 | SL: giá chạm `entry × (1 − 2%)` (long) | giá SL (nếu cùng nến chạm cả TP và SL → ưu tiên SL) |
| 2 | TP: giá chạm `entry × (1 + 2%)` (long) | giá TP |
| 3 | **Time-stop**: state ATRBot nhanh đảo (kết thúc cycle) | close nến đảo |

### 2.4. Chi phí & Vốn

- Phí taker 0.05% × 2 + slippage 0.02% × 2 = **0.14%/lệnh khứ hồi** (đã tính trong kết quả).
- Khuyến nghị **risk 0.5–1% equity/lệnh** (Kelly tối ưu 0.39 → dùng ½ Kelly ≈ 0.20).
- **⚠️ VỐN THỰC TẾ**: 21 symbol có lúc **10 vị thế mở đồng thời** → nếu risk 1%/lệnh cần
  ≥ 500% equity. Khi mở rộng nhiều symbol phải **giới hạn vị thế đồng thời** (N = 5–20).

---

## 3. KẾT QUẢ NGHIÊN CỨU ĐẦY ĐỦ (đến hiện tại)

### 3.1. Chuỗi phát triển (vì sao có VBT)

| Giai đoạn | Phát hiện | Kết luận |
|---|---|---|
| Retest zone | Zone giữ ~2/3 ở *từng lần chạm*, nhưng **72–82% zone bị xuyên trong cả đời** | Zone không phải "vùng giữ vĩnh viễn" — thông tin nằm ở hướng cắt |
| Xuyên + ATRBot | **~59% cú "xuyên" là PHÁ GIẢ** (close qua zone nhưng trend không xác nhận) | "Xuyên" thật phải có ATRBot đồng thuận |
| VSR bổ trợ ATRBot | Cắt zone **xuôi trend** → ATRBot đúng (đảo 8n chỉ 0.2–0.5%); cắt **ngược** → sai (đảo 8n 11–14%, gấp 2×) | VSR = bộ LỌC, không phải tín hiệu đảo |
| Lọc entry | Có xuôi-confirm: win 37.7–38%; không: 33.5–34% (TB âm) | Chỉ trade khi có xuôi-confirm |
| Entry tối ưu | **EMA20 pullback** (win 40%, TB +0.87%) thắng mọi cách vào khác | Vào tại điểm hồi, không đuổi giá |
| 2 ATRBot + TP/SL | Slow **VIDYA** bias tốt hơn slow EMA; TP2/SL2 → win 57.1% | Hệ thống 3 lớp (bias–timing–confirm) + TP/SL cố định |
| **Tối ưu lệnh sai** | Vào trễ / hồi sâu / chạm biên zone = lệnh sai điển hình (win 44–52%) | **3 lệnh cấm** → WIN 57.1% → **70.0%** |
| **Xác minh** | Out-of-sample 2025–2026 giữ 68.5% win, PF 2.15 | **KHÔNG overfit** — chiến lược bền vững |

### 3.2. Kết quả backtest chuẩn (backtest_final.js — 21 symbol, 5.7 năm)

```
N = 2.673 lệnh | WIN 70.1% | Exp +0.362R | PF 2.27
AvgWin +0.93R | AvgLoss -0.95R | Kelly 0.39 (½ = 0.20)
MaxDD 15.2% (73 lệnh) | chuỗi thua dài nhất 9 | chuỗi thắng 28
Exit: TP 69.8% (+1.684R) | SL 22.8% (-635R) | Timeout 7.4% (-101R)
Lệnh/năm 469 | giữ TB 30 nến (~7.6h) | exposure 1.9%
Monte Carlo MaxDD: median 7.3% | P90 9.1% | P95 9.8% | tệ nhất 14.6%
Lợi nhuận theo năm (equity tuần tự): 2020 +20% | 2021 +366% | 2022 +366% | 2023 +310%
                                     2024 +644% | 2025 +579% | 2026 +164% (dương mọi năm)
Sharpe (tháng, ann.) 0.52 | Sortino 0.67 | Calmar 29.3
```

### 3.3. Out-of-sample (chìa khóa xác minh)

| | N | WIN | Exp | PF |
|---|---|---|---|---|
| Train (2020–2024) | 1.812 | 70.6% | +0.373R | 2.32 |
| **Test (2025–2026)** | 861 | **68.5%** | **+0.339R** | **2.15** |

Suy giảm ~2pp win / 9% expectancy → **ổn định, không overfit**.

### 3.4. Per-symbol (toàn mẫu)

Dương **21/21 symbol** (ExpR 0.21–0.45, PF 1.58–2.90, MaxDD 1.1–3.0R):
mạnh nhất IMX 0.45R / PF 2.76, ETH/DOGE 0.44R / PF 2.77, SOL 0.42R / PF 2.55;
yếu nhất TON 0.21R / PF 1.58, ARB 0.25R / PF 1.69, BNB 0.27R / PF 1.90.
Test 2025–2026: **0/21 symbol expectancy âm**.

### 3.5. Ước tính mở rộng 600 symbol

- 22.6 lệnh/symbol/năm → 600 symbol ≈ **37 lệnh/ngày** (futures USDT-M ~450 symbol → ~28/ngày;
  alt nhỏ nhiễu hơn → 35–70/ngày).
- Vị thế đồng thời TB ≈ 12, lúc cao điểm có thể 100–300 → **bắt buộc giới hạn vị thế** + giảm
  risk/lệnh xuống 0.05–0.1%.

---

## 4. TỔ CHỨC HỆ THỐNG

### 4.1. Sơ đồ xử lý (1 lệnh đi qua 5 lớp)

```
Nến 15m (OHLCV)
   │
   ▼
[1] ATRBot CHẬM (20,3,30 VIDYA) ──► BIAS: state +1/-1        (lọc hướng lớn)
   │
   ▼
[2] ATRBot NHANH (14,2,14 VIDYA) ─► TIMING: flip state        (điểm đảo)
   │
   ▼
[3] VSR(10,10) + EMA20 ───────────► XÁC NHẬN: cắt zone xuôi + close qua EMA20 trong 8n
   │
   ▼
[4] Bộ lọc chất lượng ────────────► 3 lệnh cấm: vào trễ / chạm zone / hồi sâu
   │
   ▼
[5] Quản lý lệnh ─────────────────► vào tại EMA pullback | TP 2% | SL 2% | time-stop fast flip
```

### 4.2. Phân công module (code)

| Module | File | Nhiệm vụ |
|---|---|---|
| Engine VSR | `lib/vsr.js` | Zone upper/lower, signal — khớp 100% `js/indicators.js` |
| Engine ATRBot | `lib/atrbot.js` | states + trail1/trail2 (ema/vidya) — khớp 100% |
| Indicator phụ | `lib/indicators.js` | EMA20, VWAP phiên, avgVolume |
| Dữ liệu | `lib/data.js` | Fetch klines + cache compact + rate-limit an toàn |
| **Backtest chuẩn** | `backtest_final.js` | Bản tham chiếu của chiến lược (mọi thông số khai báo đầu file `CONFIG`) |
| Tối ưu & phân tích | `optimize.js`, `system.js`, `entry.js`, `rr.js`, ... | Nghiên cứu nền (xem RESEARCH_GUIDE.md) |
| Trực quan | `pinescript/vsr_zone_classifier.pine` | Tô màu zone trên TradingView |
| Output | `output/backtest_final/` | trades.csv (2.673 lệnh), equity.csv, monthly.csv |

### 4.3. Nhân sự đề xuất (khi vận hành thực tế)

- **Nhà phân tích** — theo dõi báo cáo backtest, đánh giá drift theo thời gian (chạy lại hàng tháng).
- **Bot/Execution** — đặt lệnh theo tín hiệu; cần alert realtime (WebSocket) khi đủ điều kiện entry.
- **Quản lý rủi ro** — giới hạn vị thế đồng thời, risk/lệnh, giám sát drawdown, phí/funding.

---

## 5. CÁCH DÙNG INDICATOR (hướng dẫn đọc chart)

### 5.1. Trên TradingView (app mint hoặc PineScript)

| Indicator | Nhìn gì | Diễn giải |
|---|---|---|
| **ATRBOT chậm (20,3,30 VIDYA)** | Trail 1 (xanh ngọc) trên Trail 2 (đỏ) → vùng xanh | **BIAS LONG** — chỉ nghĩ đến lệnh long |
| | Trail 1 dưới Trail 2 → vùng đỏ | **BIAS SHORT** |
| **ATRBOT nhanh (14,2,14 VIDYA)** | Vùng xanh ↔ đỏ đổi màu | **TIMING**: điểm đảo ngắn hạn |
| **Zone VSR (vàng)** | Giá đóng CẮT zone **cùng hướng** trend + đóng trên/dưới EMA20 | **XÁC NHẬN xuôi** — điều kiện entry |
| **EMA20 (cam)** | Giá hồi chạm EMA20 | **ĐIỂM VÀO** (mua pullback trong uptrend) |
| VWAP phiên (cyan) | Tham chiếu phụ | Xác nhận xuôi/ngược trend |

### 5.2. Quy trình đọc tín hiệu (từng bước)

1. **Xác định bias**: ATRBot chậm đang xanh (long) hay đỏ (short)? → **không trade ngược bias**.
2. **Chờ đảo**: ATRBot nhanh vừa chuyển vùng (xanh ↔ đỏ) → bắt đầu chu kỳ mới.
3. **Chờ confirm**: trong 8 nến sau đảo, giá phải **đóng cắt zone VSR cùng hướng** và đóng qua
   EMA20. Không có confirm → **bỏ qua** (đây là nhóm lệnh lỗ −0.13 đến −0.33%).
4. **Chờ pullback**: giá hồi chạm EMA20 (nến có low chạm EMA trong uptrend) → **vào lệnh**.
5. **3 lệnh cấm kiểm tra nhanh**: cycle đã chạy >4 nến? → bỏ. Giá đang chạm/trong zone vàng? → bỏ.
   Hồi sâu hơn 0.5×ATR? → bỏ.
6. **Quản lý**: TP 2% / SL 2% đặt ngay; nếu ATRBot nhanh đảo trước khi chạm → thoát tại close.

### 5.3. Cách dùng `vsr_zone_classifier.pine`

- Dán vào Pine Editor → Add to chart. Nhập: VSR Length 10, Threshold 10 (đúng nghiên cứu).
- Màu zone: **ĐỎ** = score ≥ 4 (dự đoán giữ — ưu tiên trade bật); **XANH** = score ≤ 1 (cảnh báo
  xuyên); **VÀNG** = trung lập. Nhãn `BẬT n`/`XUYÊN n` hiện điểm score tại nến test.
- Dùng kèm 2 ATRBot (chậm/nhanh) + EMA20 để đối chiếu với quy trình ở 5.2.

### 5.4. Trên app mint (web)

- Bật: ATRBot 1 (đặt chậm: ATR 20, mult 3, MA 30, VIDYA) + ATRBot 2 (nhanh: 14/2/14/VIDYA)
  + VSR (10,10) + VWAP/EMA trong panel VSR Dual Zones (EMA 20) để có EMA20.
- Cách đọc tương tự 5.2; vùng vàng VSR + màu trail 2 ATRBot cho biết trạng thái xuôi/ngược.

---

## 6. RỦI RO & GIỚI HẠN ĐÃ BIẾT

1. **Vốn cho vị thế chồng lấp** (21 symbol → tối đa 10 vị thế cùng lúc; scale 600 symbol → 100–300)
   → bắt buộc giới hạn vị thế đồng thời + giảm risk/lệnh khi mở rộng.
2. **TP = 1R cố định**: không có lệnh thắng >1R — lợi thế hoàn toàn từ hit rate; nếu thị trường
   chuyển sang range mạnh, hit rate có thể suy giảm (đã thấy 2023 thấp hơn: win 66%).
3. **Sharpe 0.52** — lợi nhuận không đều theo tháng; dùng kích thước vị thế phù hợp để chịu được
   chuỗi 9 lệnh thua + drawdown 15%.
4. **Chưa tính funding fee** futures và slippage biến động (mới dùng 0.04% cố định).
5. **Tần suất thấp** (~1 lệnh/16 ngày/symbol) → cần nhiều symbol để có đủ lệnh; hoặc chấp nhận
   chờ đợi.
6. **Đây là nghiên cứu thống kê** — không phải lời khuyên đầu tư; test paper trước khi live.

---

## 7. NHẬT KÝ PHÁT TRIỂN

| Ngày | Sự kiện |
|---|---|
| 2026-08-08 | Hoàn tất backtest chuẩn `backtest_final.js` — xác minh OOS 68.5% win |
| 2026-08-08 | Tối ưu lệnh sai (3 lệnh cấm) — win 57.1% → 70.0% |
| 2026-08-08 | Xác lập hệ thống 2 ATRBot + VSR + TP2/SL2 (system.js) |
| 2026-08-08 | Tìm entry EMA20 pullback (entry.js) |
| 2026-08-08 | Chứng minh VSR là bộ lọc xuôi-confirm cho ATRBot (cyclevsr/atrvsr) |

---

## 8. CÁCH TÁI LẬP KẾT QUẢ

```bash
cd research-vsr
node backtest_final.js     # in toàn bộ báo cáo (mục 3.2) — chạy lại mọi lúc, dùng cache
# Đổi thông số: --riskPerTrade 2 --tpPct 3 --slPct 1.5 --symbols "BTCUSDT,ETHUSDT"
# CSV: output/backtest_final/trades.csv | equity.csv | monthly.csv
```
