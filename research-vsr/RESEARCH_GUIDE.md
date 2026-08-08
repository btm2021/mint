# HƯỚNG DẪN NGHIÊN CỨU VSR — HANDBOOK CHO AGENT

> Tài liệu này ghi lại toàn bộ bối cảnh, phương pháp, kết quả và cách tiếp tục nghiên cứu.
> Mọi thông tin trong đây đã được kiểm chứng bằng dữ liệu Binance Futures thực tế
> (20 symbol, ~4 triệu nến 15m, giai đoạn 2020-11 → 2026-08).

---

## 1. BỐI CẢNH DỰ ÁN

- Dự án gốc tại `C:\Users\Admin\Desktop\mint` — web app chart với 2 indicator chính:
  **ATRBot** và **VSR (Volume Spike Reversal)**. Logic chuẩn nằm ở `js/indicators.js`
  (`calculateVSR` dòng ~423, `calculateATRBot` dòng ~1, `calculateStandardVWAP` dòng ~581).
- Nghiên cứu này nhằm trả lời câu hỏi: **khi nào giá chạy trong zone VSR, khi nào breakout,
  khi nào zone là đáy/đỉnh (giữ), khi nào bị xuyên qua — và dự đoán được bằng gì?**
- Mọi tính toán tái hiện **chính xác 100%** hàm `calculateVSR` của project
  (đã kiểm chứng bằng cách so sánh từng zone trên 4 cấu hình, khớp hoàn toàn).

## 2. CẤU TRÚC CODE (`research-vsr/`)

| File | Vai trò |
|---|---|
| `main.js` | Nghiên cứu 1 symbol đơn lẻ, báo cáo đầy đủ + CSV |
| `multi.js` | Batch nhiều symbol: breakout, chất lượng, luật R1-R8, pooled stats |
| `retest.js` | Phân tích retest: approach (hỗ trợ/kháng cự), BOUNCE/THROUGH/HELD |
| `predict20.js` | Dùng VSR(10,10) + EMA20/VWAP dự đoán VSR(20,20) (Part A: tạo zone, Part B: hành vi) |
| `zoneclass.js` | **Phân loại zone đáy/đỉnh/xuyên** bằng score 0-6, 3 config (5,10|10,10|15,10) |
| `backtest.js` | **Backtest các rule với phí 0.1%**, 2 mốc thoát (T+8, T+24), per-symbol |
| `test-replica.mjs` | Kiểm chứng engine VSR khớp với `js/indicators.js` |
| `lib/vsr.js` | Engine VSR (trả zones + upper/lower/signal từng nến) |
| `lib/atrbot.js` | Trend state ATRBot (EMA30 + ATR14×2), 1 = uptrend, -1 = downtrend |
| `lib/retest.js` | `analyseZoneTests` — vòng đời retest + thống kê (bucketTable, ruleEval, writeCsv) |
| `lib/indicators.js` | EMA(20), VWAP phiên (reset theo ngày UTC), avgVolume |
| `lib/data.js` | Fetch klines Binance Futures, **rate-limit an toàn**, cache compact |
| `pinescript/vsr_zone_classifier.pine` | PineScript v5 tô màu zone: ĐỎ = BẬT (score≥4), XANH = XUYÊN (score≤1), VÀNG = trung lập |
| `cache/*.json` | Dữ liệu đã tải (compact: `[time,open,high,low,close,volume]`) |
| `output/` | `zones_*`, `multi/`, `retest/`, `predict20/`, `zoneclass/`, `backtest/` |

## 3. CÁCH CHẠY (đều dùng cache, không tốn request nếu dữ liệu đủ)

```bash
cd research-vsr
node main.js                                     # 1 symbol sâu (mặc định IMXUSDT 15m 50k nến)
node multi.js                                    # 10 symbol 200k nến, breakout + luật
node retest.js                                   # retest zone 10 symbol
node predict20.js                                # VSR10 → dự đoán VSR20
node zoneclass.js                                # 3 config + score 0-6 (mặc định 20 symbol)
node zoneclass.js --configs "5,10|10,10|15,10|20,20"   # đổi config
node backtest.js                                 # backtest rule với phí
```

