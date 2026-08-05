# Custom indicators on Advanced Chart

Tài liệu này mô tả **đúng theo mã JavaScript đang được nạp bởi Advanced Chart**:

- `chart/custom_studies/atr-bot.js` — `createATRBot`
- `chart/custom_studies/vsr.js` — `createVSR`

Hai tệp này được nhúng trong `index.html` và được truyền vào `custom_indicators_getter` của TradingView Charting Library. Công thức dưới đây mô tả hành vi thực tế của implementation hiện tại, kể cả cách khởi tạo và các khác biệt có thể có so với chỉ báo cùng tên trên TradingView/Pine Script khác.

## Quy ước

Ở nến thứ `t`:

- `O_t`, `H_t`, `L_t`, `C_t`, `V_t`: open, high, low, close, volume.
- `x_t`: chuỗi nguồn giá (source) đã chọn.
- `N`: độ dài (length) tương ứng.
- Giá trị `NaN` không được vẽ trên biểu đồ.
- Một cửa sổ/buffer luôn giữ tối đa `N` giá trị mới nhất, theo thứ tự cũ → mới. Trong giai đoạn đầu chưa đủ dữ liệu, các phép trung bình dùng tất cả dữ liệu hiện có, trừ khi mục riêng nói khác.

---

## 1. ATR Bot

### Đầu vào và giá trị mặc định

| Input | Mặc định | Phạm vi | Ý nghĩa |
| --- | ---: | --- | --- |
| `ATR Length` (`tf_atr_length`) | 14 | 1–500 | Chu kỳ làm mượt ATR. |
| `ATR Multiplier` (`tf_atr_mult`) | 2.0 | 0.1–10.0 | Hệ số khoảng cách ATR của trailing line. |
| `Source` | `close` | `open`, `high`, `low`, `close`, `hl2`, `hlc3`, `ohlc4` | Nguồn để tính `Trail 1`. |
| `MA Type` | `EMA` | 16 lựa chọn | Phương pháp tính `Trail 1`. |
| `MA Length` (`ma_length`) | 30 | 1–500 | Chu kỳ MA. Riêng SWMA luôn dùng 4 nến. |

### Kết quả vẽ

Chỉ báo nằm trên đồ thị giá và trả bốn plots:

| Plot | Giá trị | Hiển thị mặc định |
| --- | --- | --- |
| `Trail 1 (MA)` | `trail1_t` | Đường xanh ngọc `#26a69a`, dày 2. |
| `Trail 2 (ATR Trail)` | `trail2_t` | Đường đỏ `#ef5350`, dày 2. |
| `Trail 1 Green` | `trail1_t` khi `trail1_t > trail2_t`, ngược lại `NaN` | Dùng làm biên vùng tô xanh. |
| `Trail 1 Red` | `trail1_t` khi `trail1_t <= trail2_t`, ngược lại `NaN` | Dùng làm biên vùng tô đỏ. |

Vùng giữa Trail 1 và Trail 2 được tô xanh (85% trong suốt) khi Trail 1 ở trên Trail 2, và đỏ khi Trail 1 ở dưới hoặc bằng Trail 2. Chỉ báo **không tạo plot buy/sell riêng**; trạng thái được thể hiện bằng vị trí tương đối và màu vùng tô.

### Bước 1 — Chọn nguồn giá `x_t`

| Source | Công thức |
| --- | --- |
| `open` | `x_t = O_t` |
| `high` | `x_t = H_t` |
| `low` | `x_t = L_t` |
| `close` (mặc định) | `x_t = C_t` |
| `hl2` | `x_t = (H_t + L_t) / 2` |
| `hlc3` | `x_t = (H_t + L_t + C_t) / 3` |
| `ohlc4` | `x_t = (O_t + H_t + L_t + C_t) / 4` |

### Bước 2 — Tính `Trail 1`

`Trail 1` là MA của `x`. Phần này liệt kê đúng công thức cho từng lựa chọn trong mã hiện tại.

#### EMA

Với `α = 2 / (N + 1)`:

```text
Trail1_0 = x_0
Trail1_t = α × x_t + (1 - α) × Trail1_(t-1)
```

#### VWMA

Trên cửa sổ `W_t` gồm tối đa `N` cặp `(x_i, V_i)` gần nhất:

```text
Trail1_t = Σ(x_i × V_i) / ΣV_i
```

Nếu `ΣV_i = 0`, mã dùng `x_t` thay cho kết quả chia.

#### LWMA và WMA

Hai lựa chọn này có cùng implementation. Nếu cửa sổ hiện có `m` phần tử `[x_1, ..., x_m]`, trong đó `x_m` là mới nhất, trọng số là `1, 2, ..., m`:

```text
Trail1_t = Σ(i × x_i) / Σi,  i = 1..m
```

Do đó nến mới nhất luôn có trọng số cao nhất. Khi đủ dữ liệu, `m = N`.

#### HMA

Mã cũng có nhánh `HULL`, nhưng UI hiện chỉ cung cấp lựa chọn `HMA`.

```text
nHalf = floor(N / 2)
nSqrt = floor(sqrt(N))
raw_t = 2 × WMA(x, nHalf)_t - WMA(x, N)_t
Trail1_t = WMA(raw, nSqrt)_t
```

Mỗi WMA ở trên là WMA theo đúng cách tính trọng số tăng dần đã nêu. Các cửa sổ con cũng dùng dữ liệu sẵn có ở đầu chuỗi; không chờ đủ `N` nến mới xuất giá trị.

#### VWAP (rolling)

Đây là VWAP trượt theo `MA Length`, không phải VWAP reset theo phiên:

```text
pTypical_i = (H_i + L_i + C_i) / 3
Trail1_t = Σ(pTypical_i × V_i) / ΣV_i
```

Tổng lấy trên tối đa `N` nến gần nhất. Nếu tổng volume bằng 0, kết quả là `x_t` (nguồn đã chọn), không phải `pTypical_t`.

#### ALMA

Mã cố định `offset = 0.85`, `sigma = 6`:

```text
m = floor(0.85 × (N - 1))
s = N / 6
w_i = exp(-(i - m)^2 / (2 × s^2))
Trail1_t = Σ(x_i × w_i) / Σw_i
```

`i` là vị trí trong buffer hiện có, từ 0 (cũ nhất) đến `buffer.length - 1` (mới nhất). `m` vẫn dựa trên `N` đã cấu hình, kể cả lúc buffer chưa đủ `N` nến.

#### TEMA

Với `α = 2 / (N + 1)`, ba EMA cùng được khởi tạo bằng `x_0`:

```text
EMA1_t = α × x_t    + (1 - α) × EMA1_(t-1)
EMA2_t = α × EMA1_t + (1 - α) × EMA2_(t-1)
EMA3_t = α × EMA2_t + (1 - α) × EMA3_(t-1)
Trail1_t = 3 × EMA1_t - 3 × EMA2_t + EMA3_t
```

#### WWSMA

Khi buffer có ít hơn `N` nến, `Trail 1` là SMA của mọi giá trị hiện có:

```text
Trail1_t = Σx_i / m
```

Từ lúc buffer đạt `N`, code áp dụng Wilder smoothing bằng giá trị Trail 1 của nến trước:

```text
Trail1_t = (Trail1_(t-1) × (N - 1) + x_t) / N
```

Vì giá trị trước đó trong implementation đã là trung bình của giai đoạn chưa đủ dữ liệu, seed thực tế không đợi một giá trị RMA chuẩn riêng biệt.

#### ZLEMA

```text
lag = floor((N - 1) / 2)
z_t = x_t + (x_t - x_(t-lag))
α = 2 / (N + 1)
Trail1_t = α × z_t + (1 - α) × Trail1_(t-1)
```

Trước khi buffer có quá `lag` phần tử, mã dùng `z_t = x_t`. Sau đó `x_(t-lag)` là phần tử đầu buffer; buffer giữ tối đa `lag + 1` phần tử. Giá trị đầu tiên của EMA là `z_t`.

#### LSMA

Trên `m` giá trị trong buffer, đánh chỉ số thời gian `i = 0..m-1` (cũ → mới):

```text
slope = (m × Σ(i × x_i) - Σi × Σx_i) / (m × Σ(i²) - (Σi)²)
intercept = (Σx_i - slope × Σi) / m
Trail1_t = intercept + slope × (m - 1)
```

Nghĩa là giá trị fitted line ở nến mới nhất. Khi chỉ có một phần tử, kết quả là `x_t`.

#### KAMA

Buffer giữ tối đa `N + 1` nguồn giá. Khi buffer có hơn `N` phần tử:

```text
change = |x_t - x_(t-N)|
volatility = Σ|x_i - x_(i-1)|,  trên N thay đổi trong buffer
ER = change / volatility              (0 nếu volatility = 0)
fast = 2 / 3
slow = 2 / 31
SC = (ER × (fast - slow) + slow)²
Trail1_t = KAMA_(t-1) + SC × (x_t - KAMA_(t-1))
```

Ở lần đầu buffer vừa có `N + 1` giá trị, `KAMA_(t-1)` chưa được lưu nên mã seed bằng `x_t`. Trước thời điểm đó, output cũng là `x_t`.

