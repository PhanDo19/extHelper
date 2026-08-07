# Đặc tả bắt buộc

## Nguồn sự thật

- Kho quyết định sản phẩm được phép bán và số lượng tối đa.
- `data.xlsx` là danh mục web chuẩn, hiện có 143 mã trong `web-catalog.js`.
- Khi nhập `data.xlsx` mới, cập nhật tên/đơn vị/giá theo `webCode`; mã web bị xóa phải chuyển ánh xạ confirmed về `review`.
- Web cung cấp `webCode`, `webName`, `webUnit`, `webPrice`; không dùng hàng cũ trong hóa đơn làm bằng chứng còn tồn.

## Mô hình ánh xạ

```text
stockCode, stockName, stockUnit, stockQty, conversion, availableQty, salePrice
webCode, webName, webUnit, webPrice
status, confidence, confirmedAt, reviewNote, suggestions
```

Trạng thái: `confirmed`, `review`, `unmatched`, `disabled`. Chỉ `confirmed` có tồn dương được sử dụng.

Không tự xác nhận ánh xạ mới. Việc trùng giá chỉ là tín hiệu, không đủ để kết luận hai sản phẩm là một.

## Bộ giải

- Mọi mã bắt đầu từ số lượng 0.
- `proposedQty <= floor(availableQty)`.
- Ngoại lệ hoa quả: `TC` = đĩa nhỏ 350.000, `TCTO` = đĩa to 400.000 theo giá hiện hành trên web; tổng số lượng `TC + TCTO <= 1` trên mỗi hóa đơn.
- Không giữ tiền của hàng cũ như khoản cố định.
- Dùng giá web để tính phương án hóa đơn.

## An toàn thao tác web

- Trước khi áp dụng phải lưu snapshot các dòng hiện tại để hoàn tác.
- Xóa/đặt 0 toàn bộ hàng cũ, thêm mã web trong phương án, đọc lại tổng và so sánh mục tiêu.
- Nếu mã/giá web thay đổi hoặc không thêm được, dừng và hoàn tác.
- Không tự bấm Lưu HĐ hoặc Hủy HĐ.
- Payload `DoSave` do extension dựng phải đặt `PHUONGTHUCTT = "TM/CK"` (phiếu bắt nguồn từ giao dịch chuyển khoản), ở cả luồng sửa phiếu có sẵn lẫn tạo phiếu mới. Payload bắt được từ nút Lưu của website giữ nguyên phương thức của website.

## Phát hành hóa đơn điện tử

- Chỉ chạy ở sub-tab `Phát hành hóa đơn` trong tab `Giao dịch ngân hàng`, trên các dòng người dùng tự tích chọn.
- Mặc định chỉ hiện hóa đơn đã gắn với một giao dịch trong sao kê. Phiếu ngoài giao dịch phải chủ động bật mới thấy, và phải được nêu rõ trong hộp thoại xác nhận.
- Chỉ được chọn trong số dòng đang hiện; dòng bị bộ lọc ẩn không được nằm trong lô phát hành.
- Mọi phản hồi từ bridge phải đi qua `respond()`; không request nào được phép không có phản hồi.
- Bắt buộc một hộp thoại xác nhận cho cả lô trước khi gọi API; không có đường nào phát hành ngầm.
- Thứ tự mỗi hóa đơn: lấy mặt hàng → `kiemTraThongTin` → `phatHanhHoaDon`. Lấy mặt hàng trước để nếu bước này hỏng thì chưa có gì thay đổi trên hệ thống.
- Mặt hàng ưu tiên lấy từ sổ đối soát sau lưu; đó là số liệu đã được kiểm tra lại với phiếu khi trừ tồn. Không mở lại phiếu khi đã có trong sổ.
- Chỉ hóa đơn thiếu trong sổ mới đọc lại bằng luồng mở phiếu sẵn có (nhấp đúp trên danh sách Bán hàng → `scan()` → đóng form), không tự chế đường đọc riêng.
- Thiếu màn hình danh sách Bán hàng không được chặn cả lô; chỉ cảnh báo số hóa đơn sẽ thiếu số liệu hạch toán.
- Ràng buộc "Chưa xuất hóa đơn" của `openInvoiceCandidate` chỉ áp cho luồng lập/sửa phương án; luồng chỉ-đọc dùng `openInvoiceRowForReading` và không được nới lỏng ràng buộc đó.
- Phiếu mở ra để đọc phải luôn được đóng lại; mở nhầm số phiếu khác thì dừng.
- Hóa đơn đã có `SOHOADON` hoặc đã hủy không được chọn lại.
- Mỗi hóa đơn phát hành xong được ghi sổ ngay; lô dừng giữa chừng vẫn giữ đủ số liệu phần đã chạy.
- Sổ phát hành khóa theo `invoiceId`: phát hành lại hoặc chạy lại lô chỉ ghi đè, không cộng dồn số lượng.
- Extension không tự hủy hóa đơn đã phát hành.

## Xuất kho để hạch toán

- Nút `Xuất kho đã phát hành (Excel)` nằm ở tab Kho, xuất `.xlsx` mỗi dòng hàng một dòng: mã phiếu, ngày, số hóa đơn, mã hàng, tên hàng, tên hàng kho, số lượng, giá tiền, thành tiền.
- Số lượng/giá/thành tiền phải là ô số để Excel tính tổng được.
- Cột tên hàng kho lấy từ ánh xạ `confirmed`. Mã web gom từ nhiều dòng kho thì ghép tên kho vào một ô và giữ nguyên số lượng; không được chia nhỏ số lượng theo phỏng đoán.
- File chỉ phục vụ hạch toán: không chứa sao kê, ánh xạ hay danh mục web.
- Hóa đơn chưa đọc được mặt hàng không sinh dòng nào nhưng phải được đếm và cảnh báo.

## Sao kê ngân hàng

- Ngày hóa đơn bắt buộc bằng `Ngày giao dịch/Transaction date`.
- Tổng tiền mục tiêu lấy từ `Có/Credit`; Debit không tạo công việc hóa đơn.
- Chống trùng ưu tiên `Số bút toán/Reference number`, dự phòng bằng ngày giờ + ngày giao dịch + số tiền + diễn giải.
- Dòng Credit không có dấu hiệu chuyển khoản được đưa vào `review`, không tự xử lý.
- Trạng thái: `pending`, `review`, `planned`, `done`, `ignored`.
# Luồng chọn phiếu bán hàng (MVP 0.4)

1. Người dùng mở danh sách **Bán hàng** và chọn một giao dịch trong sao kê.
2. Extension đặt bộ lọc Từ/Đến bằng ngày giao dịch rồi gọi Refresh.
3. Phiếu đã gắn với giao dịch khác bị loại.
4. Một ứng viên: tự double-click để mở. Nhiều ứng viên: người dùng chọn.
5. Lưu `invoiceNo` và `linkedAt`; không tự lưu, hủy hay phát hành hóa đơn.
