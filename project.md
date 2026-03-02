# Tài liệu Hướng dẫn Phát triển & Bảo trì Dự án biểu đồ (stat1.html)

Tài liệu này được tạo ra để cung cấp bối cảnh (context) đầy đủ, cấu trúc hiện tại và các quy tắc cốt lõi của dự án dành cho bất kỳ AI Agent nào tiếp quản công việc trong tương lai.

## 1. Tổng quan & Mục tiêu Dự án
Đây là một Single-Page Application (SPA) nằm gọn trong một file `stat1.html`. Ứng dụng hoạt động như một nền tảng biểu đồ giao dịch (Trading Chart) siêu nhẹ, lấy dữ liệu trực tiếp từ Binance Futures (klines API) và vẽ các chỉ báo tùy chỉnh với độ phức tạp cao mà thư viện mặc định không hỗ trợ sẵn.

## 2. Công nghệ, Khung làm việc (Tech Stack) & Các Ràng Buộc Cốt Lõi
**CẢNH BÁO QUAN TRỌNG DÀNH CHO AI AGENT:**
- **Ngôn ngữ:** Thuần HTML5, Vanilla JavaScript (ES6+), và Vanilla CSS.
- **KHÔNG SỬ DỤNG FRAMEWORK:** Tuyệt đối không sử dụng React, Vue, Angular, hay TailwindCSS. User yêu cầu ứng dụng phải giữ ở mức tối giản và thuần tuý nhất để đạt tốc độ cao.
- **Thư viện bên thứ 3 duy nhất:** `LightweightCharts` (của TradingView) dùng để hiển thị biểu đồ Nến (Candlestick) cơ bản, trục thời gian, trục giá, và khả năng tương tác (zoom/pan). 

## 3. Cấu trúc Render & Luồng Dữ liệu (Kiến trúc cốt lõi)
Dự án sử dụng cơ chế **"Render Kép" (Dual Rendering Pattern)** ghép chồng lên nhau:
1. **Lớp Đáy (Native LightweightCharts):** Xử lý sự kiện chuột, trục toạ độ, vẽ Nến (Candlestick), vẽ các đường Line tĩnh (như ATRBot 2, Session VWAP).
2. **Lớp Đỉnh (HTML5 Canvas Overlay):** Điểm đặc biệt nhất của dự án. Một thẻ `<canvas>` trong suốt được đặt đè chính xác lên trên biểu đồ chart. Hàm `drawOverlay()` sẽ liên tục được gọi qua `requestAnimationFrame` mỗi khi biểu đồ dịch chuyển hoặc thay đổi kích thước. Lớp này dùng để tự vẽ thủ công các hình khối phức tạp (Volume Profile ngang, Đám mây màu ATRBot, Vùng VSR, Các công cụ vẽ tay).

*Luồng Dữ Liệu:*
-> Fetch `/fapi/v1/klines` -> Cache vào `localStorage` -> Lưu vào mảng `globalBars` -> Tính toán các chỉ báo (BVC, ATR, VWAP) -> Đưa dữ liệu native vào LWC -> Gọi `requestAnimationFrame(drawOverlay)` để đồng bộ vẽ Canvas.

## 4. Chi tiết Các Chỉ Báo & Tính Năng Đang Có

