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

### 3.6. Test theo thứ hạng volume × timeframe (test_ranks.js, 2026-08-08)

Thông số VBT giữ nguyên (tối ưu 15m). Symbol mới niêm yết (KORU 06/2026, LLY 07/2026, ESP 02/2026)
có mẫu quá nhỏ (N=3–35) → chỉ tham khảo.

| Nhóm (hạng) | Symbol | TF | N | WIN | ExpR | PF |
|---|---|---|---|---|---|---|
| TOP (8-9) | BICOUSDT | 15m | 77 | 71.4% | +0.36R | 2.17 |
| TOP (8-9) | BICOUSDT | 5m | 148 | 68.2% | +0.36R | 2.27 |
| TRUNG (100-101) | XLMUSDT | 15m | 137 | 71.5% | +0.38R | 2.35 |
| TRUNG (100-101) | XLMUSDT | 5m | 159 | 57.2% | +0.27R | 2.05 |
| SIÊU BÉ (300-301) | PHAUSDT | 15m | 40 | 65.0% | +0.23R | 1.61 |
| SIÊU BÉ (300-301) | PHAUSDT | 5m | 117 | 70.1% | +0.40R | 2.55 |
| SIÊU BÉ (300-301) | LLYUSDT | 5m | 17 | 17.6% | -0.11R | 0.59 |

Kết luận: (1) **15m hoạt động tốt ở cả 3 nhóm volume** — chiến lược không phụ thuộc thứ hạng;
(2) **5m giữ nguyên thông số vẫn chạy** (BICO 68.2%, PHA 70.1%) nhưng XLM giảm 71.5% → 57.2%
→ cần tái chuẩn hóa W/TP/SL cho 5m (xem prompt.md H5); (3) LLY 5m âm (mẫu nhỏ + thao túng)
→ symbol siêu nhỏ mới niêm yết không đủ tin cậy; (4) mẫu nhỏ (N<50) không kết luận được.

### 3.7. Test hạng volume 9-10 / 99-100 / 200-201 × 5m/15m (test_ranks.js v2, 2026-08-08)

Ranking 24h Binance USDT-M lúc chạy: hạng 9-10 = SKHYNIX/KORU, 99-100 = RKLB/XAUT,
200-201 = BASED/SAGA. Thông số VBT giữ nguyên (tối ưu 15m). **Cảnh báo: 5/6 symbol niêm yết 2026**
(mẫu 2-4 tháng), chỉ SAGAUSDT có lịch sử dài — mọi số liệu dưới N=50 chỉ là tham khảo.

| Nhóm (hạng) | Symbol | TF | N | WIN | ExpR | PF |
|---|---|---|---|---|---|---|
| TOP (9-10) | SKHYNIXUSDT | 5m | 15 | 73.3% | +0.46R | 3.06 |
| TOP (9-10) | KORUUSDT | 5m | 15 | 66.7% | +0.29R | 1.87 |
| TOP (9-10) | SKHYNIX/KORU | 15m | 4/3 | 100% | +0.93R | ∞ (mẫu quá nhỏ) |
| TRUNG (99-100) | RKLBUSDT | 5m | 17 | 70.6% | +0.47R | 3.54 |
| TRUNG (99-100) | XAUTUSDT | 5m | 32 | 43.8% | +0.21R | 4.02 |
| TRUNG (99-100) | RKLBUSDT | 15m | 8 | 62.5% | +0.28R | 1.92 |
| TRUNG (99-100) | XAUTUSDT | 15m | 9 | 33.3% | -0.12R | 0.53 |
| BÉ (200-201) | SAGAUSDT | 5m | 148 | 66.9% | +0.31R | 1.99 |
| BÉ (200-201) | SAGAUSDT | 15m | 72 | 73.6% | +0.40R | 2.42 |
| BÉ (200-201) | BASEDUSDT | 5m | 27 | 63.0% | +0.19R | 1.48 |
| BÉ (200-201) | BASEDUSDT | 15m | 7 | 71.4% | +0.36R | 2.17 |

Kết luận: (1) Symbol có lịch sử đầy đủ (SAGAUSDT) khớp baseline — 15m 73.6%/+0.40R/PF 2.42,
5m 66.9%/+0.31R — VBT không phụ thuộc thứ hạng volume; (2) 5m nhóm TRUNG-BÉ vẫn dương
(RKLB 70.6%, SAGA 66.9%), phù hợp mục 3.6; (3) XAUTUSDT (vàng token) là ngoại lệ duy nhất:
15m âm (33.3%, -0.12R) — tài sản khác bản chất (gold-backed), không khuyến nghị đưa vào danh mục;
(4) 5/6 symbol niêm yết 2026 nên mẫu N=3-32 không đủ tin cậy — cần chờ 6-12 tháng dữ liệu
hoặc kiểm tra lại sau.

### 3.8. Phân tích lệnh sai (loser_analysis.js, 2026-08-08)

Mốc khởi đầu = VBT hiện tại (2.673 lệnh, 70.0% win, +0.362R, PF 2.27). 803 lệnh lỗ (-764R):

**Nguyên nhân 1 — cấu trúc thoát lỗ** (77% lỗ là SL, 23% là TIMEOUT âm):
- SL: 617 lệnh, TB -1.07R, giữ 28.6 nến; **55.9% bị hit sau >16 nến** (mòn dần, -369R).
- TIMEOUT lỗ: 186 lệnh, TB -0.56R, giữ 87.3 nến — đi ngược âm thầm.
- **67% lệnh lỗ từng có lời 0.25–0.99R trước khi đảo đầu** → đang "give back profit" vì chờ TP 2%
  cố định. Hướng khắc phục: chốt lời từng phần (0.5R / 1R) hoặc trailing theo ATR.

