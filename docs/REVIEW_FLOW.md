# Màn hình duyệt phương án — phiên bản 1.2.0

Trước khi thay đổi form, extension hiển thị:

- tổng sao kê;
- tổng hiện tại;
- tổng dự kiến;
- chênh lệch;
- so sánh tiền hàng, tiền giờ, VAT và tổng cộng;
- trạng thái khớp ngày, tồn kho, tổng tiền và quy tắc không giảm giá;
- bảng chi tiết toàn bộ dòng bị xóa và dòng được thêm.

Nút **Accept — áp dụng vào phiếu** mặc định bị khóa. Nút chỉ được bật khi:

1. tổng dự kiến khớp tuyệt đối với sao kê;
2. ngày phiếu khớp ngày giao dịch;
3. mọi số lượng đều nằm trong giới hạn tồn;
4. có ít nhất một mặt hàng trong phương án;
5. người dùng tích xác nhận đã kiểm tra.

Sau khi Accept thành công, nút được khóa để tránh áp dụng lặp ngoài ý muốn. Người dùng vẫn là người bấm **Lưu HĐ** của website.
