# PROMPT.md — Hướng dẫn sử dụng & Hướng nghiên cứu mới

> Tài liệu vận hành: cách dùng toàn bộ công cụ nghiên cứu VSR/ATRBOT + danh sách hướng
> nghiên cứu mới kèm prompt sẵn sàng dùng.
> Đọc kèm: `strat.md` (chiến lược VBT) → `RESEARCH_GUIDE.md` (phương pháp & kết quả).

---

## 1. BẮT ĐẦU NHANH

### 1.1. Các lệnh cốt lõi

```bash
cd research-vsr

# TÁI LẬP chiến lược VBT (báo cáo đầy đủ — luôn chạy cái này trước khi làm gì khác)
node backtest_final.js

# Nghiên cứu nền
node zoneclass.js          # score 0-6, 3 config (5,10|10,10|15,10) — 20 symbol
node breakcheck.js         # định nghĩa xuyên + ATRBot xác nhận
node cyclevsr.js           # VSR cắt xuôi/ngược trong chu kỳ ATRBot
node atrvsr.js             # tăng winrate ATRBot bằng VSR
node entry.js              # quét entry tối ưu
node system.js             # hệ thống 2 ATRBOT + TP/SL grid
node optimize.js           # phân tích lệnh sai, greedy filter
node rr.js                 # R:R + out-of-sample
```

### 1.2. Tham số phổ biến (mọi script đều hỗ trợ)

```bash
--symbols "BTCUSDT,ETHUSDT"          # chọn symbol (cách nhau dấu phẩy)
--interval 1h                        # đổi timeframe
--bars 50000                         # số nến tối đa
--configs "5,10|10,10|15,10"         # cấu hình VSR (Length,Threshold)
node backtest_final.js --riskPerTrade 2 --tpPct 3 --slPct 1.5   # đổi thông số VBT
```

### 1.3. Dữ liệu & rate limit

- Cache tự động tại `cache/<symbol>_<interval>.json` (compact `[time,o,h,l,c,v]`).
- Lần đầu tải symbol mới mất ~1 phút/200k nến (delay 450ms + backoff 429 tự động).
- **Quy tắc**: không tự ý giảm delay dưới 450ms; luôn dùng `fetchBars` để tái dùng cache.

---

## 2. QUY TRÌNH CHUẨN KHI NGHIÊN CỨU (agent phải tuân theo)

1. **Xác định câu hỏi** → chọn script phù hợp (bảng 2.1) hoặc viết script mới trong `research-vsr/`.
2. **Tái lập kết quả cũ trước** (`node backtest_final.js`) để chắc baseline không đổi.
3. **Thay đổi 1 biến duy nhất** mỗi lần thử nghiệm (không đổi nhiều tham số cùng lúc).
4. **Luôn ghi N (sample size)** cho mọi tỷ lệ; phân biệt hit-rate (hướng) vs win-rate (PnL).
5. **Kiểm tra look-ahead bias**: feature tại nến t chỉ dùng dữ liệu ≤ t (volume dùng 20 nến TRƯỚC).
6. **Xác minh out-of-sample** (train < 2025 / test ≥ 2025) trước khi kết luận.
7. **Cập nhật `strat.md` + `RESEARCH_GUIDE.md`** sau mỗi kết quả quan trọng.

### 2.1. Chọn script theo câu hỏi

| Câu hỏi | Script |
|---|---|
| Chiến lược VBT hiện tại chạy thế nào? | `backtest_final.js` |
| Zone nào giữ/xuyên, score bao nhiêu? | `zoneclass.js` |
| Lệnh nào sai, pattern là gì? | `optimize.js` |
| Thêm TP/SL mới cho VBT? | sửa `CONFIG` trong `backtest_final.js` |
| Thử timeframe/interval mới? | `--interval 1h` + `backtest_final.js` |
| Thêm symbol mới vào nghiên cứu? | thêm vào danh sách `--symbols` (tự tải cache) |

---

## 3. HƯỚNG NGHIÊN CỨU MỚI (kèm prompt sẵn)

