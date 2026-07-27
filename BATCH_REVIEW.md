# Batch Review 1.3.2

Batch Review lập trước nhiều phương án từ các giao dịch sao kê chưa hoàn tất.

- Mỗi giao dịch chỉ tự gắn khi tìm được đúng một phiếu chưa xuất hóa đơn cùng ngày.
- Tồn kho được giữ chỗ cộng dồn theo thứ tự giao dịch; phương án sau không dùng lại phần tồn đã dành cho phương án trước.
- Màn hình hiển thị sao kê, số phiếu, tiền hàng, tiền giờ, VAT, trạng thái và chi tiết mã hàng.
- `Accept` chỉ ghi phương án đã duyệt vào hàng đợi `batch_ready`; chưa sửa và chưa lưu hóa đơn.
- Các phương án đã Accept được giữ nguyên khi mở lại Batch Review, không tự tính lại.
- Việc áp dụng, bấm `Lưu HĐ` và đối soát sau lưu vẫn thực hiện tuần tự từng hóa đơn để dùng validation chính thức của website.
- Cảnh báo native “không có dữ liệu” của website được chặn cục bộ trong lúc Batch Review tìm kiếm; cảnh báo ngoài thao tác batch không bị ảnh hưởng.
- Giữ và khôi phục bộ điều khiển danh sách của website sau mỗi lần đóng chi tiết phiếu, nên batch có thể mở nhiều phiếu liên tiếp và chạy lại.
- Lỗi mở/đọc một phiếu chỉ đánh dấu lỗi giao dịch đó; các giao dịch sau vẫn tiếp tục được lập phương án.
