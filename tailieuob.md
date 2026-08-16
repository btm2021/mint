# Đặc tả kỹ thuật: Phát hiện và hiển thị Order Block trên Lightweight Charts

## 1. Mục tiêu

Xây dựng một module tự động:

```text
OHLC candles
    ↓
xác định đỉnh / đáy
    ↓
phát hiện quét đỉnh / đáy
    ↓
phát hiện cú chạy mạnh
    ↓
xác nhận phá mốc quan trọng
    ↓
truy ngược vùng xuất phát
    ↓
Order Block
    ↓
theo dõi trạng thái
    ↓
vẽ vùng trên Lightweight Charts
```

Nguyên tắc cốt lõi:

> **Không tìm Order Block bằng cách quét tất cả nến ngược màu.
> Trước tiên phải tìm một sự kiện giá có ý nghĩa, sau đó truy ngược lại nơi sự kiện đó bắt đầu.**

Một Order Block chất lượng cao phải có tối thiểu:

```text
1. Quét một đỉnh hoặc đáy đáng chú ý
        ↓
2. Giá rời vùng rất mạnh
        ↓
3. Cú chạy phá một đỉnh/đáy quan trọng
        ↓
4. Truy ngược về vùng xuất phát
        ↓
5. Đánh dấu vùng đó thành Order Block
```

---

# 2. Yêu cầu quan trọng nhất: không được nhìn tương lai

Thuật toán phải hoạt động giống nhau trong:

* dữ liệu lịch sử;
* backtest;
* dữ liệu realtime;
* WebSocket.

Không được xác nhận Order Block trước khi sự kiện phá cấu trúc thực sự xảy ra.

Ví dụ:

```text
t0   t1   t2   t3   t4   t5
              ↑
              vùng xuất phát

                         ↑
                   phá đỉnh tại t5
```

Order Block có thể bắt đầu tại `t2`, nhưng:

```text
createdAt   = t2
confirmedAt = t5
```

**Chỉ tại t5 hệ thống mới được phép công bố Order Block.**

Không được sử dụng thông tin từ t6, t7... để quyết định rằng vùng tại t2 đã hợp lệ ở t2.

---

# 3. Dữ liệu đầu vào

Module chính chỉ cần OHLC.

```ts
interface Candle {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;

    volume?: number;
}
```

`time` nên thống nhất toàn hệ thống, ví dụ Unix timestamp theo giây.

Volume là tùy chọn.

Phiên bản đầu tiên **không cần volume để xác định OB**.

---

# 4. Các module cần xây dựng

Tách thuật toán thành các module độc lập:

```text
CandleData
   │
   ├── ATR
   │
   ├── SwingDetector
   │
   ├── LiquiditySweepDetector
   │
   ├── DisplacementDetector
   │
   ├── StructureBreakDetector
   │
   ├── OrderBlockDetector
   │
   ├── OrderBlockLifecycle
   │
   └── OrderBlockRenderer
```

Không viết tất cả logic vào một hàm duy nhất.

---

# 5. ATR — đơn vị chuẩn hóa chuyển động giá

Không nên sử dụng các giá trị cố định như:

```text
BTC phải chạy 500 USD
ETH phải chạy 20 USD
```

Thay vào đó sử dụng ATR.

Ví dụ:

```ts
ATR_PERIOD = 14;
```

Từ đó mọi điều kiện có thể viết dạng:

```text
0.05 ATR
0.5 ATR
0.8 ATR
1.5 ATR
```

Điều này giúp thuật toán hoạt động trên nhiều:

* coin;
* mức giá;
* khung thời gian;
* mức biến động.

---

# 6. Bước 1 — xác định đỉnh và đáy

Ta cần tìm những điểm mà giá thực sự quay đầu.

## Đỉnh

Một candle `i` là đỉnh khi:

```text
high[i] > high của N candle bên trái
và
high[i] >= high của N candle bên phải
```

Ví dụ với:

```ts
leftBars = 3;
rightBars = 3;
```

Ta kiểm tra:

```text
             i
             ●
          /     \
        /         \
      /             \

3 candle            3 candle
bên trái            bên phải
```

Pseudo-code:

```ts
function isSwingHigh(candles, i, left = 3, right = 3) {
    const h = candles[i].high;

    for (let j = 1; j <= left; j++) {
        if (candles[i - j].high >= h) return false;
    }

    for (let j = 1; j <= right; j++) {
        if (candles[i + j].high > h) return false;
    }

    return true;
}
```

Đáy hoàn toàn ngược lại.

```ts
function isSwingLow(candles, i, left = 3, right = 3) {
    const l = candles[i].low;

    for (let j = 1; j <= left; j++) {
        if (candles[i - j].low <= l) return false;
    }

    for (let j = 1; j <= right; j++) {
        if (candles[i + j].low < l) return false;
    }

    return true;
}
```

---

# 7. Lưu ý về xác nhận đỉnh/đáy

Nếu sử dụng:

```text
rightBars = 3
```

thì đỉnh tại candle `i` chỉ được xác nhận khi:

```text
i + 3
```

đã xuất hiện.

Đây là hành vi bình thường.

Không được đánh dấu swing tại `i` ngay khi candle `i` vừa đóng.

Data model:

