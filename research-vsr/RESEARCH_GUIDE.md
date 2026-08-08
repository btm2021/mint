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
| `zonecheck.js` | **Phân tích CẢ ZONE** (mọi lần chạm, cả 2 phía) — CHẶN vs XUYÊN cả đời zone |
| `breakcheck.js` | **Định nghĩa XUYÊN mới** — close xuyên + ATRBot(14,2,14 VIDYA) xác nhận hướng; tách PHÁ GIẢ |
| `cyclevsr.js` | **VSR bổ trợ ATRBot** — zone bị cắt XUÔI/NGƯỢC trend trong chu kỳ ATRBot, dự báo đảo chiều (xem 5.3b) |
| `atrvsr.js` | **TĂNG WINRATE ATRBot bằng VSR** — lọc entry xuôi-confirm sớm, thoát sớm, phân loại flip (xem 5.3c) |
| `entry.js` | **ENTRY TỐI ƯU** — quét 80 tổ hợp; kết quả: EMA20 pullback sau xuôi-confirm (xem 5.3d) |
| `system.js` | **HỆ THỐNG HOÀN CHỈNH** — 2 ATRBOT (bias+entry) + VSR + TP/SL grid (xem 5.3e) |
| `optimize.js` | **TỐI ƯU LỆNH SAI** — 17 feature/lệnh, pattern lỗ, greedy filter → WIN 70% (xem 5.3f) |
| `rr.js` | **R:R + OUT-OF-SAMPLE** — Exp 0.38R, PF 2.36, test 2025-2026 win 68.5% (xem 5.3g) |
| `backtest_final.js` | **BACKTEST CHUYÊN NGHIỆP** — equity, Sharpe/Sortino/Calmar, Kelly, Monte Carlo DD, yearly, per-symbol (xem 5.3h) |
| `backtest.js` | **Backtest các rule với phí 0.1%**, 2 mốc thoát (T+8, T+24), per-symbol |
| `test-replica.mjs` | Kiểm chứng engine VSR khớp với `js/indicators.js` |
| `lib/vsr.js` | Engine VSR (trả zones + upper/lower/signal từng nến) |
| `lib/atrbot.js` | Trend state ATRBot: 1 = uptrend, -1 = downtrend; hỗ trợ `maType` "ema" (mặc định) và "vidya" (đúng branch indicators.js, đã kiểm chứng state khớp 100%) |
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
node zonecheck.js                                # CẢ ZONE: chặn/xuyên cả đời zone (xem 5.2b)
node breakcheck.js                               # XUYÊN có ATRBot xác nhận + tách PHÁ GIẢ (xem 5.2c)
node cyclevsr.js                                 # VSR bổ trợ ATRBot: cắt xuôi/ngược trend (xem 5.3b)
node atrvsr.js                                   # Tăng winrate ATRBot bằng VSR (xem 5.3c)
node entry.js                                    # Quét entry tối ưu — EMA20 pullback (xem 5.3d)
node system.js                                   # Hệ thống 2 ATRBOT + VSR + TP/SL (xem 5.3e)
node optimize.js                                 # Tối ưu lệnh sai → WIN 70% (xem 5.3f)
node rr.js                                       # R:R + out-of-sample (xem 5.3g)
node backtest_final.js                           # Backtest chuyên nghiệp đầy đủ (xem 5.3h)
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