#### VIDYA

Buffer giữ tối đa `N + 1` giá trị. Từ các chênh lệch liên tiếp trong buffer:

```text
up   = Σ max(x_i - x_(i-1), 0)
down = Σ max(x_(i-1) - x_i, 0)
CMO = |(up - down) / (up + down)|     (0 nếu mẫu số = 0)
α = (2 / (N + 1)) × CMO
Trail1_t = α × x_t + (1 - α) × Trail1_(t-1)
```

Giá trị đầu tiên là `x_0`.

#### SMMA

Trong `N - 1` nến đầu, output là trực tiếp `x_t`, không phải SMA. Khi đã nhận đủ `N` giá trị, code seed bằng SMA `N` kỳ rồi tiếp tục:

```text
Trail1_t = (Trail1_(t-1) × (N - 1) + x_t) / N
```

#### McGinley

```text
ratio = x_t / Trail1_(t-1)
Trail1_t = Trail1_(t-1) + (x_t - Trail1_(t-1)) / (N × ratio^4)
```

Giá trị đầu tiên là `x_0`. Mã không có guard cho trường hợp Trail 1 trước đó bằng 0 hoặc ratio bất thường.

#### SWMA

Lựa chọn này bỏ qua `MA Length` và luôn dùng 4 phần tử gần nhất:

```text
Trail1_t = (x_(t-3) + 2×x_(t-2) + 2×x_(t-1) + x_t) / 6
```

Trước khi có đủ 4 nến, output là `x_t`.

### Bước 3 — True Range và ATR

ATR luôn dùng `H`, `L`, `C` của OHLC, độc lập với `Source` chọn cho Trail 1.

```text
TR_0 = H_0 - L_0
TR_t = max(H_t - L_t, |H_t - C_(t-1)|, |L_t - C_(t-1)|)
```

ATR dùng Wilder RMA, nhưng được seed ngay bằng True Range đầu tiên:

```text
ATR_0 = TR_0
ATR_t = (ATR_(t-1) × (ATR Length - 1) + TR_t) / ATR Length
SL_t = ATR_t × ATR Multiplier
```

Do cách seed này, giá trị đầu kỳ là RMA khởi tạo từ `TR_0`; code không đợi đủ `ATR Length` nến để seed bằng SMA của TR.

### Bước 4 — Tính `Trail 2` (ATR trailing line)

Đặt:

```text
P_t = Trail1_t
Q_t = Trail2_t
S_t = SL_t
```

`Q_(t-1)` khi chưa tồn tại được thay bằng `0`; `P_(t-1)` khi chưa tồn tại được thay bằng `P_t`. Logic chính xác của mã:

```text
nếu P_t > Q_(t-1):
    nếu P_(t-1) > Q_(t-1):
        Q_t = max(Q_(t-1), P_t - S_t)
    ngược lại:
        Q_t = P_t - S_t
ngược lại:
    nếu P_t < Q_(t-1) và P_(t-1) < Q_(t-1):
        Q_t = min(Q_(t-1), P_t + S_t)
    ngược lại:
        Q_t = P_t + S_t
```

Hệ quả:

- Khi `Trail 1` ở trên Trail 2 trong hai nến liên tiếp, Trail 2 chỉ có thể đi ngang hoặc tăng (`max`): trailing support.
- Khi `Trail 1` ở dưới Trail 2 trong hai nến liên tiếp, Trail 2 chỉ có thể đi ngang hoặc giảm (`min`): trailing resistance.
- Khi Trail 1 đổi phía so với Trail 2, Trail 2 được reset sang `Trail 1 − SL` (đổi sang phía trên) hoặc `Trail 1 + SL` (đổi sang phía dưới).
- So sánh là nghiêm ngặt. Nếu `P_t == Q_(t-1)`, code đi vào nhánh `ngược lại` và tính `Q_t = P_t + S_t` trừ khi điều kiện downtrend liên tiếp vẫn đúng (điều đó không thể xảy ra khi bằng nhau ở nến hiện tại).

---

## 2. VSR — Volume Spike Reversal

### Đầu vào và kết quả vẽ

| Input | Mặc định | Phạm vi | Ý nghĩa |
| --- | ---: | --- | --- |
| `Volume SD Length` (`vsr2_length`) | 10 | 1–500 | Số thay đổi volume giữ trong cửa sổ tính độ lệch chuẩn. |
| `Volume Threshold` (`vsr2_threshold`) | 10.0 | 1.0–20.0 | Ngưỡng tuyệt đối để tạo/cập nhật vùng. |