```ts
interface SwingPoint {
    index: number;
    time: number;
    price: number;

    type: 'high' | 'low';

    confirmedAtIndex: number;
}
```

---

# 8. Bước 2 — tìm vùng có nhiều lệnh dễ tập trung

Phiên bản đầu tiên không cần cố đoán số lượng lệnh thật.

Ta chỉ xác định các vị trí dễ có nhiều người quan sát:

```text
swing high
swing low
đỉnh cũ
đáy cũ
hai đỉnh gần nhau
hai đáy gần nhau
```

Đặc biệt ưu tiên những swing chưa từng bị vượt qua.

Ví dụ:

```text
                  swing high
                      ●
                     / \
                    /   \
                   /     \


swing low
────────●────────────────────────
```

Lưu:

```ts
interface LiquidityLevel {
    id: string;

    type: 'high' | 'low';

    price: number;
    swingIndex: number;

    swept: boolean;
    sweptAtIndex?: number;
}
```

---

# 9. Bước 3 — xác định việc chọc qua đỉnh/đáy rồi quay lại

## Trường hợp tìm vùng mua

Ta quan sát một đáy cũ:

```text
────────────── đáy cũ ──────────────

                     \
                      \
                       ●
```

Giá phải chọc xuống dưới đáy.

Nhưng chỉ việc:

```text
low < đáy cũ
```

chưa đủ.

Ta muốn giá quay trở lại phía trên.

Điều kiện:

```ts
low < previousSwingLow - buffer
AND
close > previousSwingLow
```

Trong đó:

```ts
buffer = ATR * 0.05;
```

Ví dụ:

```text
đáy cũ
───────────────────────

                    │
                    │
                    ● ← low xuống dưới
                    │
                    █
                    █ ← close lại trên đáy
```

Pseudo-code:

```ts
bullishSweep =
    candle.low < swingLow.price - atr * sweepBufferAtr
    &&
    candle.close > swingLow.price;
```

---

# 10. Trường hợp tìm vùng bán

Ngược lại:

```ts
bearishSweep =
    candle.high > swingHigh.price + atr * sweepBufferAtr
    &&
    candle.close < swingHigh.price;
```

Hình thái:

```text
                    ●
                    │
                    │
────────────────────── đỉnh cũ
                    █
                    █ ← đóng lại bên dưới
```

---

# 11. Không bắt buộc việc quay lại xảy ra trong cùng một candle

Có thể cho phép:

```ts
sweepRecoveryBars = 2;
```

Ví dụ:

```text
candle 1:
chọc xuống

candle 2:
đóng trở lại trên đáy
```

Vẫn có thể tính là một lần quét hợp lệ.

Data:

```ts
interface SweepEvent {
    direction: 'bullish' | 'bearish';

    levelId: string;
    levelPrice: number;

    sweepIndex: number;
    recoveryIndex: number;

    extremePrice: number;
}
```

---

# 12. Bước 4 — tìm cú chạy mạnh

Sau khi xuất hiện sweep, giá phải rời khu vực đó đủ mạnh.

Đây là bộ lọc quan trọng.

Không dùng:

```text
có một candle xanh
```

làm điều kiện.

Phải đo toàn bộ cú chạy.

---

# 13. Điều kiện cú chạy mạnh

Thiết lập mặc định khởi đầu:

```ts
displacementWindow = 3;

minMoveATR = 1.5;

minLargeBodyATR = 0.8;

minDirectionalBodyRatio = 0.65;
```

Các giá trị trên phải đặt trong config để backtest và tối ưu sau này.

---

# 14. Điều kiện 1: tổng quãng đường

Bullish:

```ts
move =
    candles[end].close -
    candles[start].open;
```

Yêu cầu:

```ts
move >= ATR[start] * 1.5
```

Bearish:

```ts
move =
    candles[start].open -
    candles[end].close;
```

---

# 15. Điều kiện 2: phải có ít nhất một candle thân lớn

Thân nến:

```ts
body = Math.abs(close - open);
```

Trong cửa sổ chạy mạnh phải tồn tại ít nhất một candle:

```ts
body >= ATR * 0.8
```

Điều này tránh trường hợp giá bò từ từ:

```text
  █
   █
    █
     █
      █
```

mà vẫn đạt tổng khoảng cách lớn.

---

# 16. Điều kiện 3: phần lớn lực phải cùng hướng

Bullish:

```ts
positiveBody =
    Σ max(close - open, 0);

allBody =
    Σ abs(close - open);

ratio =
    positiveBody / allBody;
```

Yêu cầu:

```ts
ratio >= 0.65
```

Bearish:

```ts
negativeBody =
    Σ max(open - close, 0);

ratio =
    negativeBody / allBody;
```

---

# 17. Hàm phát hiện cú chạy mạnh

Pseudo-code:

```ts
function detectBullishDisplacement(
    candles,
    start,
    end,
    atr
) {
    const netMove =
        candles[end].close -
        candles[start].open;

    if (netMove < atr[start] * 1.5)
        return false;

    let bullishBody = 0;
    let totalBody = 0;
    let largestBody = 0;

    for (let i = start; i <= end; i++) {
        const body =
            Math.abs(
                candles[i].close -
                candles[i].open
            );

        totalBody += body;

        if (
            candles[i].close >
            candles[i].open
        ) {
            bullishBody += body;
        }

        largestBody =
            Math.max(largestBody, body);
    }

    if (
        largestBody <
        atr[start] * 0.8
    ) {
        return false;
    }

    if (
        totalBody === 0 ||
        bullishBody / totalBody < 0.65
    ) {
        return false;
    }

    return true;
}
```