### 4.1. Khối lượng & Volume Profile (Rất phức tạp)
- **Thuật toán BVC (Bulk Volume Classification):** Bóc tách Buy Volume / Sell Volume từ nến OHLCV thông thường theo công thức chuẩn hoá phân phối chuẩn (Easley, López de Prado & O'Hara). Hàm: `calculateBVCVolumes`.
- **FRVP (Fixed Range Volume Profile) & Trực quan:**
  - Được vẽ hoàn toàn thủ công bằng thẻ `<canvas>` trong hàm `drawOverlay()`. 
  - **Màu sắc TradingView Delta:** Vẽ song song khối lượng Buy (Xanh dương) và Sell (Vàng/Nâu). Hiển thị theo 3 sắc độ (Tri-color Delta style):
    - Đậm/Sáng nhất: Phần chênh lệch (Delta) của phe mạnh hơn.
    - Tối nhất: Phần khối lượng bị trung hòa của phe yếu.
    - Trung bình: Phần khối lượng mạnh tương đương phe yếu bị trung hòa.
  - Hỗ trợ hiển thị vùng Value Area (VAH/VAL) với nền mờ, POC (Point of Control) line xanh/đỏ dựa theo Delta dương/âm.

### 4.2. Chỉ báo đường / Vùng (Lines & Clouds)
- **Session VWAP (Standard):** Tính toán giá trung bình gia quyền theo khối lượng `(Volume * Typical Price) / Volume`, **tự động reset lại từ đầu mỗi ngày vào lúc 00:00 UTC**. Được vẽ bằng `LineSeries` gốc của LightweightCharts (màu trắng nét liền, width=2) để đảm bảo không bị lỗi độ phân giải. (Hàm `calculateStandardVWAP`).
- **ATRBot:** Hệ thống xác định xu hướng chia thành các "chu kỳ" (cycles) dựa trên EMA và ATR trailing stop.
  - Vẽ dải băng màu xanh/đỏ lấp đầy khoảng trống giữa Trend 1 (EMA) và Trend 2 (Trail) trong lớp Canvas.
- **VSR (Volatility State Range):** Định hình các khối hình chữ nhật màu vàng nhạt nền dưới background dựa trên phân tích độ lệch chuẩn.

### 4.3. Công cụ tương tác thao tác tay
Xử lý hoàn toàn thông qua sự kiện `mousedown`, `mousemove`, `mouseup`, `keydown` bắt ở cấp độ Container và thao tác trên Canvas Overlay:
- Cờ chặn di chuyển: `kinematicScroll` và `handleScroll` của chart sẽ bị vô hiệu hóa khi người dùng kích hoạt công cụ vẽ.
- **Rectangle Tool (Công cụ Hình chữ nhật):**
  - Cho phép click kéo để vẽ vùng tuỳ chỉnh. 
  - Lưu toạ độ dựa vào Logical Index (time) và Trục Giá (Price) để nó dính chặt vào nến khi zoom/pan.
  - Cho phép: Click chọn (hiển thị 4 handle ở góc), kéo thả di chuyển toàn bộ, nắm 4 góc để resize thay đổi kích thước, nhấn phím `Delete` để xoá.
- **Measure Tool (Thước Đo):** Ruler đo khoảng cách số thanh nến, thời gian, giá, và phần trăm. Hoạt động trên 3 click (start, end, reset).

## 5. Hướng dẫn Dành Cho AI Agent (Những điểm cần lưu ý khi Code)
- **KHÔNG SỬA CẤU TRÚC RENDER CANVAS NẾU KHÔNG CẦN THIẾT:** Việc đồng bộ tọa độ giữa thư viện LightweightCharts (`timeScale.logicalToCoordinate`, `series.priceToCoordinate`) ra thẻ Canvas là rất nhạy cảm. Luôn kiểm tra `x !== null && y !== null` trước khi bắt đầu `ctx.lineTo()`.
- **Logic VWAP:** Đã từng dính bug khi dùng canvas vẽ VWAP gây lỗi tàng hình. VWAP nay đã dùng native `LineSeries`. Hãy cứ dùng LineSeries nếu đó chỉ đơn thuần là đường (Line).
- **Hệ trục Thời gian:** LWC dùng timestamp / 1000 (giây). Cần nhớ quy đổi khi dùng `new Date(...)`.
- **Ràng buộc khi vẽ Canvas:** Hãy luôn nhớ luồng `ctx.beginPath()`, `ctx.moveTo()`, `ctx.lineTo()`, `ctx.stroke()`, cập nhật `lineWidth` và `strokeStyle` để tránh hiệu ứng stroke đè lên các tính năng vẽ khác. Hàm `drawOverlay()` đang kiêm nhiệm vẽ ATR Cloud, VSR, Recangle, Measure, VolumeProfile... nên hãy ngắt cách (pass) cẩn thận bằng comments.

Dự án hiện tại đang khá hoàn thiện về frontend thuần tuý. Ưu tiên hàng đầu khi bổ sung chức năng mới là giữ cho `stat1.html` nhẹ nhất có thể và đảm bảo 100% không để lộ các dòng code không cần thiết trong quá trình sửa đổi. Trang bị Vanilla JavaScript, HTML5 Canvas Mastery sẽ là chìa khoá cho công việc tiếp theo.