Tham số: `--symbols "BTCUSDT,ETHUSDT" --interval 15m --bars 200000 --configs "5,10|10,10"`.
Rate limit: delay 450ms/request + backoff 429/418 tự động (không cần can thiệp).

## 4. ĐỊNH NGHĨA CHÍNH XÁC (phải giữ nguyên khi mở rộng)

**VSR** (mỗi nến t):
- `change = V_t/V_(t-1) - 1` (0 nếu volume trước = 0)
- `stdev` = population stdev của change trong cửa sổ Length (gồm nến hiện tại)
- `signal = |change / stdev_(t-1)|` — dùng stdev của NẾN TRƯỚC
- `signal > Threshold` → tạo/gộp zone từ nến t-1: `upper=max(H,C)`, `lower=min(L,C)`
- Gộp nếu overlap `[pLo,pUp]` với `[lower,upper]`; thay thế nếu không; chỉ 1 zone hoạt động

**Retest (trong `analyseZoneTests`, K=8/24 nến):**
- `touch` = nến đầu tiên overlap zone mà close nến trước nằm NGOÀI zone
- `approach` = ABOVE (giá từ trên xuống → zone = HỖ TRỢ/đáy) hoặc BELOW (→ KHÁNG CỰ/đỉnh)
- `BOUNCE` = close văng lại phía tiếp cận trong K nến | `THROUGH` = close xuyên qua zone
- `HELD` = chưa rõ trong K | `NO_TEST` = zone tồn tại trọn đời mà giá không chạm lại
- QUAN TRỌNG: mọi zone kết thúc đều có giá nằm ngoài (tính chất cấu trúc của VSR — zone mới
  luôn quanh nến trước nên không thể thay zone khi giá còn trong zone cũ) → NONE ≈ 0%.

**Score 0-6 (điều kiện thuận lợi cho zone GIỮ, +1 mỗi điều kiện):**
1. Xuôi EMA20: approach ABOVE và close > EMA20 (hoặc BELOW và close < EMA20)
2. Xuôi VWAP phiên (cùng logic)
3. Volume nến test ≤ 1× trung bình 20 nến TRƯỚC
4. Tuổi zone > 12 nến (tính từ `startIndex` hiện tại — lưu ý merge cũng reset startIndex)
5. Độ rộng zone > 0.7% giá
6. Zone đã gộp ≥ 1 lần (mergeCnt)

## 5. KẾT QUẢ ĐÃ KIỂM CHỨNG (tóm tắt — dùng để đối chiếu khi tái lập)

### 5.1. Giá vs zone (7.883 điểm quyết định, 10 symbol, VSR 10,10)
- Nến đóng trong zone chỉ 5-7% thời gian; zone rộng TB 0.4-0.5% giá.
- Vị trí close trong zone là tín hiệu mạnh nhất cho HƯỚNG breakout:
  đáy 1/3 zone → DOWN 74.3% | giữa → UP 72.9% | đỉnh 1/3 → coinflip.
- UP breakout quay lại zone 96-99% (phá giả); DOWN mạnh hơn ~1.7× (ext -1.2 đến -2.9%).

### 5.2. Retest — đáy/đỉnh/xuyên (8.822 test VSR 10,10; 1.104 test VSR 20,20)
- Vai trò cơ học: spike tạo zone đi LÊN → zone sẽ là ĐÁY; spike đi XUỐNG → ĐỈNH (100%).
- Base rate: BOUNCE 66-69%, THROUGH 31-33% — gần như KHÔNG đổi theo config (5,10|10,10|15,10).
- Feature mạnh nhất: EMA20 alignment (xuôi → giữ 75-78% vs ngược → xuyên 38-40%),
  VWAP alignment, volume test (≤1× → 70-74% giữ; >2× → xuyên 40-44%),
  zone rộng/gộp → giữ tốt hơn 3-8pp.

### 5.3. VSR10 → dự đoán VSR20 (456k mẫu)
- KHÔNG dự đoán được việc TẠO zone VSR20 (base 1.8%, mọi feature lift ≤1.16×).
- Confluence VSR10 vô nghĩa (zone VSR10 luôn tồn tại ~100% thời gian, 100% trùng).