Bearish đối xứng.

---

# 18. Bước 5 — cú chạy phải phá mốc quan trọng

Đây là điều kiện bắt buộc.

Ví dụ bullish:

```text
          đỉnh gần nhất
──────────────●──────────────
             / \
            /   \
                 \
                  ● sweep low

                     █
                   ███
                 █████
               ███████
                    ↑
               phải vượt
               đỉnh gần nhất
```

Không được tính chỉ vì giá bật mạnh.

---

# 19. Cách chọn đỉnh phải phá

Sau bullish sweep:

1. tìm swing high gần nhất đã được xác nhận;
2. swing high phải tồn tại trước cú displacement;
3. giá phải đóng cửa phía trên swing high.

Không chỉ kiểm tra wick.

Điều kiện:

```ts
close >
    swingHigh.price +
    ATR * breakBufferAtr
```

Mặc định:

```ts
breakBufferAtr = 0.05;
```

---

# 20. Bearish

Sau bearish sweep:

```ts
close <
    swingLow.price -
    ATR * breakBufferAtr;
```

---

# 21. Tại sao dùng close để xác nhận

Ví dụ:

```text
đỉnh
────────────────────────

                │
                ● wick vượt
                │
                █
                █
────────────────────────
       close lại phía dưới
```

Không coi là phá chắc chắn.

Ưu tiên:

```text
──────────────────── đỉnh

                 █
                 █
                 █ ← close trên
```

---

# 22. Định nghĩa sự kiện phá

```ts
interface StructureBreak {
    direction: 'up' | 'down';

    swingId: string;
    swingPrice: number;

    breakIndex: number;
    breakTime: number;

    closePrice: number;
}
```

---

# 23. Bước 6 — chỉ lúc này mới đi tìm Order Block

Sau khi hệ thống đã có:

```text
Sweep
+
Strong Move
+
Break
```

mới truy ngược.

Không được quét chart và tìm:

```text
mọi nến đỏ trước nến xanh
```

---

# 24. Bullish Order Block

Với sự kiện:

```text
quét đáy
     ↓
tăng mạnh
     ↓
phá đỉnh
```

truy ngược từ thời điểm bắt đầu cú tăng.

Tìm:

> **nến giảm cuối cùng trước cú tăng mạnh.**

Nến giảm:

```ts
close < open
```

---

# 25. Bearish Order Block

Với:

```text
quét đỉnh
     ↓
giảm mạnh
     ↓
phá đáy
```

tìm:

> **nến tăng cuối cùng trước cú giảm mạnh.**

Nến tăng:

```ts
close > open
```

---

# 26. Khoảng tìm kiếm

Không truy ngược vô hạn.

Ví dụ:

```ts
originLookback = 6;
```

Tìm trong tối đa 6 candle trước `displacementStart`.

Bullish:

```ts
for (
    let i = displacementStart;
    i >= displacementStart - originLookback;
    i--
) {
    if (candles[i].close < candles[i].open) {
        anchor = candles[i];
        break;
    }
}
```

Bearish ngược lại.

---

# 27. Vùng giá của Order Block

Phiên bản mặc định nên dùng **toàn bộ candle**.

Bullish hoặc bearish:

```ts
obLow = candle.low;
obHigh = candle.high;
```

Ví dụ:

```text
high ┌────────────────┐
     │                │
     │       OB       │
     │                │
low  └────────────────┘
```

Không nên refine quá sớm trong phiên bản đầu.

---

# 28. Chế độ refine tùy chọn

Cho phép config:

```ts
zoneMode:
    'full-candle'
    | 'body'
    | 'hybrid';
```

### Full candle

```ts
low = candle.low;
high = candle.high;
```

### Body

```ts
low =
    Math.min(
        candle.open,
        candle.close
    );

high =
    Math.max(
        candle.open,
        candle.close
    );
```

Mặc định:

```ts
zoneMode = 'full-candle';
```

---

# 29. Không xác nhận OB ngay khi tìm được anchor

Ví dụ anchor ở candle 100.

Break xảy ra candle 106.

Data phải là:

```ts
{
    originIndex: 100,
    confirmedIndex: 106
}
```

Tại candle 100–105:

```text
OB chưa tồn tại dưới dạng confirmed OB.
```

Sau khi candle 106 đóng:

```text
OB được tạo.
```

Nhưng khi vẽ lịch sử, rectangle có thể bắt đầu từ candle 100.

---

# 30. Cấu trúc dữ liệu Order Block

```ts
type OrderBlockDirection =
    'bullish'
    | 'bearish';

type OrderBlockStatus =
    'active'
    | 'touched'
    | 'mitigated'
    | 'invalidated'
    | 'expired';

interface OrderBlock {
    id: string;

    direction: OrderBlockDirection;

    low: number;
    high: number;
    mid: number;

    originIndex: number;
    originTime: number;

    confirmedIndex: number;
    confirmedTime: number;

    sweepIndex: number;
    sweepPrice: number;

    brokenSwingIndex: number;
    brokenSwingPrice: number;

    displacementStart: number;
    displacementEnd: number;

    score: number;

    status: OrderBlockStatus;

    touchCount: number;

    firstTouchIndex?: number;

    invalidatedIndex?: number;

    metadata: {
        moveATR: number;
        maxBodyATR: number;
        directionalRatio: number;
        hasFVG?: boolean;
    };
}
```

