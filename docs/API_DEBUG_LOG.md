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

## Tắt tự tải file sau mỗi lần tạo phiếu

Từ 1.27.1, thanh **Batch API** có ô **Tự tải file log sau mỗi lần tạo phiếu**. Bỏ tích thì extension chỉ lưu log vào `chrome.storage.local`, không tải file; khi cần vẫn bấm **Xuất log API gần nhất**. Tùy chọn này dùng chung cho mọi cơ sở và được nhớ giữa các lần mở trang.

Nếu mỗi lần tải Chrome hiện hộp thoại hỏi nơi lưu, đó là do cài đặt của Chrome tại `chrome://settings/downloads` → **Hỏi vị trí lưu mỗi tệp trước khi tải xuống** đang bật. Extension gửi `saveAs: false` nhưng Chrome vẫn ưu tiên cài đặt này.

Việc tải file **không** ảnh hưởng tới kết quả tạo phiếu: log được lưu vào storage trước khi tải, và hủy hộp thoại lưu chỉ ghi cảnh báo ra console. Trước 1.27.1, hủy hộp thoại lưu làm luồng tạo phiếu ném lỗi sau khi API đã thành công, nên phiếu có trên website mà giao dịch vẫn ở trạng thái chưa tạo.