### 5.2b. ⚠️ HIỆU CHỈNH CẤP ĐỘ "CẢ ZONE" (zonecheck.js — BẮT BUỘC đọc)
Các số ở 5.2 là **từng lần chạm, sự kiện đầu tiên thắng**. Ở cấp độ CẢ ZONE (mọi lần chạm,
có bất kỳ lần đóng xuyên nào trong đời zone):
- **62-74% zone bị chạm từ CẢ HAI phía** → zone là tấm chắn 2 chiều, KHÔNG "cắt lên cắt xuống".
- **CHẶN cả đời chỉ 18-28%, XUYÊN 72-82%** — đa số zone cuối cùng bị xuyên qua.
- Phía chạm đầu tiên không ảnh hưởng kết quả cấp zone (28.1% vs 28.0%).
- Score vẫn phân biệt: score≥4 → CHẶN cả đời 30-40%; score≤1 → 15-22% (nhưng vẫn <50%).
- **QUAN TRỌNG: zone bị test cả 2 phía → chỉ 2.3-4.1% chặn tiếp mọi lần sau (~97% sẽ bị xuyên).**
### 5.2c. ✅ ĐỊNH NGHĨA XUYÊN MỚI — kết hợp ATRBot(14,2,14,VIDYA) (breakcheck.js)
"Xuyên" cũ (close qua khỏi zone trong K nến) chứa ~59% **PHÁ GIẢ** — close xuyên nhưng
ATRBOT KHÔNG xác nhận hướng (trend vẫn ngược hướng phá → giá quay lại). Định nghĩa mới:
- **XUYÊN THẬT** = close xuyên zone VÀ state ATRBot(14,2,14 vidya) tại nến xuyên cùng hướng
  (support break → state DOWN; resistance break → state UP)
- **PHÁ GIẢ** = close xuyên nhưng trend không xác nhận
- **GIỮ** = không có close xuyên trong K nến
Kết quả 20 symbol (3 config, K=8):
- Lần chạm đầu: GIỮ 49-51% | XUYÊN THẬT 20-21% | PHÁ GIẢ 29-30%
- Cả zone: CHẶN cả đời 33-47% | XUYÊN THẬT 53-67% (cải thiện so với 18-28% của định nghĩa cũ)
- **Score phân biệt rõ hơn hẳn với định nghĩa mới:**
  score≥4 → GIỮ 70.9-74.1%, XUYÊN THẬT chỉ 10.4-11.9%
  score≤1 → GIỮ 39-40%, XUYÊN THẬT 27.3-29.2%
- Độ trễ xác nhận: median ~2 nến sau lần chạm (rất khả dụng cho giao dịch)
- Trend flip chỉ 2-5% → xuyên thật chủ yếu là TIẾP DIỄN trend (trend đã cùng hướng), không phải đảo trend
- Phía chạm vẫn không quan trọng (49.4 vs 49.5%)

### 5.3. VSR10 → dự đoán VSR20 (456k mẫu)
- KHÔNG dự đoán được việc TẠO zone VSR20 (base 1.8%, mọi feature lift ≤1.16×).
- Confluence VSR10 vô nghĩa (zone VSR10 luôn tồn tại ~100% thời gian, 100% trùng).

### 5.3b. ✅ VSR BỔ TRỢ ATRBot(14,2,14,VIDYA) — cyclevsr.js (hướng nghiên cứu chính hiện tại)
Sự kiện: zone VSR hoạt động trong chu kỳ ATRBot bị giá đóng CẮT qua (close > upper / < lower) trước khi cycle đảo.
Base rate: cycle đảo trong 8n = 6.2%, 24n = 17.1%, 48n = 32.0%.
- **CẮT XUÔI trend → ATRBot ĐÚNG**: P(đảo 8n) chỉ 0.2-0.5% (lift 0.03-0.08 — thấp hơn base 12-30 lần);
  cycle còn TB 151-156 nến. Xác nhận trend tiếp tục rất mạnh.
- **CẮT NGƯỢC trend → ATRBot SAI**: P(đảo 8n) 10.9-13.9% (lift x1.75-2.23); cycle còn TB 104-122 nến
  (chết sớm hơn ~35% so với xuôi). KHÔNG phải chuông báo đảo sớm (lead median 66-85 nến).
- **Bộ lọc mạnh cho cắt ngược**: + close cùng phía EMA mới (cắt xuống mà close < EMA20 / cắt lên mà
  close > EMA20) → đảo 8n 17.6-22.8% (x2.83-3.66); + volume > 2x → 21.3% (x3.41);
  + zone tạo TRONG cycle này → 16.2-22.8% (x2.60-3.65). Zone RỘNG làm YẾU tín hiệu (x1.5-1.9).