**Nguyên nhân 2 — vào lệnh trễ trong chu kỳ fast (quan trọng nhất):**
- cycleAge 3–4 → WIN chỉ 51.5–52.6% (N=764) vs cycleAge ≤2 → **77.1%** (N=1.909).
- pullLag 2–4 nến → 51.1% vs vào ngay 0–1 nến → **77.0%**.
- pullDepth >0 (có hồi thật về EMA20) → 50–51% vs **không hồi → 72.9%**.
→ Quy tắc "cycleAge≤4" hiện tại quá lỏng: nến 3–4 của fast cycle là vùng lỗ ròng.

**Nguyên nhân 3 — chất lượng confirm/điều kiện nền:**
- volConfirm ≤0.8x → 64.9% (confirm yếu = lỗ nhiều hơn).
- ATR% ≤0.3 → 62.4% (thị trường phẳng, không có đà).
- Entry TRONG zone → 55.9% vs cách zone >1.5ATR → 71.3%.

**Bộ lọc đề xuất (đã kiểm tra OOS):**

| Filter | N | WIN | Exp | PF | Train 2020-24 | OOS 2025-26 |
|---|---|---|---|---|---|---|
| Base | 2.673 | 70.0% | +0.36R | 2.27 | 70.6% | 68.5% |
| cycleAge ≤ 2 | 1.909 | 77.1% | +0.50R | 3.39 | 78.1% | 74.9% |
| + pullDepth ≤ 0 | 1.797 | 78.6% | +0.53R | 3.76 | 79.7% | 76.4% |
| + volConfirm ≥ 0.8 | 1.420 | 79.7% | +0.55R | 4.01 | 80.2% | 78.6% |
| + ATR ≥ 0.3% | **1.318** | **81.0%** | **+0.57R** | **4.04** | 80.9% | **81.3%** |

Kết quả ổn định theo năm (2020: 71% → 2021-26: 75–85%), **0/21 symbol âm**, symbol yếu nhất
là TON 62.5% (N=16). Trả giá: mất 51% số lệnh → cần ~40 symbol để giữ tần suất tương đương.

**Khuyến nghị thực thi:** (1) siết `maxCycleAge` 4 → **2**; (2) bỏ chờ hồi EMA20 (vào ngay tại cf,
không chờ pullback); (3) thêm lọc volConfirm ≥ 0.8x + ATR ≥ 0.3%; (4) nghiên cứu chốt lời từng
phần/trailing để hết "give back" (gợi ý H4/H9 prompt.md).

### 3.9. Giải quyết give-back: 2TP/2SL + SL động (tpsl_grid.js, 2026-08-08)

