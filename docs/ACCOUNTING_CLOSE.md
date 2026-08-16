# Kiểm tra và chốt kỳ kế toán

Tại màn hình tổng quan kế toán, chọn khoảng ngày rồi dùng **Kiểm tra sẵn sàng**. Extension kiểm tra đồng thời:

1. Danh mục mặt hàng đã đồng bộ từ website.
2. Tồn kho vật lý đã được khởi tạo.
3. Không còn ánh xạ mặt hàng chờ duyệt hoặc chưa khớp.
4. Có giao dịch sao kê trong kỳ đã chọn.
5. Không còn giao dịch chưa hoàn tất.
6. Các phiếu đã đối soát đều đã phát hành hóa đơn điện tử.

Mỗi điều kiện chưa đạt có nút mở đúng màn hình cần xử lý. Việc kiểm tra chỉ đọc dữ liệu và không ghi tồn kho, sửa sao kê hoặc phát hành hóa đơn.

## Xuất báo cáo

Nút **Xuất Excel đối soát** tạo workbook gồm ba sheet:

- `Tong quan`: cơ sở, kỳ báo cáo, tổng sao kê, đã đối soát, chưa hoàn tất và trạng thái chốt kỳ.
- `Giao dich`: toàn bộ giao dịch trong kỳ, phiếu liên kết và trạng thái xử lý.
- `Ton dong`: giao dịch chưa hoàn tất hoặc phiếu chưa phát hành để kế toán tiếp tục xử lý.

Báo cáo vẫn có thể xuất khi kỳ chưa đủ điều kiện chốt để kế toán kiểm tra ngoại lệ. File được tạo trực tiếp trong extension, không cần backend.