### 5.4. Backtest rule (20 symbol × 3 config, phí 0.1%, thoát T+8 / T+24)
- Độ chính xác HƯỚNG: BASE 67% | R1 (xuôi EMA) 75.6-77.5% | R3 (score≥3) 76-78%
  | **R3b (score≥4) 79.8-80.1%** (hit24: 81.6-82.2%).
- Dự đoán XUYÊN KHÔNG đáng tin: R4 (ngược EMA + vol>2×) chỉ 47-53%; score≤1 chỉ 43-46%.
- **PnL naive LUÔN ÂM sau phí** (win 41-45%, TB -0.07 đến -0.17%/lệnh) → đúng hướng ≠ đủ xa
  để lời. Cần entry limit tại biên zone + TP/SL theo ATR để có lời.
- Per-symbol R3b: BTC 91.7%, LTC 90.5%, XRP 87.8% (thanh khoản sâu) vs
  1000PEPE 69.7%, TRX 70.8%, SUI 72.4% (meme/alt nhỏ, dễ thao túng) →
  **VSR đáng tin nhất trên symbol thanh khoản cao**.

## 6. LƯU Ý PHƯƠNG PHÁP (tránh lặp lại sai lầm)

1. Mẫu retest của VSR 20,20 nhỏ (529+575) → sai số ±4-6%. Luôn ghi N khi báo tỷ lệ.
2. Các mẫu liên tiếp có autocorrelation → sai số thực tế lớn hơn tính toán.
3. Khi thêm feature: đảm bảo KHÔNG dùng thông tin tương lai tại điểm quyết định
   (ví dụ volRatio phải dùng 20 nến TRƯỚC nến test, không gồm nến test).
4. `analyseZoneTests` chỉ phân tích LẦN CHẠM ĐẦU TIÊN của zone (khớp với nghiên cứu gốc).
5. Merge zone: `startIndex` được reset về nến merge → tuổi zone tính từ lần gộp gần nhất.
6. Khi tải dữ liệu mới: luôn giữ `delayMs=450` + backoff; cache compact
   `[time,open,high,low,close,volume]`; SUI/PEPE/ARB/OP/APT không đủ 200k nến (niêm yết muộn).

## 7. HƯỚNG TIẾP TỤC ĐỀ XUẤT (ưu tiên theo giá trị)

1. **Backtest nâng cao**: vào lệnh LIMIT tại biên zone (lower khi test hỗ trợ, upper khi test
   kháng cự) thay vì market tại close nến test; TP/SL theo ATR (TP ~1×ATR, SL ~0.5×ATR);
   đo win rate, avg R:R, drawdown. Mục tiêu: biến edge 80% hướng thành PnL dương sau phí.
2. **Out-of-sample**: train 2020-2024, test 2025-2026 (cắt dữ liệu theo thời gian) để xác nhận
   score ≥ 4 không bị overfit.
3. **Tối ưu ngưỡng score**: thử các ngưỡng khác (≥3, ≥4, ≥5) kèm sample size; kiểm tra
   threshold tối ưu của VSR cho từng symbol (10, 15, 20).
4. **Thêm timeframe**: 1h, 4h — kiểm tra tính ổn định của score và alignment (K theo nến
   nên đổi tương ứng, ví dụ K=8 nến 1h ≈ 8h).
5. **Feature mới**: khoảng cách close đến biên zone khi test; VSR zone cũ hơn 1 đời (zone
   trước đó) làm vùng hợp lưu thay vì zone đang hoạt động; phân loại nến test (doji, pin bar).
6. **Cảnh báo rủi ro**: thêm mô phỏng với slippage 0.02-0.05% và funding fee nếu trade futures.
7. **Cập nhật PineScript**: thêm tùy chọn hiển thị score thang màu 6 bậc thay vì 3 trạng thái.

## 8. QUY ƯỚC BÁO CÁO

- Báo cáo bằng tiếng Việt, luôn kèm N (sample size) cho mọi tỷ lệ phần trăm.
- Phân biệt rõ: "độ chính xác hướng" (outcome đúng) vs "win rate PnL" (có lời sau phí).
- Không kết luận "dự đoán được" khi lift < 1.2× hoặc hit rate < 55%.
- Ghi chú giới hạn (mẫu nhỏ, autocorrelation, thị trường đổi) ở cuối mỗi báo cáo.
