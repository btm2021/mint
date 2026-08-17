// ============================================================
// stat7-config.js — SEED CẤU HÌNH CHO STAT7
// Chạy TRƯỚC stat5-config.js: nếu chưa có config đã lưu, seed
//   - barLimit = 10000 (10k bars)
//   - snd.enabled = false      → ẩn zone rectangles trên chart
//                                (zones vẫn detect, xem trong list bên phải)
//   - vsrOverlap showHatch/label off → giảm overlay đè nến
// Khi user đổi cài đặt, config được lưu lại bình thường.
// ============================================================

if (typeof localStorage !== "undefined" && !localStorage.getItem("stat5_config_v1")) {
  try {
    localStorage.setItem("stat5_config_v1", JSON.stringify({
      barLimit: 10000,
      snd: { enabled: false },
      vsrOverlap: { showHatch: false, showLabel: false },
    }));
  } catch (e) { }
}