### H1. ⭐ Giới hạn vị thế đồng thời (ưu tiên cao nhất)
**Vấn đề**: 21 symbol đã có lúc 10 vị thế mở cùng lúc; scale 600 symbol sẽ 100–300.
**Việc cần làm**: mô phỏng chiến lược với N vị thế tối đa (5/10/20) — khi đủ N, bỏ qua tín hiệu
xếp hạng thấp (theo score VSR / theo symbol có winrate cao). Đo winrate, ExpR, tổng R, số lệnh bị bỏ.
**Prompt**: "Sửa backtest_final.js thêm tham số --maxConcurrent N: xử lý lệnh theo thời gian,
nếu số vị thế đang mở >= N thì bỏ lệnh mới (ưu tiên giữ lệnh đang mở). Báo cáo so sánh N=5/10/20/∞."

### H2. ⭐ Mở rộng danh mục 50–100 symbol
**Việc cần làm**: tải thêm symbol (ưu tiên top volume còn lại), chạy `backtest_final.js`,
kiểm tra: tần suất lệnh/ngày, % symbol âm, phân bố tần suất altcoin nhỏ (có báo nhiều hơn không).
**Prompt**: "Thêm 30 symbol USDT-M còn lại vào --symbols, chạy backtest_final.js, báo cáo:
lệnh/ngày ước tính, số symbol âm, top 5 kém nhất, so sánh với 21 symbol gốc."

### H3. Chi phí thực tế: funding fee + slippage động
**Việc cần làm**: thêm funding rate lịch sử (nếu lấy được) hoặc mô phỏng funding trung bình
0.01%/8h theo thời gian nắm giữ; slippage theo spread thực (0.02–0.1% tùy symbol).
Kiểm tra edge còn bao nhiêu sau chi phí đầy đủ.
**Prompt**: "Cập nhật backtest_final.js: tính funding fee 0.01%/8h cho thời gian giữ mỗi lệnh
(long/short có dấu khác nhau), slippage 0.05%/lệnh. So sánh winrate/ExpR trước-sau chi phí."

### H4. TP/SL thích ứng ATR
**Vấn đề**: TP2/SL2 cố định không đổi theo volatility. Đã biết bản ATR-based
(A3ATR/SL1.5ATR) có PF 1.39 nhưng win thấp hơn (44.6%).
**Việc cần làm**: thử SL = 1.5×ATR(14 nhanh), TP = 1×SL (R:R 1:1) → tìm winrate vs ExpR tốt nhất;
kiểm tra OOS.
**Prompt**: "Trong backtest_final.js đổi SL/TP sang ATR-based (SL=1.5*ATR14, TP=1*SL), chạy
toàn mẫu + OOS, so sánh với TP2/SL2: winrate, ExpR, MaxDD."

### H5. Timeframe 1h / 4h
**Việc cần làm**: tái chuẩn hóa W confirm (8 nến 1h = 8h, có thể giảm 4–6), pull 16, TP/SL
theo % (2% có thể quá nhỏ cho 4h). Kiểm tra "vào nhanh ≤4 nến" và "không chạm biên zone"
còn đúng trên timeframe lớn không.
**Prompt**: "Chạy backtest_final.js với --interval 1h rồi 4h trên 10 symbol chính; báo cáo
winrate/ExpR/MaxDD và đề xuất W, TP/SL phù hợp cho từng timeframe."

### H6. Bộ lọc phụ chưa dùng (tăng winrate thêm 1-3pp?)
**Dữ liệu sẵn có** (optimize.js): volume entry ≤0.8× → 54.2% (lỗ), giờ UTC 18–23 → 52.6%,
EMA slope ngược hướng → 46.9%, ATR ≤0.3% → 47.4%. Chưa đưa vào vì giảm mẫu.
**Việc cần làm**: thử từng bộ lọc + tổ hợp, đo winrate mới + OOS + N còn lại ≥ 1500.
**Prompt**: "Thêm vào backtest_final.js 3 filter tùy chọn: volEntry>0.8, hour<18, emaSlope cùng
hướng. Chạy 2^3 tổ hợp, chọn bộ giữ N≥1500 và winrate OOS cao nhất."

### H7. Đo độ bền theo thời gian (rolling)
**Việc cần làm**: chia 5.7 năm thành cửa sổ 1 năm trượt (6 tháng train / 6 tháng test),
vẽ winrate/ExpR theo thời gian; phát hiện giai đoạn chiến lược yếu (2023 range?).
**Prompt**: "Viết rolling-window analysis cho VBT: cửa sổ 6 tháng test, bước 3 tháng. Xuất
bảng winrate/ExpR/PF theo từng cửa sổ + nhận xét giai đoạn suy yếu."