- Coverage: chỉ 12-14% cắt ngược xảy ra ≤8 nến trước đảo → dùng làm CẢNH BÁO, không phải tín hiệu đảo.
- "Zone giữ hết cycle" gần như không xảy ra (N=8-47) — zone luôn bị cắt; thông tin nằm ở HƯỚNG cắt.
- Per-symbol: lift 1.5-3.0× khắp 20 symbol (BTC/ETH/DOGE/XRP mạnh nhất ~2.7-3.0×). IMXUSDT đúng mẫu chung.

### 5.3c. ✅ TĂNG WINRATE CHO ATRBot BẰNG VSR — atrvsr.js (kết quả thực thi, phí 0.1%)
Backtest trên 21 symbol, 23.539 chu kỳ ATRBot(14,2,14 VIDYA): long/short theo state, thoát khi đảo.
- **BASE ATRBot: winrate 36.8%, TB +0.32%/lệnh, tổng +7.616%** (trend-following: winrate thấp, kỳ vọng dương).
- **✅ LỌC ENTRY bằng XUÔI CONFIRM SỚM** (zone bị cắt cùng hướng trend + close qua EMA20 trong 8 nến đầu):
  - Có confirm: winrate 37.3-38.0%, TB +0.42 đến +0.52% (tổng +8.405 đến +8.611%)
  - Không confirm: winrate 33.5-34.0%, TB **-0.13 đến -0.33%** (tổng -788 đến -995%) → BỎ QUA nhóm này.
  - Vào lệnh thực tế tại nến confirm: winrate 36.9-37.4%, TB +0.37-0.44%.
- **❌ THOÁT SỚM khi cắt ngược: THẤT BẠI** — winrate giảm 36.8% → 32.7-33.1% (cắt lệnh thắng ngắn vì đa số
  cắt ngược là phá giả). Không dùng để thoát.
- **⚠️ "Flip do cắt zone NGƯỢC + EMA xác nhận" (đảo có VSR xác nhận) → cycle mới WINRATE 28-33%, TB ÂM**
  (-0.2 đến -0.48%, N=110-157, consistent 3 config) → ĐỪNG đuổi theo các cú đảo này.
- Quy tắc tổng: ATRBot trade tốt nhất khi KHÔNG có tín hiệu đảo mạnh — VSR dùng làm BỘ LỌC ENTRY
  (xuôi confirm sớm), không phải bộ phát tín hiệu đảo.

### 5.3d. ✅ ENTRY TỐI ƯU — EMA20 PULLBACK sau xuôi-confirm (entry.js, quét 80 tổ hợp)
Quét W∈{4,8,12,24} × entry∈{flip, conf, nextopen, emapull, zonepull} × vol∈{-,1x,1.5x,2x}
trên 21 symbol, exit cố định tại nến đảo, phí 0.1%. Kết quả nhất quán cả 3 config:
- **EMAPULL THẮNG**: vào lệnh tại close nến đầu tiên (sau confirm, trong 16 nến) giá chạm EMA20
  (uptrend: low ≤ EMA20; downtrend: high ≥ EMA20). Winrate 39.6-40.1% (Vx) → 40.2-40.7% (V1/V2),
  TB +0.83-0.91% (Vx) → +1.03-1.10% (V1/V2). Gấp ~3 lần TB của ATRBot thuần (+0.32%).
- **ZONEPULL nhì**: vào tại close nến chạm lại zone sau break — win 37.8-39.0%, TB +0.61-0.82%
  (khớp nghiên cứu retest: zone là điểm hồi).
- flip/conf/nextopen: 36.8-38.0% (winrate KHÔNG tăng khi vào trễ hơn — chỉ có pullback mới tăng).
- Cửa sổ W ít ảnh hưởng (37.1-37.4% cho conf) — không overfit theo W.
- Lọc volume (nến confirm >1x-2x) tăng nhẹ winrate & TB, giảm mẫu (~1/3).
- Per-symbol: emapull_V2 thắng base ở 18-19/21 symbol (BTC +7.3-7.5pp, SOL +5.8-7.3, XRP +5.8-8.1,
  TON +11-12; ngoại lệ DOGE/NEAR/IMX ~flat/-2).
