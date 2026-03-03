# Project Structure & Refactoring Summary

Dự án đã được tái cấu trúc từ một file `index.html` duy nhất thành một hệ thống module hóa để dễ dàng quản lý và bảo trì.

## 📄 Các file chính

### 🏗️ Cốt lõi (HTML & CSS)
- **`index.html`**: Chỉ còn chứa cấu trúc DOM cơ bản và các thẻ script/link. Mọi logic và style đã được đưa ra ngoài.
- **`css/style.css`**: Tập hợp tất cả styles, bao gồm Design Tokens, Layout, Loading Screen, Topbar, Sidebar và các Panels.

### ⚙️ Cấu hình & Trạng thái
- **`js/config.js`**: Lưu trữ các hằng số cài đặt (ATR length, EMA length, mốc TP/SL) và các biến trạng thái toàn cục (SYMBOL, INTERVAL, v.v.).

### 📊 Logic Chỉ báo (Indicators)
- **`js/indicators.js`**: Chứa các thuật toán tính toán toán học cho:
  - **ATRBot**: Xác định chu kỳ xu hướng và các đường Trail.
  - **FRVP (Fixed Range Volume Profile)**: Phân bổ khối lượng theo vùng giá.
  - **VSR (Volatility Stop/Resistance)**: Vùng kháng cự/hỗ trợ dựa trên biến động.
  - **Standard VWAP**: Tính toán đường giá trung bình theo phiên.
  - **BVC (Bulk Volume Classification)**: Thuật toán phân loại volume Buy/Sell từ dữ liệu OHLCV.

### 🌐 Kết nối & Dữ liệu
- **`js/api.js`**: 
  - Giao tiếp với Binance Futures API.
  - Hệ thống Cache nâng cao (Sử dụng `localStorage` cho 50k nến).
  - Quản lý WebSocket cho giá Realtime và Ticker.

### 🖼️ Đồ họa & Biểu đồ
- **`js/chart.js`**: 
  - Khởi tạo thư viện `lightweight-charts`.
  - Hệ thống **Canvas Overlay** xử lý việc vẽ các vùng chỉ báo (Cloud, Zones, Volume Profile) trên biểu đồ.
- **`js/interactions.js`**:
  - Xử lý các sự kiện chuột, chạm (touch) và bàn phím.
  - Chống Zoom trình duyệt (vô hiệu hóa pinch-zoom trang để nhường cho thư viện chart).

### 🛠️ Công cụ & Giao diện
- **`js/tools.js`**: Quản lý các chế độ vẽ (Rectangle, VP Zone, Measure) và công cụ **Analyse Cycle**.
- **`js/ui.js`**: Logic cho ô tìm kiếm symbol (hỗ trợ gợi ý và cache), quản lý Interval, Settings Panel và Cache Manager.

### 🚀 Khởi chạy
- **`js/main.js`**: Entry point của ứng dụng, kết nối tất cả các module và thực hiện quy trình khởi tạo khi trang load xong.

## 🛠️ Các thay đổi quan trọng vừa thực hiện
1. **Loại bỏ PWA**: Xóa bỏ hoàn toàn manifest, service worker và logic liên quan đến PWA để quay lại kiến trúc web chuẩn.
2. **Tăng Cache**: Nâng hạn mức lưu trữ từ 10k lên 50k nến.
3. **Price Scale thông minh**: Tự động định dạng số thập phân dựa trên mức giá của Symbol (BTCDUSDT vs các coin giá thấp).
4. **Touch Optimized**: Chỉnh sửa lại các công cụ vẽ để hoạt động mượt mà trên iPad và các thiết bị cảm ứng.
5. **Modularization**: Tách code ra 9 file JS riêng biệt để dễ tái sử dụng.