---

# 31. Midpoint

Luôn lưu:

```ts
mid =
    (high + low) / 2;
```

Có thể dùng sau này để xác định mức độ giá đi sâu vào vùng.

---

# 32. Trạng thái Order Block

Một OB không chỉ có:

```text
true / false
```

Mà phải có vòng đời.

```text
ACTIVE
  ↓
TOUCHED
  ↓
MITIGATED
  ↓
INVALIDATED
```

Hoặc:

```text
ACTIVE
  ↓
EXPIRED
```

---

# 33. ACTIVE

Ngay khi break được xác nhận:

```ts
status = 'active';
touchCount = 0;
```

---

# 34. TOUCHED

Bullish OB:

nếu candle sau confirmation có:

```ts
low <= ob.high
&&
high >= ob.low
```

thì giá đã chạm vùng.

Tăng:

```ts
touchCount++;
```

Nếu lần đầu:

```ts
firstTouchIndex = i;
```

---

# 35. MITIGATED

Có thể định nghĩa giá đi sâu ít nhất 50% vùng.

Bullish:

```ts
candle.low <= ob.mid
```

Bearish:

```ts
candle.high >= ob.mid
```

Khi đó:

```ts
status = 'mitigated';
```

Không nhất thiết xóa vùng.

---

# 36. INVALIDATED

Đây là trạng thái quan trọng.

## Bullish OB

Nếu candle đóng:

```ts
close < ob.low - ATR * invalidationBufferAtr
```

OB bị phá.

## Bearish OB

Nếu:

```ts
close > ob.high + ATR * invalidationBufferAtr
```

OB bị phá.

Mặc định:

```ts
invalidationBufferAtr = 0;
```

Có thể tăng sau này.

---

# 37. Không dùng wick làm mặc định để phá OB

Ví dụ bullish:

```text
OB
┌────────────────────┐
│                    │
└────────────────────┘
          │
          ↓ wick xuyên
          │
          █
          █ close quay lại
```

Không nhất thiết invalid.

Mặc định:

```text
invalidationMode = 'close';
```

Cho phép config:

```ts
'close'
|
'wick'
```

---

# 38. EXPIRED

Để tránh chart chứa hàng trăm vùng cũ:

```ts
maxActiveBars = 500;
```

Nếu OB tồn tại quá lâu mà:

* không còn liên quan;
* chưa bị phá;
* quá xa giá;

có thể:

```ts
status = 'expired';
```

Không xóa data lịch sử, chỉ không render mặc định.

---

# 39. Chấm điểm Order Block

Không nên coi mọi OB bằng nhau.

Thang điểm ví dụ:

```text
Cú chạy mạnh              0–3
Phá swing quan trọng      0–3
Quét thanh khoản          0–2
Vùng chưa được chạm       0–1
Có khoảng giá đi quá nhanh 0–1

Tổng                     0–10
```

---

# 40. Điểm cho cú chạy

Ví dụ:

```ts
if (moveATR >= 2.5)
    score += 3;
else if (moveATR >= 2.0)
    score += 2.5;
else if (moveATR >= 1.5)
    score += 2;
```

---

# 41. Điểm phá swing

Nếu phá swing gần:

```text
+2
```

Nếu swing đó nổi bật hơn, ví dụ tồn tại lâu hoặc là cực trị lớn:

```text
+3
```

Phiên bản đầu chỉ cần:

```text
+3 nếu phá confirmed swing
```

để giữ thuật toán đơn giản.

---

# 42. Điểm quét

Sweep rõ ràng:

```text
+2
```

Không sweep:

```text
0
```

Trong chế độ STRICT:

```text
không sweep → không tạo OB
```

---

# 43. Hai chế độ phát hiện

Nên có:

```ts
mode:
    'strict'
    | 'relaxed';
```

## STRICT

Bắt buộc:

```text
Sweep
+
Displacement
+
Break
```

Đây là chế độ mặc định.

## RELAXED

Bắt buộc:

```text
Displacement
+
Break
```

Sweep chỉ cộng điểm.

---

# 44. Khuyến nghị phiên bản đầu

Sử dụng:

```ts
mode = 'strict';
```

Mục tiêu ban đầu là:

> **ít vùng nhưng vùng có ý nghĩa.**

Không cố gắng tìm thật nhiều OB.

---

# 45. Điều kiện hoàn chỉnh cho Bullish OB

Pseudo-code logic:

```ts
IF

có confirmed swing low

AND

giá chọc xuống dưới swing low

AND

giá đóng trở lại phía trên swing low

AND

sau đó xuất hiện bullish displacement

AND

bullish displacement phá confirmed swing high

THEN

truy ngược tìm bearish candle cuối cùng
trước displacement

→ tạo bullish Order Block
```

---

# 46. Điều kiện hoàn chỉnh cho Bearish OB

