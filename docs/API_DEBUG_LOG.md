# Log API tạo hóa đơn

Từ phiên bản 1.19.20, mỗi lần extension tạo hóa đơn mới sẽ tự động ghi lại chính xác hai request `DoSave` và response tương ứng.

Log bao gồm:

- cơ sở và URL nguồn;
- dữ liệu kỳ vọng: ngày sao kê, giờ vào/ra, tiền hàng, tiền giờ, VAT, tổng tiền và chi tiết hàng;
- request `mode=0` tạo phiên;
- request `mode=2` thanh toán ID vừa tạo;
- toàn bộ body gửi đi, HTTP status và JSON server trả về;
- kết quả thành công hoặc nội dung lỗi.

Cookie, `Authorization` và `Proxy-Authorization` luôn bị loại khỏi log.

Chrome không cho extension ghi trực tiếp vào thư mục source tùy ý. Vì vậy file runtime được tải xuống thư mục Downloads với tên:

`invoice-api-debug-<cơ-sở>-<ngày-sao-kê>-<timestamp>.json`

Bản log gần nhất đồng thời được lưu trong `chrome.storage.local`. Có thể tải lại bằng nút **Xuất log API gần nhất** trong khu vực Batch API.
