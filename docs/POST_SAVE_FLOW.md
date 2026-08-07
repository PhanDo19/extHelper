# Đối soát sau lưu — phiên bản 1.1.0

1. Extension chỉ tạo trạng thái `planned` sau khi phương án đã được áp dụng thành công vào form.
2. `pendingPlan` lưu số phiếu, ngày, hàng hóa, tiền hàng, tiền giờ, VAT và tổng cộng.
3. Người dùng bấm **Lưu HĐ** bằng nút chính thức của website.
4. Mở lại phiếu và bấm **Đối soát sau lưu** trong extension.
5. Extension đọc lại toàn bộ phiếu và yêu cầu khớp tuyệt đối với `pendingPlan`.
6. Chỉ khi khớp mới đồng thời:
   - chuyển giao dịch sao kê sang `done`;
   - trừ lượng hàng đã sử dụng khỏi tồn kho nội bộ;
   - ghi nhật ký theo `transactionId`.

Mặt hàng có `availabilityMode: "per_invoice"` không bị trừ khỏi tồn kho tổng. Nhật ký đảm bảo một giao dịch không thể trừ tồn kho hai lần.