Backtest 19 cấu hình thoát trên cùng 2.673 entry VBT. Mục tiêu: **tăng winrate** (ưu tiên #1).

**Kết luận SL động (ATR): loại.** Cả 8 cấu hình ATR-SL đều thua SL cố định 2%:

| Cấu hình | WIN | ExpR | PF | MaxDDR |
|---|---|---|---|---|
| A0 BASE TP2/SL2 | 70.0% | +0.362R | 2.27 | 7.6 |
| D1 ATR-SL1.5, TP2% | 57.0% | +0.292R | 2.23 | 4.2 |
| D2 ATR-SL1.0, TP2% | 45.6% | +0.204R | 1.93 | 3.6 |
| C2 ATR-SL1.0 2TP | 60.5% | **-0.038R** | 0.67 | **33.8** |
| C4 ATR-SL1.5 2TP | 76.4% | +0.014R | 1.13 | 6.4 |

→ SL ATR chặt (1×) bị quét liên tục (MaxDD 26–34R), SL ATR rộng (1.5×) vẫn thua SL 2%
cả winrate lẫn PF. **SL cố định 2% là tối ưu.**

**Kết luận 2TP/2SL: winrate tăng mạnh khi TP1 sớm + kéo BE.** Top cấu hình cân bằng:

| Cấu hình | WIN | ExpR | PF | MaxDDR | OOS WIN | OOS ExpR |
|---|---|---|---|---|---|---|
| A0 BASE TP2/SL2 | 70.0% | +0.362R | 2.27 | 7.6 | 68.5% | +0.339R |
| A2 TP đơn 1.0%/SL2% | 82.6% | +0.184R | 2.08 | 3.8 | 81.2% | +0.169R |
| E10 TP1=1.0(66%)+BE, TP2=2 | 82.6% | +0.269R | 2.57 | 3.6 | 81.2% | +0.260R |
| **E4 TP1=0.75(67%)+BE, TP2=2** | **85.8%** | +0.182R | 2.28 | 3.9 | **85.1%** | +0.184R |
| E2 TP1=0.75+BE, TP2=1.0 | 85.8% | +0.126R | 1.89 | 4.5 | 85.1% | +0.120R |
| E5 TP1=0.5+BE, TP2=1.5 | 89.3% | +0.043R | 1.40 | 4.5 | 89.8% | +0.051R |
| B6 TP1=1.0+BE, TP2=2 (50%) | 82.6% | +0.177R | 2.04 | 3.6 | 81.2% | +0.159R |

Phân tích: (1) Winrate tăng tỉ lệ nghịch với TP1 — TP1 càng sớm càng thắng nhiều lệnh hơn nhưng
ExpR giảm mạnh (E5: 89.3% nhưng chỉ +0.043R, gần như hòa vốn); (2) Điểm cân bằng tốt nhất là
**E4** (TP1 0.75%, đóng 2/3 + kéo BE, phần còn lại chờ TP2 2%): winrate **85.8%** (+15.8pp),
ExpR +0.182R (giảm 50%), PF 2.28 giữ nguyên, MaxDD giảm 3.7R, OOS ổn định 85.1%;
(3) Nếu muốn giữ ExpR cao: **E10** (TP1 1.0% đóng 66% + BE, TP2 2%): win 82.6%, ExpR +0.269R,
PF 2.57 (cao hơn base); (4) E5 89.3% win không đáng chọn vì ExpR gần 0.

Về phân phối thoát E4: 60.8% lệnh TP1→SL2 (lời +0.75R), 11.8% SL1 (-2R), 20.4% TIMEOUT,
7.0% TP2 → give-back được xử lý: 2/3 lệnh đảo đầu giờ còn lời thay vì lỗ.

### 3.10. Quản lý vốn: Kelly / Fixed % / Martingale / Anti-martingale (mm_grid2.js, 2026-08-08)

Mô phỏng **event-driven** (equity đổi khi lệnh đóng, sizing theo equity lúc mở, tổng risk vị thế
mở ≤ 20% equity — khớp 10-12 vị thế đồng thời thực tế). Kelly tính từng TP/SL config:

| TP/SL | W | avgW | avgL | b | **Kelly f\*** | ½K | ¼K |
|---|---|---|---|---|---|---|---|
| A0 | 70.0% | +0.93R | -0.95R | 0.97 | **39.1%** | 19.5% | 9.8% |
| E4 | 85.8% | +0.38R | -1.00R | 0.38 | **48.2%** | 24.1% | 12.1% |
| E10 | 82.6% | +0.53R | -0.98R | 0.54 | **50.5%** | 25.2% | 12.6% |
| E5 | 89.3% | +0.17R | -1.00R | 0.17 | **25.5%** | 12.7% | 6.4% |
| B6 | 82.6% | +0.42R | -0.98R | 0.43 | **42.0%** | 21.0% | 10.5% |

Kết quả MM tiêu biểu (E10 — TP/SL cân bằng tốt nhất):

| MM | Equity(100) | CAGR | MaxDD | DD/CAGR | Ghi chú |
|---|---|---|---|---|---|
| Fixed 0.5% | 3.534 | 87% | 3.7% | 0.04 | an toàn nhất |
| **Fixed 1.0%** | 117.725 | **246%** | **7.5%** | 0.03 | ✅ cân bằng |
| Fixed 2.0% | 108M | 1.045% | 15.0% | 0.01 | mạnh, chấp nhận DD |
| Kelly FULL/HALF | 100 | 0% | — | — | ⚠️ f* > riskCap 20% → KHÔNG khả thi |
| Kelly QUARTER | 4.2e16 | 36.793% | 52.4% | 0.00 | số ảo, MaxDD 52% không chơi được |
| Martingale x2 | 935.882 | 398% | 13.0% | 0.03 | tốt hơn Fixed 1% nhưng DD gấp đôi |
| Anti-mart x2 | 2.5e15 | 22.382% | 43.5% | 0.00 | số ảo, phụ thuộc chuỗi thắng may mắn |

**Kết luận (quan trọng):**
1. **Kelly FULL không áp dụng được** cho danh mục nhiều vị thế song song: f* = 39-50%/lệnh
   vượt xa riskCap → hệ thống từ chối mọi lệnh (equity đứng yên 100). Kelly chỉ đúng khi 1 lệnh
   1 lúc; với ~10 vị thế song song phải chia ~10 → **K/10 ≈ 4-5% ≈ Fixed 1% hiện tại**.
2. **Fixed % là lựa chọn thực dụng nhất**: Fixed 1% = 246% CAGR / MaxDD 7.5% (E10);
   Fixed 2% = 1.045% CAGR / MaxDD 15% nếu chấp nhận rủi ro. Quan hệ tuyến tính, dễ hiểu, dễ vận hành.
3. **Martingale không đáng**: cùng base 1%, CAGR 398% vs Fixed 246% nhưng MaxDD 13% vs 7.5%
   → DD/CAGR xấu hơn (0.03 vs 0.03 nhưng rủi ro chuỗi 7-10 lỗ liên tiếp sẽ cháy tài khoản thật).
4. **Anti-martingale cho CAGR khủng nhưng là ảo ảnh**: phụ thuộc chuỗi thắng 28-55 lệnh
   (A0/E4/E10), MaxDD 30-54%, và bỏ 400-971 lệnh do chạm cap → không bền vững, tail risk cực lớn.
5. **Khuyến nghị**: E10 + **Fixed 1%** (risk 1% equity/lệnh, cap 20% tổng risk) — winrate 82.6%,
   CAGR 246%, MaxDD 7.5%. Nếu chấp nhận DD 15% → Fixed 2%. Không dùng martingale/anti-mart.

### 3.11. Monte Carlo + dự phóng 300 symbol (montecarlo.js, 2026-08-08)

**Cơ sở dự phóng:** 22.3 lệnh/symbol/năm (đo thực trên 21 symbol, 5.7 năm) → 300 symbol =
~558 lệnh/tháng. E10: ExpR +0.269R, risk 1% → +0.269% equity/lệnh → **~+150%/tháng nếu
không giới hạn**; sau cap 20% vị thế (~5% lệnh bị bỏ) → **~+143%/tháng (cộng dồn)**.

**Monte Carlo 10.000 lần xáo trộn (21 symbol, 5.7 năm, risk 1%):**
- MaxDD: median 5.5% | P90 7.0% | P95 7.5% | tệ nhất 13.1%
- Không lần nào equity tụt <50% → chuỗi thua cực đoan không phá được hệ thống ở 21 symbol

**Phân phối lợi nhuận 1 tháng (300 symbol, 200k mô phỏng):**

| Kịch bản | P05 | P50 | P75 | % tháng âm |
|---|---|---|---|---|
| Tháng khỏe (không ngày xấu) | +266% | +360% | +404% | 0.0% |
| 5 ngày range (win 60%) | +158% | +229% | +266% | 0.0% |
| 10 ngày range (win 55%) | +61% | +106% | +129% | 0.0% |
| 5 ngày range + 1 ngày vỡ 20 vị thế | +108% | +165% | +195% | 0.0% |
| 10 ngày range + 1 ngày vỡ | +30% | +66% | +84% | 0.1% |
| 10 ngày range + 2 ngày vỡ (như 06/2022) | +5% | +34% | +48% | 2.6% |
| 15 ngày range (win 50%) + 2 ngày vỡ | -45% | -27% | -19% | 97.7% |
| 20 ngày range (win 45%) + 2 ngày vỡ | -74% | -66% | -62% | 100% |

**Kết luận dự phóng thực tế (300 symbol, $1k, E10 + Fixed 1%):**
1. Tháng trung bình: **+60-130%** (range vừa phải 5-10 ngày); tháng thuận: +200-400%
2. Tháng âm chỉ xảy ra khi thị trường range kéo dài >15 ngày (winrate tụt ≤50%) → **xác suất
   ~2-3%/tháng** (như 06/2022), mức lỗ -20 đến -45%
3. Tháng thảm họa (range + vỡ): -60 đến -75% → nếu giữ nguyên 1% risk sẽ gần cháy tài khoản
4. **Điểm yếu cốt lõi là winrate tụt trong range dài** — SL 2% cố định bị quét nhiều lần.
   Hướng xử lý: giảm risk xuống 0.5% khi thị trường range (adaptive risk), hoặc lọc bớt lệnh
   khi winrate thực tế trượt dưới ngưỡng (xem mục 3.8: cycleAge≤2 + volConfirm≥0.8 + ATR≥0.3
   đẩy OOS win lên 81.3%)
5. Cảnh báo phương pháp: mô phỏng giả định lệnh độc lập; tương quan thật (crash toàn hệ thống)
   đã được mô phỏng qua kịch bản "vỡ K vị thế cùng lúc" ở trên — đây là giới hạn dưới thực tế
   hơn so với bootstrap thuần.

**Khuyến nghị vận hành 300 symbol:** risk 1%/lệnh, cap tổng risk 20% equity, dự kiến
**+60-130%/tháng** ở điều kiện bình thường; chuẩn bị tâm lý/vốn cho tháng âm -20-40% (chu kỳ
range 1-2 tháng); giảm risk xuống 0.5% ngay khi winrate trượt 7 ngày gần đây <55%.

### 3.12. ⚠️ PHÁT HIỆN LOOK-AHEAD BIAS — toàn bộ kết quả VBT cũ cần xem lại (entry_fix2.js, 2026-08-08)

**Phát hiện nghiêm trọng**: logic entry của backtest_final có **look-ahead bias** ở nhánh
"không có pullback trong 16 nến → vào ngay tại cf". Để biết "không có pullback", phải nhìn
trước 16 nến tương lai — điều không thể khi giao dịch live.

**Cấu trúc V1 cũ (bị bias):**
- 1.598 lệnh (60%): không pullback → "vào tại cf" → **win 92.4% — ẢO** (cần biết tương lai)
- 1.075 lệnh (40%): có pullback → vào tại emaT → **win 68.0% — THẬT** (khớp chéo V7 68.0%)

→ Các con số trước đây (A0 70%, E10 82.6%, E4 85.8%) bị **phóng đại ~12-15pp winrate**
bởi 60% lệnh "ảo". So sánh tương đối giữa các cấu hình TP/SL vẫn hợp lệ (E10 > A0), nhưng
mức tuyệt đối phải dùng bản không-bias.

**Các phiên bản KHẢ THI live (chỉ dùng dữ liệu ≤ entry):**

| Variant | N | WIN | ExpR | PF | OOS WIN | OOS ExpR |
|---|---|---|---|---|---|---|
| **V7: chỉ vào khi pullback thật (limit EMA20)** | 1.094 | **68.0%** | +0.042R | 1.13 | 64.9% | -0.009R |
| V2: market ngay tại cf (mọi tín hiệu) | 6.758 | 67.1% | +0.017R | 1.05 | 66.1% | +0.011R |
| V7F: V7 + pull nhanh/nông | 309 | 68.0% | +0.045R | 1.14 | 58.9% | -0.087R |

Với exit A0 (TP2/SL2): V7 win 52.7% / +0.019R, V2 win 50.7% / -0.017R → **gần hòa vốn,
edge gần như biến mất** khi bỏ bias. Chỉ E10 (TP1 sớm) giữ được edge dương nhẹ.

**Kết luận ②:** (1) "Vào trễ" không phải nguyên nhân chính — **nguyên nhân chính là 60% số
lệnh trong backtest cũ được hưởng lợi từ look-ahead**; (2) Sau khi loại bias, không có bộ lọc
nào (cycleAge/vol/ATR — V9→V12) cứu được edge: mọi variant rơi về 50-68% win; (3) **Chiến lược
thực tế khả thi nhất hiện tại: V7 (limit EMA20 khi pullback) + exit E10** → 68% win / +0.042R,
tuy nhiên OOS chỉ 64.9% và ExpR âm (-0.009R) → **edge mỏng, chưa đủ tin cậy để live**.

**Hành động bắt buộc:** (a) sửa backtest_final.js bỏ nhánh "vào cf khi không pullback";
(b) toàn bộ kết luận trước (mục 3.2, 3.9, 3.10, 3.11) cần tái lập với bản không-bias;
(c) hướng cứu vãn: tìm thêm bộ lọc nền mới cho V7 (không có trong bộ feature hiện tại) hoặc
đổi exit cấu trúc cho nhóm pullback (TP1 sớm hơn 0.5%?), hoặc đổi timeframe (5m/1h — H5).

### 3.13. ✅ BẢN SẠCH CHÍNH THỨC (backtest_clean.js + clean_grid.js, 2026-08-08)

**Thay thế backtest_final.js** — loại bỏ nhánh look-ahead. Chỉ 2 chế độ entry khả thi live
(dữ liệu ≤ entry): **V7** (chờ pullback thật, vào tại close nến chạm EMA20) và **V2** (market
ngay tại close cf). Grid 6 exit × 2 mode trên 21 symbol 15m:

| Mode | Exit | N | WIN | ExpR | PF | OOS WIN | OOS Exp |
|---|---|---|---|---|---|---|---|
| V7 | **E10 TP1=1.0(66%)+BE, TP2=2** | 5.160 | **66.5%** | **+0.026R** | **1.08** | 65.1% | +0.007R |
| V7 | E4 TP1=0.75(67%)+BE, TP2=2 | 5.160 | 72.4% | +0.002R | 1.01 | 71.2% | -0.013R |
| V7 | A0 TP2/SL2 | 5.160 | 49.7% | -0.024R | 0.95 | 47.4% | -0.072R |
| V7 | E5 TP1=0.5+BE, TP2=1.5 | 5.160 | 79.4% | -0.076R | 0.62 | 78.0% | -0.090R |
| V2 | E10 | 6.758 | 67.1% | +0.017R | 1.05 | 66.1% | +0.011R |
| V2 | A0 | 6.758 | 50.7% | -0.017R | 0.96 | 49.2% | -0.044R |

**Kết luận (thẳng thắn):**
1. **Chỉ E10 (TP1=1% đóng 2/3 + BE, TP2=2%) còn edge dương** — A0 và mọi cấu hình TP1 sớm
   khác đều âm/hòa vốn sau khi bỏ bias. Winrate cao (72-79%) của E4/E5 là "ảo": chốt non
   bằng lệnh không có thật.
2. **Edge thật rất mỏng**: V7+E10 → 66.5% win / +0.026R / PF 1.08 — chỉ vừa đủ sau phí
   0.14%; sau khi cộng funding fee thực tế có thể về 0. OOS 65.1% ổn định (không overfit)
   nhưng Exp OOS gần 0 (+0.007R).
3. **Bộ lọc greedy**: loại volConfirm<0.8 (feature tại-cf) → N=1.531, WIN 66.8%, Exp +0.034R,
   **OOS 68.9% / +0.060R** — cải thiện OOS rõ, dùng kèm V7+E10.
4. Theo năm: 2021-22 âm nhẹ (-0.001/-0.012R), 2023+ dương (0.03-0.09R); theo symbol: 6/21
   symbol âm (BNB -0.12R, IMX -0.08R, LINK/NEAR -0.06R) — có thể lọc bớt.
5. **Khuyến nghị chính thức**: `backtest_clean.js --mode V7 --tp1 1.0 --frac1 0.66 --tp2 2.0`
   + lọc volConfirm≥0.8 → phiên bản duy nhất đủ điều kiện tiếp tục nghiên cứu. Các con số
   trước (mục 3.2, 3.9-3.11) chỉ còn giá trị so sánh tương đối, không dùng làm kỳ vọng.

### 3.14. Kiểm tra E4/E5 trên 5m (clean_grid.js, 2026-08-08)

Chạy bản sạch (no look-ahead) trên 11 symbol có cache 5m (BASED/BICO/ESP/KORU/LLY/PHA/
RKLB/SAGA/SKHYNIX/XAUT/XLM) + nhóm 4 symbol lịch sử dài (XLM/SAGA/BICO/PHA):

**5m — 11 symbol (toàn bộ cache):**

| Mode | Exit | N | WIN | ExpR | PF | OOS WIN | OOS Exp |
|---|---|---|---|---|---|---|---|
| V2 | **E4 TP1=0.75(67%)+BE,TP2=2** | 1.994 | 68.8% | **-0.002R** | 0.99 | 68.4% | -0.007R |
| V7 | E4 | 1.571 | 66.1% | -0.006R | 0.98 | 65.5% | -0.012R |
| V2 | E5 TP1=0.5(50%)+BE,TP2=1.5 | 1.994 | 75.1% | **-0.087R** | 0.58 | 74.5% | -0.091R |
| V7 | E5 | 1.571 | 75.2% | -0.067R | 0.63 | 74.8% | -0.069R |
| V2 | E10 | 1.994 | 62.6% | +0.022R | 1.07 | 62.6% | +0.021R |
| V2 | A0 | 1.994 | 46.1% | -0.019R | 0.96 | 46.0% | -0.019R |

**5m — 4 symbol lịch sử dài (XLM/SAGA/BICO/PHA):**

| Mode | Exit | N | WIN | ExpR | PF | OOS WIN |
|---|---|---|---|---|---|---|
| V2 | E4 | 1.563 | 71.7% | +0.002R | 1.01 | 71.6% |
| V7 | E4 | 1.227 | 69.5% | 0.000R | 1.00 | 69.2% |
| V2 | E5 | 1.563 | 77.9% | -0.089R | 0.58 | 77.5% |
| V7 | E5 | 1.227 | 78.9% | -0.063R | 0.66 | 78.9% |
| V2 | E10 | 1.563 | 65.2% | +0.025R | 1.08 | 65.5% |

**Kết luận E4/E5 trên 5m (bản sạch):**
1. **E4 trên 5m = hòa vốn**: winrate cao (66-72%) nhưng ExpR ~0 (PF 0.98-1.01) — không có
   edge sau phí 0.14%. Winrate cao là "ảo": chốt non bằng lệnh không có thật (look-ahead đã bỏ).
2. **E5 trên 5m = ÂM**: winrate cao nhất (75-79%) nhưng ExpR -0.06 đến -0.09R, PF 0.58-0.66
   → thua tiền rõ rệt. Càng chốt non càng âm — đúng quy luật 15m đã thấy.
3. **Chỉ E10 còn edge dương nhẹ trên 5m** (+0.022R V2 / +0.013R V7) — nhưng yếu hơn 15m
   (15m: +0.026R V7, OOS 68.9% sau lọc volConfirm≥0.8).
4. XAUT/LLY (mới niêm yết, XAUT là gold-token) phá kết quả: XAUT 5m win 25.3%, LLY 38.8% —
   xác nhận mục 3.7: loại tài sản phi-crypto + symbol mới khỏi danh mục.
5. **Khuyến nghị cuối không đổi**: 15m V7+E10+volConfirm≥0.8 vẫn là phiên bản duy nhất có
   edge; E4/E5 trên cả 5m lẫn 15m đều không dùng được (chỉ winrate ảo).

### 3.15. ⭐ KHÁM PHÁ: model dự đoán "không pullback" từ indicator (feature_pullback.js, 2026-08-08)

**Ý tưởng**: nhóm "không pullback" (win 92.4% trong bản ảo) = momentum đủ mạnh để giá không
quay lại EMA20 trong 16 nến. Nếu dự đoán được từ indicator tại cf → lọc được nhóm winrate cao
mà KHÔNG cần nhìn tương lai.

**Phương pháp**: Logistic Regression (L2) trên 21 feature indicator liên tục tại cf
(không if/else đơn thuần — tổ hợp tuyến tính), nhãn Y = 1 nếu 16 nến tới không chạm EMA20.
Train < 2025, test ≥ 2025. N = 6.758 tín hiệu (23.6% là không-pullback).

**AUC từng feature (dự đoán không-pullback):**

| Feature | AUC | Ý nghĩa |
|---|---|---|
| **distEma** | **0.704** | giá cách EMA20 càng xa → khó pullback |
| emaAccel | 0.655 | EMA tăng tốc |
| emaSlope5 | 0.652 | EMA dốc 5 nến |
| volConfirm / volEntry | 0.624 / 0.623 | volume nến confirm / flip |
| rangePct | 0.599 | range nến cf |
| slowLeftPct | 0.588 | % bias slow còn lại |
| bodyPct / trailSpread | 0.576 / 0.572 | thân nến / giá xa trail2 |

**Logistic tổ hợp**: AUC train 0.747 | **AUC OOS 0.670** (trọng số lớn nhất: distEma 0.81,
slowLeftPct 0.44, rangePct 0.26, bodyPct -0.22).

**Kết quả lọc theo quantile train (exit E10, phí đủ, bản sạch V2):**

| Lọc | N | WIN | ExpR | PF | OOS WIN | OOS Exp |
|---|---|---|---|---|---|---|
| BASE (không lọc) | 6.758 | 67.1% | +0.017R | 1.05 | 66.1% | +0.011R |
| **Top 30% (dự đoán không-pullback)** | 2.030 | **71.5%** | **+0.080R** | **1.27** | **67.9%** | **+0.040R** |
| Top 40% | 2.712 | 71.2% | +0.076R | 1.26 | 68.7% | +0.055R |
| Top 20% | 1.357 | 71.2% | +0.071R | 1.24 | 66.0% | +0.012R |
| Bottom 30% (dự đoán CÓ pullback) | 1.971 | 60.8% | -0.073R | 0.81 | 60.4% | -0.076R |

**Kết luận — edge khôi phục được:**
1. Model phân biệt thật (không phải nhiễu): Top 30% dương (+0.080R) vs Bottom 30% âm
   (-0.073R) — chênh lệch rõ trên cả IS lẫn OOS.
2. **V2+E10+Top30% tốt hơn V7**: ExpR +0.080R (IS) / +0.040R (OOS) vs V7 +0.042R / -0.009R —
   đây là phiên bản khả thi live tốt nhất từ trước đến nay (feature toàn bộ ≤ cf).
3. **Feature chính = momentum**: distEma (giá xa EMA20) + EMA slope/accel + volume +
   % bias slow còn lại — khớp hoàn toàn bản chất "không pullback" = trend mạnh.
4. Có thể kết hợp thêm: top-30% + E4/E5 (thử lại) hoặc tinh chỉnh TP/SL cho nhóm này.

### 3.16. ⭐ TỐI ƯU PF/ExpR cho nhóm model Top-20% (pf_optimize*.js, 2026-08-08)

Phát hiện then chốt: **nhóm Top-20% model (momentum mạnh, không pullback) có trend chạy xa
→ TP càng xa càng lời** (ngược với nhóm chung). Grid TP/SL trên Top-20% (N=1.356, phí đủ):

| Exit | WIN | ExpR | PF | MaxDD | OOS WIN | OOS Exp | OOS PF |
|---|---|---|---|---|---|---|---|
| TP đơn 12%/SL2 | 34.5% | +0.413R | 1.67 | **42.8%** | 34.1% | +0.298R | 1.48 |
| TP đơn 10%/SL2 | 34.9% | +0.410R | 1.66 | 42.0% | 34.1% | +0.279R | 1.45 |
| **TP1=3%(66%)+BE, TP2=8%** | **46.9%** | **+0.314R** | **1.60** | 29.5% | **43.5%** | **+0.226R** | **1.41** |
| TP1=2.5%(66%)+BE, TP2=8% | 51.8% | +0.280R | 1.58 | 24.4% | 47.5% | +0.188R | 1.36 |
| TP1=2%(66%)+BE, TP2=10% | 57.0% | +0.222R | 1.51 | 25.4% | 51.0% | +0.108R | 1.22 |
| TP1=3%(66%)+BE, TP2=12% | 46.9% | +0.312R | 1.59 | 29.8% | 43.5% | +0.224R | 1.41 |
| E10 cũ (TP2=2%) | 71.3% | +0.078R | 1.26 | — | 67.3% | +0.033R | 1.10 |

**Kết luận:**
1. **Edge tăng ~4-7× so với E10 cũ**: TP1=3%+BE/TP2=8% đạt **+0.314R IS / +0.226R OOS,
   PF 1.60/1.41** (so với E10 cũ +0.078R/+0.033R). Lý do: nhóm momentum mạnh hiếm khi đảo
   ngay — TP 2% chốt non quá sớm, cắt mất phần trend lớn nhất.
2. **TP đơn rất xa (10-12%) có ExpR cao nhất (+0.41R)** nhưng MaxDD 42% + winrate 34% → rủi ro
   chuỗi thua dài, không nên dùng với risk cao.
3. **Điểm cân bằng tốt nhất: TP1=3%(đóng 2/3)+BE, TP2=8%, SL2%** — winrate 47%, ExpR +0.31R,
   MaxDD ~30% (ở risk 1%). OOS ổn định (43.5%/1.41) → không overfit.
4. Công thức mới đảo ngược quy tắc cũ: **với nhóm momentum mạnh, thắng lớn quan trọng hơn
   thắng nhiều** — ngược với kết luận E4/E5 (mục 3.14).

**Phiên bản chính thức v3 (khuyến nghị vận hành):**
- Entry: V2 (market tại cf) + **giữ Top-20% model** (logistic, feature ≤ cf)
- Exit: TP1=3% đóng 2/3 + kéo BE, TP2=8%, SL=2%
- Kết quả: IS 46.9% win / +0.314R / PF 1.60 | OOS 43.5% / +0.226R / PF 1.41 | MaxDD ~29.5%
- Nếu muốn an toàn hơn: TP1=2.5% → MaxDD 24.4%, ExpR +0.28R

### 3.17. ⭐ HMM REGIME FILTER — tăng edge cho v3 (hmm_edge.js, 2026-08-08)

**Phương pháp**: Gaussian HMM (3 state, Baum-Welch fit trên train <2025, forward-filter cận
nhân quả — không look-ahead) trên chuỗi [return, |return|] 15m từng symbol. State gán theo
mean return: State 0 = down (-0.0083%/nến), State 1 = range/trung tính (+0.0008%), State 2 =
up (+0.0061%).

**Kết quả trên phiên bản v3 (V2 + Top-20% + TP1=3%(66%)+BE/TP2=8%/SL2%):**

| Bộ lọc | N | WIN | ExpR | PF | MaxDD | OOS N | OOS WIN | OOS Exp | OOS PF |
|---|---|---|---|---|---|---|---|---|---|
| BASE (không HMM) | 1.356 | 46.9% | +0.314R | 1.60 | 29.5% | 455 | 43.5% | +0.226R | 1.41 |
| **State 1 (range/trung tính)** | 306 | **54.9%** | **+0.544R** | **2.34** | **10.5%** | 105 | **50.5%** | **+0.405R** | **1.94** |
| State 1+2 | 840 | 49.4% | +0.393R | 1.81 | 17.9% | 262 | 46.9% | +0.335R | 1.68 |
| State 1 + prev4 (regime bền) | 120 | 55.8% | +0.566R | 2.57 | 6.3% | 47 | 48.9% | +0.397R | 2.00 |
| State 0 (down) | 516 | 42.8% | +0.185R | 1.31 | 17.1% | 193 | 38.9% | +0.078R | 1.12 |
| State 2 (up) | 534 | 46.3% | +0.306R | 1.58 | 15.1% | 157 | 44.6% | +0.289R | 1.55 |

**Kết luận:**
1. **HMM state 1 (range) bất ngờ là tốt nhất** — không phải trend up (state 2). Lý do: nhóm
   Top-20% model là momentum cực mạnh; khi nó xuất hiện trong state range (sóng trung bình
   ~0), nghĩa là bắt được sóng con đang hình thành trong biên độ ổn định → ít bị quét SL,
   giá chạy đủ xa để chạm TP1=3%/TP2=8%. Ngược lại state up có thể đã chạy quá nóng (mua
   đỉnh cục bộ), state down là ngược trend.
2. **Cải thiện lớn**: OOS ExpR +0.226R → **+0.405R** (+79%), OOS PF 1.41 → **1.94**, MaxDD
   29.5% → **10.5%** (giảm 3 lần) — cả winrate lẫn lợi nhuận đều tăng.
3. **State 1+prev4 (regime bền 5 nến)** cho PF cao nhất (2.57/2.00) nhưng N=120 quá nhỏ —
   chỉ tham khảo. Khuyến nghị dùng **State 1 đơn** (N=306, OOS N=105 đủ tin).
4. **Phiên bản chính thức v4 (khuyến nghị vận hành):**
   - Entry: V2 (market tại cf) + Top-20% logistic + **HMM state 1**
   - Exit: TP1=3% đóng 2/3 + BE, TP2=8%, SL=2%
   - Kết quả: IS 54.9% / +0.544R / PF 2.34 / MaxDD 10.5% | OOS 50.5% / +0.405R / PF 1.94
   - So với v3: ExpR +73%, PF +38%, MaxDD giảm 3×, winrate +8pp

### 3.18. ⭐ MONTE CARLO VỐN CHO V4 (montecarlo_v4.js, 2026-08-08)

Trades V4 (HMM state 1): N=306 (54.9% win, +0.544R, PF 2.34, MaxDD 10.5%), 5.6 năm, 54
lệnh/năm (≈4.5 lệnh/tháng). **Kelly thực nghiệm f\* = 29.9% risk/lệnh** (tối đa lý thuyết
1 lệnh 1 lúc — quá cao, không dùng trực tiếp). MC 10.000 lần xáo trộn (MaxDD/chuỗi thua)
+ 20.000 bootstrap tháng (lợi nhuận tháng):

**21 symbol hiện tại (≈4.5 lệnh/tháng):**

| Risk/lệnh | MaxDD-med | MaxDD-P95 | StreakL-P95 | Tháng-med | Tháng-P5 | % tháng âm | Tháng-P95 |
|---|---|---|---|---|---|---|---|
| 0.25% | 1.7% | 2.6% | 10 | +0.8% | -0.6% | 17.2% | +1.9% |
| 0.5% | 3.4% | 5.1% | 10 | +1.5% | -1.2% | 18.1% | +3.7% |
| **1.0%** | 6.7% | 10.1% | 10 | +3.0% | -2.4% | 17.8% | +7.6% |
| 2.0% | 13.0% | 19.2% | 9 | +6.1% | -4.8% | 17.6% | +15.9% |
| 3.0% | 19.0% | 27.6% | 9 | +8.4% | -7.2% | 18.2% | +24.2% |
| 5.0% | 30.2% | 42.5% | 9 | +14.6% | -12.2% | 18.1% | +42.7% |

**Dự phóng 300 symbol (≈65 lệnh/tháng):**

| Risk/lệnh | MaxDD-med | MaxDD-P95 | Tháng-med | Tháng-P5 | % tháng âm | Tháng-P95 |
|---|---|---|---|---|---|---|
| 0.25% | 1.7% | 2.6% | +9.2% | +4.4% | 0.1% | +14.3% |
| 0.5% | 3.4% | 5.2% | +19.1% | +8.9% | 0.1% | +30.5% |
| **1.0%** | 6.7% | 10.1% | +41.5% | +18.2% | 0.1% | +69.5% |
| 2.0% | 13.1% | 19.4% | +96.9% | +37.9% | 0.1% | +182% |
| 3.0% | 19.1% | 27.7% | +171.8% | +60.2% | 0.1% | +366% |

**Kết luận phân phối vốn hợp lý:**
1. **Chuỗi thua 9-10 lệnh là mức tối đa 95%** (không đổi theo risk) → risk/lệnh phải nhỏ
   hơn 1/9 quỹ chịu lỗ. Risk 1% → tháng âm tối đa P5 chỉ -2.4% (21 symbol).
2. **Kelly f\* = 29.9% chỉ đúng cho 1 lệnh 1 lúc** — với vị thế song song phải chia cho số
   vị thế TB (~4.5 lệnh mở, tối đa ~10) → **risk thực dụng 1-3%/lệnh** (≈ 1/10 Kelly).
3. **Khuyến nghị: risk 1% equity/lệnh** (21 symbol: MaxDD P95 10%, tháng P5 -2.4%;
   300 symbol: MaxDD P95 10%, tháng P5 +18%, tháng âm 0.1%). Risk 2% chấp nhận được nếu
   vốn mạnh (MaxDD P95 ~19-20%).
4. **Tỷ trọng vị thế = risk% / SL%**: SL cố định 2% → vị thế = 50% equity (leverage 0.5x)
   ở risk 1%; tổng risk các vị thế mở ≤ 20% equity (mục 3.10).
5. Cảnh báo phương pháp: MC xáo trộn không đổi tổng lợi nhuận cuối (tích giao hoán) — chỉ
   dùng cho MaxDD/chuỗi thua; bootstrap tháng dùng cho phân phối lợi nhuận. Không mô phỏng
   tương quan crash toàn thị trường (xem mục 3.11 — kịch bản 20 vị thế cùng SL).

---

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
| 2026-08-08 | ⭐ Monte Carlo vốn v4 (montecarlo_v4.js): Kelly f*=29.9% (1 lệnh 1 lúc); khuyến nghị risk 1%/lệnh (21s: MaxDD-P95 10%, tháng-P5 -2.4%; 300s: tháng-P5 +18%, âm 0.1%); chuỗi thua P95 = 9-10 (mục 3.18) |
| 2026-08-08 | ⭐ HMM REGIME FILTER (hmm_edge.js): 3-state Gaussian HMM, fit train + forward-filter; State 1 (range) trên v3 → IS 54.9%/+0.544R/PF2.34/MaxDD10.5%, OOS 50.5%/+0.405R/PF1.94 — phiên bản chính thức v4 (mục 3.17) |
| 2026-08-08 | ⭐ TỐI ƯU PF/ExpR (pf_optimize.js): Top-20% model + TP1=3%(66%)+BE/TP2=8% → IS +0.314R/PF1.60, OOS +0.226R/PF1.41 — edge tăng 4-7x; phiên bản chính thức v3 (mục 3.16) |
| 2026-08-08 | ⭐ KHÁM PHÁ model dự đoán không-pullback (feature_pullback.js): Logistic trên 21 feature indicator, AUC OOS 0.67; V2+E10+Top30% → win 71.5%, Exp +0.080R, OOS +0.040R — edge khôi phục (mục 3.15) |
| 2026-08-08 | Test E4/E5 5m (clean_grid.js, 11 symbol cache): E4 hòa vốn (ExpR ~0), E5 âm (-0.06..-0.09R) — winrate cao là ảo, chỉ E10 còn edge (mục 3.14) |
| 2026-08-08 | ✅ BẢN SẠCH CHÍNH THỨC (backtest_clean.js): V7+E10 = 66.5%/+0.026R/PF1.08, OOS 65.1%; chỉ E10 còn edge; +volConfirm≥0.8 → OOS 68.9% (mục 3.13) |
| 2026-08-08 | ⚠️ PHÁT HIỆN LOOK-AHEAD BIAS (entry_fix2.js): nhánh "vào cf khi không pullback" (60% lệnh, win 92.4% ảo) — kết quả thật chỉ 68% (V7); các kết quả trước phải tái lập (mục 3.12) |
| 2026-08-08 | Monte Carlo + dự phóng 300 symbol (montecarlo.js): tháng TB +60-130%, xác suất tháng âm ~2-3%, nguy cơ -60% khi range dài (mục 3.11) |
| 2026-08-08 | MM grid (mm_grid2.js): Kelly f*=39-50% không khả thi cho đa vị thế; Fixed 1% = tối ưu thực dụng (E10: 246% CAGR/7.5% DD); martingale/anti-mart bị loại (mục 3.10) |
| 2026-08-08 | Grid TP/SL 19 cấu hình (tpsl_grid.js): SL ATR bị loại; E4 TP1=0.75(67%)+BE/TP2=2 → win 85.8%, OOS 85.1%; E10 giữ ExpR 0.269R (mục 3.9) |
| 2026-08-08 | Phân tích lệnh sai VBT (loser_analysis.js): cycleAge≤2 + không hồi + volConfirm≥0.8 + ATR≥0.3% → win 70→81%, OOS 81.3% (mục 3.8) |
| 2026-08-08 | Test hạng 9-10/99-100/200-201 volume × 5m/15m (test_ranks.js v2): SAGA 5m/15m khớp baseline; 5/6 symbol mới 2026 mẫu nhỏ (mục 3.7) |
| 2026-08-08 | Test thứ hạng volume × timeframe (test_ranks.js): 15m dương 6/6, 5m 5/6 (chi tiết mục 3.6) |
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
