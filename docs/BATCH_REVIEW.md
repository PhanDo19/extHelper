# Batch Review

Batch Review lập trước nhiều phương án từ các giao dịch chưa hoàn tất (sao kê ngân hàng hoặc danh sách số tiền CK/TM), rồi lưu và đối soát tuần tự bằng API chính thức của website.

- Giao dịch được sắp theo ngày → giờ giao dịch → thứ tự dòng trong file, tối đa 500 giao dịch mỗi lượt. Giao dịch ở trạng thái `review` (Credit không rõ là chuyển khoản, hoặc từ 20 triệu trở lên) không được lập phương án cho tới khi người dùng bấm **Là doanh thu**.
- Tồn kho được giữ chỗ cộng dồn theo thứ tự giao dịch, kể cả các phương án đã Accept nằm ngoài khoảng ngày đang xem.
- `Accept` chỉ ghi phương án đã duyệt vào hàng đợi `batch_ready`; chưa sửa và chưa lưu hóa đơn.
- Các phương án đã Accept được giữ nguyên khi mở lại Batch Review. Khi mốc công thức (`CALCULATION_VERSION`) đổi, phương án cũ tự bị hủy và giao dịch quay về **Chờ xử lý**.
- Cảnh báo native “không có dữ liệu” của website được chặn cục bộ trong lúc Batch Review tìm kiếm.
- Lỗi mở/đọc một phiếu chỉ đánh dấu lỗi giao dịch đó; các giao dịch sau vẫn tiếp tục được lập phương án. Ba dòng lỗi quá tải liên tiếp thì extension tự tải lại trang rồi chạy tiếp.

## Chọn phiếu cho một giao dịch

1. **Có phiếu chưa xuất hóa đơn cùng ngày**: xếp theo độ gần số tiền sao kê, mở thử tối đa 3 phiếu và ưu tiên phiếu có giờ vào/ra rơi đúng ngày sao kê. Không phiếu nào khớp ngày thì dời ca của một phiếu sang ngày sao kê. Không đọc được phiếu nào thì báo `error`, không gán nhầm.
2. **Không còn phiếu chưa xuất**: dò hóa đơn **đã xuất** cùng ngày có tổng khớp tuyệt đối.
   - Khớp → `already_issued` (“Đã có HĐ khớp”). Người dùng bấm `Xác nhận đã có HĐ <số phiếu>` thì giao dịch mới chuyển `done`; extension không tự gắn.
   - Dò lỗi → `lookup_error`. Chỉ được dò lại; extension không lập phiếu mới trong trạng thái này để tránh tạo trùng.
3. **Không có cả hai**: lập phương án **phiếu mới** (`requiresNewInvoice`), gồm giờ vào/ra (rải từ 17:00 theo slot trong ngày) và đơn giá phòng. Tính được thì dòng ở trạng thái `ready` như phiếu thường; không tính được thì `needs_new_invoice` kèm lý do.

Trạng thái `needs_choice` chỉ còn xuất hiện ở phiên lưu từ bản cũ; Batch Review hiện tự chọn bằng cách mở thử phiếu.

## Lưu API và đối soát

Nút **Lưu API N phiếu đã Accept** xử lý tuần tự, dừng ở lỗi đầu tiên, tự tải lại trang sau mỗi 15 phiếu.

- **Phiếu có sẵn**: mở đúng phiếu, gửi `DoSave` bằng API, đóng form.
- **Phiếu mới**: tab gốc mở một tab Bán hàng phụ. Tab phụ tự chọn phòng trống đúng đơn giá của phương án (theo sơ đồ phòng website trả về, không chồng giờ với phiếu khác trong ngày, không bao giờ chọn `BÁN LẺ`), gửi hai request `DoSave` (mode=0 tạo phiên, mode=2 thanh toán), ghi kết quả rồi tự đóng.
- Sau mỗi phiếu, tab gốc mở lại phiếu **từ danh sách trên server** và đối soát tuyệt đối với phương án. Chỉ khi khớp mới đánh dấu giao dịch `done` và trừ tồn kho.

### Chống tạo trùng phiếu mới

- Trước khi gửi API tạo phiếu, extension ghi dấu `newInvoiceCreateStartedAt` vào giao dịch. Lần gửi trước chưa có kết quả chắc chắn (tab bị đóng, hết giờ, website báo lỗi sau khi đã nhận request) thì mọi lần chạy lại đều bị chặn.
- Lỗi xảy ra **trước** khi request được gửi thì được gỡ dấu và thử lại bình thường.
- Tạo phiên thành công mà bước thanh toán lỗi: thông báo nêu rõ số phiếu và ID phiên tạo dở.
- Tab phụ gặp lỗi (không có phòng trống, không áp được phương án…) thì báo về ngay; tab gốc dừng lô với đúng lý do.
- Gỡ chặn: kiểm tra danh sách Bán hàng ngày đó. Có phiếu rồi → **Đặt lại** giao dịch và **Tạo Batch Review** để gắn đúng phiếu; chưa có → **Đặt lại** rồi chạy lại.

## Phiên làm việc

- Phiên Batch Review (danh sách phương án, khoảng ngày, giới hạn, giao dịch đang tạo phiếu mới) được lưu vào `chrome.storage.local` và khôi phục khi tải lại trang. Phiên chỉ lưu `transactionId`; dữ liệu giao dịch được liên kết lại với bản sao kê mới nhất.
- Tab phụ chỉ tự mở phòng **một lần** cho mỗi lượt; nếu tab phụ bị tải lại sau khi đã mở form, extension không tự mở lại mà báo lỗi về tab gốc.
- Phiên tự hết hạn sau 7 ngày. Đóng chế độ xử lý hàng loạt (bấm lại nút **Mở xử lý hàng loạt**) sẽ xóa phiên Batch Review đã lưu.
