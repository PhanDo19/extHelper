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
- Không tự bấm Lưu HĐ, Hủy HĐ hoặc Phát hành.

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