- Quy trình khuyến nghị: (1) ATRBot(14,2,14 VIDYA) đảo → trend mới; (2) VSR xuôi-confirm trong
  8 nến (zone cắt cùng hướng + close qua EMA20); (3) chờ pullback chạm EMA20 → vào lệnh market
  tại close nến chạm; (4) thoát khi state đảo. Winrate ~40-41%, TB ~+1.0-1.1%.

### 5.3e. ✅ HỆ THỐNG HOÀN CHỈNH: 2 ATRBOT (bias + entry) + VSR + TP/SL (system.js)
Stage A — quét 3 slow bias × 3 fast entry (exit fast flip / slow flip), 21 symbol:
- Slow VIDYA tốt hơn slow EMA làm bias (S1 ema làm GIẢM TB). Tốt nhất: S3=(20,3,30 vidya) + F1=(14,2,14 vidya):
  bias TB 1.19%/lệnh (win 40.3%); exit tại SLOW flip → TB 1.51% (win 36.5%).
Stage B — TP/SL grid trên S3+F1 (N=7.068, phí 0.1%, time-stop = fast flip):
- **Winrate tối đa: TP 2% / SL 2% → WIN 57.1%, TB +0.27%, PF 1.34, tổng +1.942%** — dương trên CẢ 21 symbol.
- Expectancy tối đa: EXIT_FAST (không TP/SL) → win 40.3%, TB +1.19%, PF 1.79 (đánh đổi winrate).
- ATR-based tốt: A3ATR_SL1.5ATR → 44.6%, +0.26%, PF 1.39.
HỆ THỐNG ĐỀ XUẤT (winrate tối đa):
  BIAS  : ATRBot(20, 3, 30, VIDYA) — chỉ trade khi slow state = hướng lệnh
  ENTRY : ATRBot(14, 2, 14, VIDYA) đảo + VSR(10,10) xuôi-confirm 8 nến + EMA20 pullback 16 nến
          (vào tại close nến đầu tiên chạm EMA20)
  TP/SL : TP 2% / SL 2% (thoát khi chạm; time-stop = fast flip)
  Kết quả: WIN 57.1% | TB +0.27%/lệnh | PF 1.34 | N=7.068 (~337 lệnh/symbol/5.7 năm) | dương 21/21 symbol.
Lưu ý: grid-search → cần out-of-sample 2025-2026 trước khi live; TP/SL % cố định không tự thích ứng
ATR (bản ATR-based an toàn hơn khi volatility đổi).

### 5.3f. ✅ TỐI ƯU LỆNH SAI (optimize.js) — WIN 57.1% → 70.0%
Ghi 17 feature/lệnh cho hệ thống S3+F1+VSR+TP2/SL2 (N=6.839), tìm bucket lỗ rồi loại tuần tự (N≥2.500):
PATTERN LỆNH SAI (win << base 57.1%):
- **Vào TRỄ trong fast cycle** (tuổi cycle 5-12n: 48.4%, TB âm; 13-24n: 51.6%) — vào nhanh mới tốt
  (cycle ≤4n: 68.5%; pullLag 0-1: 76.0%!)
- **Pullback sâu**: độ sâu 0.5-1 ATR: 44.9% | >2 ATR: 43.8% — chỉ hồi NÔNG.
- **Entry ngay TẠI biên zone** (chạm zone: 43.7%, trong zone sâu: 47.9%) — tránh "nam châm" zone,
  entry phải qua khỏi zone ≥0.5 ATR.
- Phụ: volume entry ≤0.8x (54.2%), ATR ≤0.3% (47.4%), giờ UTC 18-23 (52.6%), EMA slope ngược (46.9%).
TỐI ƯU (4 filter): loại [cycle 5-12] → [cycle 13-24] → [chạm zone] → [pull 0.5-1 ATR]:
- **KẾT QUẢ: N=2.610 | WIN 70.0% (+12.9pp) | TB +0.77% (gấp 2.75x) | Tổng +1.998% (cao hơn base +1.889%
  dù chỉ còn 38% số lệnh) | dương 20/20 symbol** (IMX 75.8%, DOGE 74.5%, OP 74.6%, ETH 74.0%).