```ts
IF

có confirmed swing high

AND

giá chọc lên trên swing high

AND

giá đóng trở lại phía dưới swing high

AND

sau đó xuất hiện bearish displacement

AND

bearish displacement phá confirmed swing low

THEN

truy ngược tìm bullish candle cuối cùng
trước displacement

→ tạo bearish Order Block
```

---

# 47. Pipeline đề xuất

```ts
function processCandles(candles) {

    const atr = calculateATR(candles, 14);

    const swings =
        detectConfirmedSwings(candles);

    const sweeps =
        detectLiquiditySweeps(
            candles,
            swings,
            atr
        );

    const displacements =
        detectDisplacements(
            candles,
            atr
        );

    const breaks =
        detectStructureBreaks(
            candles,
            swings,
            atr
        );

    const orderBlocks =
        buildOrderBlocks({
            candles,
            atr,
            swings,
            sweeps,
            displacements,
            breaks,
        });

    updateOrderBlockLifecycle(
        candles,
        orderBlocks,
        atr
    );

    return orderBlocks;
}
```

---

# 48. Nhưng realtime không nên tính lại toàn bộ lịch sử

Không chạy:

```ts
processCandles(all100000Candles)
```

mỗi lần Binance WebSocket cập nhật.

Tách thành state machine.

```ts
class OrderBlockEngine {

    candles = [];

    swings = [];

    sweeps = [];

    activeSweeps = [];

    orderBlocks = [];

    onCandle(candle) {

        updateATR();

        updateSwingDetector();

        updateSweeps();

        updateDisplacement();

        updateStructureBreak();

        detectNewOrderBlocks();

        updateOrderBlockStates();
    }
}
```

---

# 49. Chỉ xử lý candle đóng

Phiên bản đầu:

```ts
onClosedCandle(candle)
```

Không phát hiện OB dựa trên candle đang chạy.

Lý do:

```text
high
low
close
```

của candle realtime vẫn còn thay đổi.

Sau này có thể tạo một lớp:

```text
preview
```

riêng.

---

# 50. State machine cho sweep

Sau khi sweep xuất hiện:

```text
WAITING_FOR_MOVE
```

Nếu displacement xuất hiện:

```text
WAITING_FOR_BREAK
```

Nếu phá swing:

```text
CREATE_OB
```

Nếu quá lâu:

```text
CANCEL
```

Ví dụ:

```ts
maxBarsSweepToBreak = 8;
```

---

# 51. Data model cho candidate

```ts
interface OrderBlockCandidate {

    direction:
        'bullish'
        | 'bearish';

    state:
        'waiting-displacement'
        | 'waiting-break'
        | 'confirmed'
        | 'cancelled';

    sweep: SweepEvent;

    displacementStart?: number;
    displacementEnd?: number;

    targetSwing?: SwingPoint;
}
```

---

# 52. Chống tạo nhiều OB cho cùng một sự kiện

Một cú tăng mạnh có thể phá:

```text
swing 1
swing 2
swing 3
```

Không nên tạo 3 OB giống nhau.

Tạo khóa sự kiện:

```ts
eventKey =
    `${direction}:${sweepIndex}:${originIndex}`;
```

Nếu đã tồn tại:

```ts
không tạo thêm.
```

---

# 53. Gộp các OB gần như trùng nhau

Nếu hai vùng:

```text
OB1
100 → 105

OB2
101 → 105.5
```

và cùng hướng, gần cùng thời gian, có thể gộp.

Tính tỷ lệ overlap:

```ts
intersection =
    Math.max(
        0,
        Math.min(a.high, b.high)
        -
        Math.max(a.low, b.low)
    );

smaller =
    Math.min(
        a.high - a.low,
        b.high - b.low
    );

overlapRatio =
    intersection / smaller;
```

Nếu:

```ts
overlapRatio >= 0.7
```

và:

```ts
Math.abs(
    a.originIndex -
    b.originIndex
) <= 3
```

thì giữ vùng có score cao hơn.

---

# 54. Cấu hình mặc định đề xuất

```ts
const defaultOBConfig = {

    atrPeriod: 14,

    swingLeft: 3,
    swingRight: 3,

    sweepBufferAtr: 0.05,
    sweepRecoveryBars: 2,

    displacementWindow: 3,
    minMoveAtr: 1.5,
    minLargeBodyAtr: 0.8,
    minDirectionalBodyRatio: 0.65,

    breakBufferAtr: 0.05,

    originLookback: 6,

    zoneMode: 'full-candle',

    mode: 'strict',

    invalidationMode: 'close',
    invalidationBufferAtr: 0,

    maxBarsSweepToBreak: 8,

    maxActiveBars: 500,

    mergeOverlapRatio: 0.70,

    minScoreToRender: 6,
};
```

Các thông số này là **giá trị khởi đầu để kiểm thử**, không phải các hằng số bất biến của thị trường.

Agent phải tập trung xây kiến trúc sao cho toàn bộ thông số có thể thay đổi dễ dàng.

---

# 55. Kết quả output của engine

```ts
interface OrderBlockDetectionResult {

    active: OrderBlock[];

    historical: OrderBlock[];

    candidates?: OrderBlockCandidate[];
}
```

Frontend không được tự tính lại logic OB.

Frontend chỉ nhận kết quả và render.

---

# 56. Lightweight Charts

