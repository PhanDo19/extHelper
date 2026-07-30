# Batch Review 1.3.10

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

## Khi không có phiếu chưa xuất hóa đơn

Trước đây trường hợp này bị gộp chung thành `Lỗi`. Nay Batch Review tách thành hai trạng thái:

- **`already_issued` — “Đã có HĐ khớp”**: sau khi không còn phiếu chưa xuất, Batch Review lọc lại danh sách
  theo bộ lọc “Đã xuất hóa đơn” cùng ngày và tìm hóa đơn có tổng cộng khớp tuyệt đối số tiền giao dịch
  (so sánh sau `Math.round`). Hóa đơn đã gắn cho giao dịch khác bị loại khỏi kết quả.
  - Khớp đúng một hóa đơn: hiện nút `Xác nhận đã có HĐ <số phiếu>`. Bấm nút mới gắn số phiếu vào giao dịch,
    chuyển giao dịch sang `done` và ghi `reconciledNote`. Extension không tự gắn.
  - Khớp nhiều hóa đơn: hiển thị danh sách chọn; người dùng phải chọn đúng số phiếu rồi mới có thể xác nhận.
- **`needs_new_invoice` — “Cần tạo phiếu”**: không có phiếu chưa xuất và cũng không có hóa đơn đã xuất khớp
  số tiền. Nút `Mở màn hình Bán hàng để tạo phiếu` chỉ **điều hướng** và hiển thị gợi ý ngày + tổng mục tiêu;
  extension KHÔNG tự tạo, điền hay lưu phiếu. Sau khi người dùng tự lưu phiếu mới, chạy lại Batch Review.

Nếu việc dò hóa đơn đã xuất bị lỗi (bridge timeout, chưa mở danh sách Bán hàng…), giao dịch được xếp vào
`lookup_error`. Người dùng chỉ được thử dò lại; extension không gợi ý tạo phiếu mới trong trạng thái này để
tránh tạo trùng hóa đơn.

Khi có nhiều phiếu **chưa xuất** cùng ngày, mỗi dòng `needs_choice` có danh sách chọn. Sau khi người dùng chọn,
extension lưu liên kết tạm và tính lại toàn bộ Batch Review để giữ đúng thứ tự giữ chỗ tồn kho.

Hai trạng thái này được đếm riêng trong KPI (`Đã có HĐ khớp`, `Cần tạo phiếu`) nên không còn bị tính vào
ô `Cần xử lý`.

## Giữ phiên khi chuyển sang Bán hàng

- Khi bấm `Mở tab Bán hàng mới để tạo phiếu`, extension giữ nguyên tab danh sách hiện tại, mở Bán hàng trong tab mới và lưu Batch Review, giới hạn batch,
  giao dịch cần tạo phiếu và trạng thái mở/đóng panel vào `chrome.storage.local`.
- Sau khi tab Bán hàng mới nạp xong, extension tự mở cả panel lẫn chế độ Batch Review, hiển thị thẻ giao dịch và tự chọn phòng không hoạt động đầu tiên theo thứ tự website để mở form tạo phiếu.
- Phòng chỉ được coi là rảnh khi ô phòng chỉ hiển thị đúng tên phòng, không có thời lượng/trạng thái hoạt động. `BÁN LẺ` luôn bị loại khỏi danh sách tự chọn.
- Nếu không có phòng rảnh, extension dừng và báo lỗi; không mở `BÁN LẺ` hoặc phòng đang hoạt động.
- Liên kết Bán hàng được đọc cả khi thanh menu website đang thu gọn; tab mới không còn rơi về URL danh sách hóa đơn hiện tại.
- Mỗi lần bấm `needs_new_invoice` chỉ tự mở phòng một lần. Nếu người dùng bấm `Thoát` hoặc tải lại tab, extension không tự mở lại form; bấm lại dòng `needs_new_invoice` sẽ bắt đầu một lượt mới.
- Extension chỉ mở form; không tự bấm `Lưu HĐ`, `Hủy HĐ` hay `Phát hành`.
- Phiên UI chỉ lưu `transactionId`; dữ liệu giao dịch được liên kết lại với bản sao kê mới nhất khi khôi phục.
- Phiên tự hết hạn sau 7 ngày. Chọn `Quay lại tính toán` sẽ xóa phiên Batch Review đã lưu.