### H8. Cải thiện ENTRY: limit tại EMA20 thay vì market
**Vấn đề**: vào market tại close nến chạm EMA20 — trượt giá và giá vào kém hơn limit.
**Việc cần làm**: mô phỏng limit ở giá EMA20 (chỉ tính khi low ≤ EMA20), fill một phần
(giả định 70% fill), đo winrate/ExpR cải thiện.
**Prompt**: "Thêm chế độ entry limit tại EMA20 (fill khi low<=EMA20, giả định tỷ lệ fill
70%): so sánh winrate, ExpR, số lệnh với entry market hiện tại."

### H9. Cảnh báo đảo chiều sớm (thoát chủ động khi cắt ngược có xác nhận)
**Dữ liệu**: cắt ngược + EMA + vol>2× → P(đảo 8n) = 21–23% (gấp 3.4× base) — trước đây thoát
sớm làm giảm winrate, nhưng với TP/SL hiện tại (lệnh chỉ giữ TB 30 nến) cần kiểm tra lại:
cắt ngược có xác nhận trong 8 nến đầu lệnh → thoát sớm có lợi hơn không?
**Prompt**: "Trong backtest_final.js thêm exit sớm: nếu trong 8 nến đầu sau entry có nến
đóng cắt zone ngược trend + close qua EMA20 + volume>2x thì thoát tại close. So sánh
winrate/ExpR với bản gốc, OOS riêng."

### H10. PineScript hoàn chỉnh cho VBT
**Việc cần làm**: nâng cấp `vsr_zone_classifier.pine` thành bản đầy đủ: vẽ 2 ATRBot
(trail1/trail2 màu vùng), zone VSR màu theo trạng thái, marker entry khi đủ 5 điều kiện VBT
+ 3 lệnh cấm, đường EMA20; tham số nhập từ settings.
**Prompt**: "Viết PineScript v5 'VBT Strategy Chart': vẽ ATRBot slow+fast (fill vùng xanh/đỏ),
zone VSR (vàng), EMA20, marker ▼/▲ tại entry hợp lệ, hiển thị text điều kiện thiếu."

### H11. Phân tích hành vi theo giờ phiên & ngày
**Việc cần làm**: nhóm lệnh theo giờ UTC (đã thấy 18–23 giờ yếu) và thứ trong tuần;
kiểm tra funding/thanh khoản ảnh hưởng; đề xuất lịch giao dịch tối ưu.
**Prompt**: "Phân tích trades.csv theo giờ UTC và thứ: winrate/ExpR từng nhóm, kiểm định
sự khác biệt, đề xuất khung giờ nên/nên tránh."

### H12. So sánh với baseline đơn giản
**Việc cần làm**: cùng TP/SL 2%, so sánh VBT với: (a) chỉ ATRBot nhanh, (b) nhanh + bias,
(c) nhanh + bias + VSR (từng lớp cộng thêm giá trị bao nhiêu).
**Prompt**: "Chạy 4 phiên bản: F1, F1+bias, F1+bias+VSR-confirm, VBT đầy đủ (có 3 lệnh cấm).
Bảng so sánh winrate/ExpR/PF/N — xác định lớp nào đóng góp nhiều nhất."

---

## 4. QUY ƯỚC BÁO CÁO KHI NGHIÊN CỨU MỚI

- Luôn kèm N; phân biệt hit-rate vs win-rate; ghi chú autocorrelation/mẫu nhỏ.
- So sánh với baseline VBT (win 70.1%, Exp 0.362R, PF 2.27, OOS 68.5%).
- Kết luận "cải thiện" chỉ khi thắng cả in-sample LẪN out-of-sample.
- Sau mỗi kết quả: cập nhật `strat.md` (nếu đổi chiến lược) hoặc `RESEARCH_GUIDE.md` (nếu thêm
  kiến thức nền). Thêm dòng vào "NHẬT KÝ PHÁT TRIỂN" ở strat.md.
- Không vẽ kết luận từ dưới 200 lệnh; không dùng CAGR tuần tự để quảng cáo (xem strat.md 6.1).