Mục tiêu triển khai hiện tại nên nhắm Lightweight Charts 5.x. Tài liệu API hiện tại của TradingView đang hiển thị 5.2; API hiện hành hỗ trợ `chart.addSeries(...)` để tạo series.

Ví dụ:

```ts
import {
    createChart,
    CandlestickSeries,
} from 'lightweight-charts';

const chart =
    createChart(container);

const candleSeries =
    chart.addSeries(
        CandlestickSeries
    );

candleSeries.setData(candles);
```

---

# 57. Không tạo một series riêng cho mỗi OB

Không nên:

```text
OB1 = series
OB2 = series
OB3 = series
...
OB100 = series
```

Order Block là đồ họa phủ lên biểu đồ, không phải một chuỗi dữ liệu giá độc lập.

Nên dùng **Series Primitive**.

Lightweight Charts cho phép gắn `ISeriesPrimitive` vào series qua `attachPrimitive()`. Primitive có thể cung cấp renderer để vẽ trực tiếp trên pane bằng Canvas.

Kiến trúc:

```text
CandlestickSeries
       │
       └── OrderBlockPrimitive
                 │
                 ├── OB 1
                 ├── OB 2
                 ├── OB 3
                 └── OB N
```

---

# 58. Chỉ dùng một OrderBlockPrimitive

```ts
const obPrimitive =
    new OrderBlockPrimitive();

candleSeries.attachPrimitive(
    obPrimitive
);
```

Sau đó:

```ts
obPrimitive.setOrderBlocks(
    orderBlocks
);
```

Primitive tự render toàn bộ vùng.

---

# 59. Chuyển giá thành tọa độ Y

Lightweight Charts cung cấp `priceToCoordinate()` trên series API.

Ví dụ:

```ts
const yTop =
    series.priceToCoordinate(
        ob.high
    );

const yBottom =
    series.priceToCoordinate(
        ob.low
    );
```

---

# 60. Chuyển time thành tọa độ X

Time scale cung cấp:

```ts
chart
    .timeScale()
    .timeToCoordinate(time);
```

API hiện hành cũng cung cấp chuyển đổi giữa time, logical index và coordinate.

Ví dụ:

```ts
const xStart =
    chart
        .timeScale()
        .timeToCoordinate(
            ob.originTime
        );
```

---

# 61. Điểm kết thúc rectangle

Active OB nên kéo tới mép phải của vùng chart.

Không cần fake timestamp tương lai.

Renderer có thể dùng:

```ts
xEnd = paneWidth;
```

Khi OB invalid:

```ts
xEnd =
    timeScale.timeToCoordinate(
        candles[
            ob.invalidatedIndex
        ].time
    );
```

---

# 62. Hình dạng vùng

Bullish:

```text
origin
  │
  ▼
  ┌──────────────────────────────→
  │            OB
  └──────────────────────────────→
```

Bearish tương tự.

---

# 63. Quy tắc render

## Bullish

Nên dùng:

* nền xanh bán trong suốt;
* border mảnh;
* label `B-OB`;
* opacity thấp để không che candle.

## Bearish

* nền đỏ bán trong suốt;
* label `S-OB`.

Không dùng màu quá đậm.

---

# 64. Mức độ hiển thị theo trạng thái

Ví dụ:

```text
ACTIVE
opacity 0.20

TOUCHED
opacity 0.14

MITIGATED
opacity 0.08

INVALIDATED
không kéo tiếp
opacity 0.04

EXPIRED
không render mặc định
```

Các giá trị UI có thể điều chỉnh.

---

# 65. Hiển thị score

Ví dụ label:

```text
B-OB 8.5
```

hoặc:

```text
B-OB A
B-OB B
```

Có thể quy đổi:

```text
8.5–10  → A+
7.5–8.5 → A
6.5–7.5 → B
<6.5    → ẩn mặc định
```

---

# 66. Renderer pseudo-code

```ts
class OrderBlockRenderer {

    constructor(data) {
        this.data = data;
    }

    draw(target) {

        target.useBitmapCoordinateSpace(
            scope => {

                const ctx =
                    scope.context;

                for (
                    const box
                    of this.data.boxes
                ) {

                    const x1 =
                        box.x1 *
                        scope.horizontalPixelRatio;

                    const x2 =
                        box.x2 *
                        scope.horizontalPixelRatio;

                    const y1 =
                        box.y1 *
                        scope.verticalPixelRatio;

                    const y2 =
                        box.y2 *
                        scope.verticalPixelRatio;

                    ctx.fillRect(
                        x1,
                        y1,
                        x2 - x1,
                        y2 - y1
                    );
                }
            }
        );
    }
}
```

Lightweight Charts primitives sử dụng renderer trên Canvas; primitive có lifecycle `attached`, `detached`, `updateAllViews`, và callback `requestUpdate` để yêu cầu chart vẽ lại.

---

# 67. Primitive structure

```ts
class OrderBlockPrimitive {

    private chart;
    private series;
    private requestUpdate;

    private orderBlocks = [];

    private paneView;

    attached(param) {

        this.chart =
            param.chart;

        this.series =
            param.series;

        this.requestUpdate =
            param.requestUpdate;
    }

    detached() {

        this.chart = null;
        this.series = null;
    }

    setOrderBlocks(orderBlocks) {

        this.orderBlocks =
            orderBlocks;

        this.requestUpdate?.();
    }

    updateAllViews() {

        this.paneView.update(
            this.orderBlocks,
            this.chart,
            this.series
        );
    }

    paneViews() {
        return [this.paneView];
    }
}
```