Chỉ báo vẽ trên giá hai đường độ rộng 0: `VSR Upper` và `VSR Lower`; khoảng giữa chúng được tô vàng `#FFEB3B` với 50% trong suốt. Một vùng đang tồn tại được trả lại ở mọi nến sau đó nên kéo dài đến mép phải biểu đồ, cho tới khi một tín hiệu VSR mới thay hoặc gộp nó.

### Bước 1 — Tỷ lệ thay đổi volume

```text
change_0 = 0
change_t = V_t / V_(t-1) - 1,  nếu V_(t-1) hợp lệ và khác 0
change_t = 0,                  nếu không
```

Sau đó `change_t` được thêm vào buffer; khi vượt `Volume SD Length = N`, phần tử cũ nhất bị loại.

### Bước 2 — Độ lệch chuẩn của volume change

Nếu buffer hiện tại có ít hơn 2 phần tử, code đặt `stdev_t = 0`. Nếu có `m ≥ 2` phần tử `d_i`:

```text
mean_t = Σd_i / m
stdev_t = sqrt(Σ(d_i - mean_t)² / m)
```

Đây là **population standard deviation** (chia cho `m`), không phải sample standard deviation (chia cho `m - 1`). Cửa sổ luôn bao gồm thay đổi volume của nến hiện tại.

### Bước 3 — Tín hiệu VSR

Tín hiệu không chia cho độ lệch chuẩn vừa tính trên nến hiện tại, mà chia cho độ lệch chuẩn đã lưu của **nến trước**:

```text
difference_t = change_t / stdev_(t-1)
signal_t = |difference_t|
```

Nếu `stdev_(t-1)` là `0`, `NaN`, hoặc buffer chưa có ít nhất 2 phần tử, cả `difference_t` và `signal_t` giữ giá trị `0`. Điều kiện spike là nghiêm ngặt:

```text
signal_t > Volume Threshold
```

Vì cần `stdev` của nến trước không bằng 0, thông thường chỉ báo sớm nhất có thể kích hoạt từ nến thứ ba có dữ liệu volume hợp lệ (chỉ số 0-based là `t = 2`).

### Bước 4 — Tạo/cập nhật vùng giá

Khi có spike tại nến `t`, VSR **lấy OHLC của nến trước đó** (`t - 1`) để đề xuất vùng:

```text
proposedUpper_t = max(H_(t-1), C_(t-1))
proposedLower_t = min(L_(t-1), C_(t-1))
```

Với dữ liệu OHLC chuẩn (`L ≤ C ≤ H`), đây chính là `[L_(t-1), H_(t-1)]`, tức toàn bộ biên độ nến trước. Việc dùng `max/min` vẫn là công thức chính xác mã thực thi.

Chỉ có **một vùng VSR đang hoạt động**, không phải danh sách nhiều vùng lịch sử. Gọi vùng hiện có là `[lower, upper]`:

```text
overlap = proposedLower ≤ upper và lower ≤ proposedUpper
```

| Trạng thái | Cập nhật |
| --- | --- |
| Chưa có vùng hoặc không overlap | `upper = proposedUpper`, `lower = proposedLower` — vùng cũ bị thay thế. |
| Overlap | `upper = max(upper, proposedUpper)` và `lower = min(lower, proposedLower)` — gộp hai vùng thành union. |
| Không có spike | Giữ nguyên upper/lower của vùng hiện tại. |

Ngay sau khi xử lý, code lưu `V_t`, `H_t`, `L_t`, `C_t` và `stdev_t` làm dữ liệu trước cho nến kế tiếp, rồi trả `[upper, lower]`.

### Các chi tiết quan trọng để tái tạo chính xác

- Vùng xuất hiện ở **nến phát hiện spike** `t`, nhưng mức giá của nó được lấy từ nến `t - 1`.
- Ngưỡng là `>` chứ không phải `≥`.
- `change_t` có thể âm khi volume giảm mạnh; phép `abs` làm cả tăng và giảm volume đều có thể kích hoạt VSR.
- Code không kiểm tra volume hiện tại bằng 0. Chỉ volume trước bằng 0 mới khiến `change_t = 0`.
- Biến `bars_buffer` có trong source nhưng không tham gia vào tính toán output hay logic vùng; nó không ảnh hưởng kết quả.
- Cụm "No repaint" không xuất hiện ở `vsr.js`. Bản đang nạp này tính zone từ nến trước. Tệp `vsr_1.js` có biến thể dùng nến hiện tại, nhưng hàm trong tệp là `createVSROriginal` trong khi app tìm `createVSR_1`, nên biến thể đó hiện không được đăng ký thành study trên chart.