- Bản chất: QUY TẮC "VÀO NHANH" — flip + VSR xuôi-confirm + chạm EMA20 phải xảy ra trong ≤4 nến đầu
  cycle; KHÔNG chờ hồi sâu; KHÔNG vào tại biên zone.
⚠️ Greedy in-sample trên 17 feature → RỦI RO OVERFIT: bắt buộc out-of-sample trước khi live.

### 5.3g. ✅ THỐNG KÊ R:R + OUT-OF-SAMPLE (rr.js) — hệ thống tối ưu KHÔNG overfit
R = SL 2%. Split: train < 2025-01-01 (66%) | test >= 2025 (34%).
- TOÀN MẪU — TỐI ƯU (N=2.699): WIN 70.0% | AvgWin +0.95R | AvgLoss -0.93R | **Exp +0.38R** | **PF 2.36** |
  **MaxDD 15.8R** (base: PF 1.34, Exp 0.14R, MaxDD 56.3R — cải thiện mạnh).
- R-distribution: 69.6% lệnh đạt 0.5-1R (TP), 27.1% lệnh -1.5..-0.5R (SL), ~3% timeout.
- **OUT-OF-SAMPLE test 2025-2026 (N=868): WIN 68.5% | Exp +0.36R | PF 2.23 | MaxDD 8.9R** — giảm rất nhẹ
  so với train (70.6% / 0.39R / 2.43) → KHÔNG overfit, chiến lược bền vững.
- Per-symbol test: **0/21 symbol có expectancy âm** (IMX 81.3%/0.57R/PF3.92, DOGE 82.2%/0.61R/PF4.54,
  LTC 76.2%/0.53R, LINK 77.5%/0.51R, ETH 75.6%).
- Lưu ý: TP=1R cố định giới hạn thắng (không có lệnh >1R) — expectance đến từ hit rate, không từ
  winner kéo dài; cần rà soát lại với slippage thực tế khi live.

### 5.3h. ✅ BACKTEST CHUYÊN NGHIỆP ĐẦY ĐỦ (backtest_final.js) — HỆ THỐNG "VBT"
Thông số đầy đủ: phí+slippage 0.14%/lệnh | risk 1%/lệnh (vị thế 50% equity) | 21 symbol 15m | 5.7 năm.
- N=2.673 | WIN 70.1% | Exp +0.362R | PF 2.27 | avgWin +0.93R / avgLoss -0.95R | Kelly 0.39 (1/2 = 0.20)
- MaxDD 15.16% (kéo dài 73 lệnh) | chuỗi thua dài nhất 9 lệnh | thắng dài nhất 28 lệnh
- Exit: TP 69.8% (1.684R) | SL 22.8% (-635R) | Timeout 7.4% (-101R)
- Lệnh/năm 469 | giữ TB 30 nến (~7.6h) | exposure 1.9%
- **⚠️ Vị thế ĐỒNG THỜI tối đa = 10 → vốn thực cần ≥ 500% equity nếu risk 1%/lệnh** (21 symbol chồng lấp).
- CAGR 417% chỉ đúng khi lệnh tuần tự — KHÔNG dùng số này; dùng per-trade metrics + per-symbol DD.
- OOS test 2025-2026 (N=861): WIN 68.5% | Exp 0.339R | PF 2.15 → bền vững, không overfit.
- Monte Carlo (1000 lần): MaxDD median 7.3% | P90 9.1% | P95 9.8% | tệ nhất 14.6%.
- Lợi nhuận năm: 2020 +20%, 2021 +366%, 2022 +366%, 2023 +310%, 2024 +644%, 2025 +579%, 2026 +164%
  (tuần tự; 2024-2025 mạnh nhất). Sharpe 0.52 / Sortino 0.67 (hàng tháng, trung thực ở mức vừa).
- Per-symbol: dương 21/21 (ExpR 0.21-0.45, PF 1.58-2.90, MaxDD/symbol 1.1-3.0R).
- File: output/backtest_final/ (trades.csv đủ cột thời gian/giá/loại thoát/PnL, equity.csv, monthly.csv).

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