---

# 68. Chỉ render vùng đang nhìn thấy

Nếu có 5.000 OB lịch sử, không iterate toàn bộ mỗi frame.

Lấy visible range.

Sau đó chỉ lọc:

```text
OB có giao với vùng đang hiển thị
```

Ví dụ:

```ts
visibleOBs =
    orderBlocks.filter(ob =>
        ob.endIndex >= visibleFrom
        &&
        ob.originIndex <= visibleTo
    );
```

Đây là yêu cầu quan trọng về hiệu năng.

---

# 69. Cache tọa độ

Không tính lại toàn bộ:

```text
time → x
price → y
```

nhiều lần không cần thiết.

Primitive nên cập nhật cache khi:

* zoom;
* scroll;
* resize;
* OB thay đổi;
* price scale thay đổi.

---

# 70. Tooltip

Khi rê chuột lên OB, hiển thị:

```text
Bullish Order Block

Score: 8.5

Range:
62,510 – 62,820

Created:
12:30

Confirmed:
13:00

Sweep:
61,980

Broken high:
63,120

Move:
2.1 ATR

Status:
Active

Touches:
0
```

Không cần làm trong phiên bản đầu nếu làm phức tạp renderer.

---

# 71. Debug mode bắt buộc

AI agent phải xây một chế độ debug.

```ts
debug: true
```

Khi bật:

* đánh dấu swing high;
* đánh dấu swing low;
* đánh dấu sweep;
* đánh dấu displacement start;
* đánh dấu displacement end;
* đánh dấu swing bị phá;
* đánh dấu anchor OB.

Ví dụ:

```text
           SWING
             ●
             │
─────────────┼──────────
             │
             │          BREAK
             │           ↑
             │        █████
             │      █████
                 █████

       OB
    ┌──────┐
    │      │
    └──────┘
       ↑
     SWEEP
       ●
```

Debug mode rất quan trọng để kiểm tra thuật toán.

---

# 72. Không tối ưu threshold trước khi debug hình thái

Thứ tự phát triển:

```text
1. Swing detector chính xác
        ↓
2. Sweep detector chính xác
        ↓
3. Displacement detector
        ↓
4. Structure break
        ↓
5. OB origin
        ↓
6. Lifecycle
        ↓
7. Renderer
        ↓
8. Backtest threshold
```

Không bắt đầu bằng machine learning hoặc tối ưu tham số.

---

# 73. Test case bắt buộc — Bullish

Input phải tạo hình:

```text
       swing high
──────────●─────────────
         / \
        /   \
             \
              \
───────────────●────── swing low
                \
                 ● sweep
                  \
                   █
                 ███
               █████
             ███████
                  ↑
              break high
```

Expected:

```text
1 bullish sweep
1 bullish displacement
1 structure break
1 bullish OB
```

OB phải nằm tại vùng xuất phát trước cú tăng.

---

# 74. Test case bắt buộc — Bearish

```text
              ● sweep
             /
────────────●──────── swing high
           /
          /

               █
              ███
             █████
            ███████
               ↓

──────────●──────── swing low
          ↓
        break
```

Expected:

```text
1 bearish OB
```

---

# 75. Test case — không có displacement

```text
sweep
 ↓
 ●
  \
   █
    █
   █
    █
```

Giá bò chậm.

Expected:

```text
NO ORDER BLOCK
```

---

# 76. Test case — không phá swing

```text
sweep
 ↓
 ●
  \
   █████
   █████
      ↑
  chạy mạnh

──────────── swing high
```

Nhưng giá chưa vượt swing high.

Expected:

```text
NO CONFIRMED ORDER BLOCK
```

Có thể giữ internal candidate.

---

# 77. Test case — phá bằng wick

```text
                 │
                 ●
──────────────────── swing
                 █
                 █
```

Close dưới swing.

Expected:

```text
NO BREAK
```

với config mặc định.

---

# 78. Test case — OB bị invalid

Bullish OB:

```text
┌───────────────┐
│      OB       │
└───────────────┘
       \
        \
         █
         █ close dưới OB
```

Expected:

```ts
status = 'invalidated';
```

Rectangle kết thúc tại candle invalidation.

---

# 79. Test case — OB được retest

```text
              ↑
           █████
        █████
      █████

       ↓ price return

┌────────────────┐
│       OB       │
└────────────────┘
```

Expected:

```ts
touchCount = 1;
status = 'touched';
```

Nếu đi xuống dưới midpoint:

```ts
status = 'mitigated';
```

---

# 80. Yêu cầu đối với AI agent

Agent không được tự ý đổi định nghĩa thuật toán thành:

```text
nến đỏ cuối → bullish OB
nến xanh cuối → bearish OB
```

Đó chỉ là bước cuối cùng để xác định vùng xuất phát.

Định nghĩa chính phải luôn là:

```text
LIQUIDITY EVENT
      ↓
DISPLACEMENT
      ↓
STRUCTURE BREAK
      ↓
TRACE BACK
      ↓
ORDER BLOCK
```

Hay bằng tiếng Việt:

```text
quét đỉnh/đáy
      ↓
giá rời vùng mạnh
      ↓
phá mốc quan trọng
      ↓
truy ngược vùng xuất phát
      ↓
Order Block
```

---

# 81. Ưu tiên phát triển

### Phase 1

Implement:

```text
ATR
Swing
Sweep
Displacement
Break
OB
```

và log kết quả ra console.

### Phase 2

Thêm rectangle trên Lightweight Charts.

### Phase 3

Thêm lifecycle:

```text
active
touched
mitigated
invalidated
```

### Phase 4

Thêm scoring.

### Phase 5

Thêm debug visualization.

### Phase 6

Backtest tham số.

---

# 82. Các file đề xuất

```text
src/
│
├── indicators/
│   └── atr.ts
│
├── structure/
│   ├── swings.ts
│   ├── sweeps.ts
│   └── breaks.ts
│
├── orderblock/
│   ├── types.ts
│   ├── config.ts
│   ├── displacement.ts
│   ├── detector.ts
│   ├── lifecycle.ts
│   ├── scoring.ts
│   └── engine.ts
│
├── chart/
│   └── orderblock/
│       ├── OrderBlockPrimitive.ts
│       ├── OrderBlockPaneView.ts
│       └── OrderBlockRenderer.ts
│
└── tests/
    ├── bullish-ob.test.ts
    ├── bearish-ob.test.ts
    ├── invalidation.test.ts
    └── no-repaint.test.ts
```

---

# 83. API cuối cùng mong muốn

```ts
const engine =
    new OrderBlockEngine({
        mode: 'strict',

        swingLeft: 3,
        swingRight: 3,

        atrPeriod: 14,

        minMoveAtr: 1.5,

        minScoreToRender: 6,
    });
```

Realtime:

```ts
engine.onClosedCandle(candle);
```

Lấy vùng:

```ts
const orderBlocks =
    engine.getOrderBlocks();
```

Frontend:

```ts
obPrimitive.setOrderBlocks(
    orderBlocks
);
```

---

# 84. Event API

Engine nên emit:

```ts
engine.on(
    'orderBlockCreated',
    ob => {}
);

engine.on(
    'orderBlockTouched',
    ob => {}
);

engine.on(
    'orderBlockMitigated',
    ob => {}
);

engine.on(
    'orderBlockInvalidated',
    ob => {}
);
```

Sau này hệ thống trading có thể dùng các event này mà không phụ thuộc renderer.

---

# 85. Nguyên tắc kiến trúc

Phải tách:

```text
DETECTION
```

khỏi:

```text
VISUALIZATION
```

OrderBlockEngine không được biết Lightweight Charts tồn tại.

OrderBlockPrimitive không được tự tính Order Block.

Kiến trúc:

```text
Market Data
     ↓
OrderBlockEngine
     ↓
OrderBlock[]
     ├─────────────→ Strategy
     │
     ├─────────────→ Alerts
     │
     ├─────────────→ Backtest
     │
     └─────────────→ Lightweight Chart
```

Đây là yêu cầu bắt buộc.

---

# 86. No-repaint test

Đây là một test rất quan trọng.

Cho hệ thống chạy:

```text
candle 1
candle 2
candle 3
...
```

từng candle một.

Lưu output sau mỗi candle.

Sau đó chạy toàn bộ lịch sử một lần.

Kết quả phải đảm bảo:

> Một OB không được xuất hiện ở thời điểm sớm hơn `confirmedIndex`.

Ví dụ:

```text
origin = 100
break  = 106
```

Output:

```text
candle 100 → không có OB
101        → không có
102        → không có
103        → không có
104        → không có
105        → không có
106 close  → OB xuất hiện
```

Sau khi xuất hiện, rectangle có thể bắt đầu vẽ từ candle 100.

---

# 87. Định nghĩa thành công của phiên bản đầu

Phiên bản đầu được xem là đạt yêu cầu khi:

```text
✓ Không repaint

✓ Không tìm OB chỉ dựa trên màu candle

✓ Mọi OB đều gắn với một break

✓ Strict OB đều gắn với một sweep

✓ Có đo displacement bằng ATR

✓ Có origin rõ ràng

✓ Có trạng thái active/invalidation

✓ Có thể render rectangle trên Lightweight Charts

✓ Scroll/zoom rectangle luôn bám đúng candle và giá

✓ Realtime và historical cho cùng kết quả
```

---

# 88. Công thức cuối cùng agent phải ghi nhớ

Không tìm:

```text
Order Block
    ↓
xem giá có chạy không
```

Mà phải làm ngược lại:

```text
TÌM SỰ KIỆN TRƯỚC
```

Cụ thể:

```text
ĐỈNH / ĐÁY QUAN TRỌNG
          ↓
      BỊ QUÉT QUA
          ↓
   GIÁ QUAY LẠI VÀ
      CHẠY MẠNH
          ↓
 PHÁ ĐỈNH / ĐÁY KHÁC
          ↓
  SỰ KIỆN ĐÃ XÁC NHẬN
          ↓
   TRUY NGƯỢC LẠI
          ↓
 NẾN NGƯỢC CHIỀU CUỐI
          ↓
      ORDER BLOCK
```

Đây phải là nền tảng duy nhất của detector phiên bản đầu.
