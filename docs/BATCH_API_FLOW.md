# Batch API flow

Mục tiêu của flow này là giảm thao tác nhưng vẫn giữ nguyên các điều kiện an toàn đã kiểm chứng bằng flow một hóa đơn.

## Trạng thái triển khai 1.9.0

- Batch Review có nút `Lưu API & đối soát` cho từng phương án đã Accept.
- Nút `Lưu API N phiếu đã Accept` xử lý tuần tự, concurrency bằng 1.
- Payload được dựng từ `formData`, `RecordID`, mapper và Kendo detail của chính phiếu đang mở; không tái sử dụng ID/cookie từ cURL mẫu.
- Hàng đợi dừng ở lỗi đầu tiên. Các phiếu phía sau chưa được gửi.
- Response HTTP thành công chưa đủ để ghi tồn: extension đóng form, tìm lại đúng phiếu, mở lại và chạy đối soát đầy đủ trước khi commit.

## Điều kiện bắt buộc

- Chỉ xử lý phiếu chưa phát hành hóa đơn điện tử.
- Phương án hàng hóa phải khớp mã web và không vượt tồn khả dụng.
- Không dùng giảm giá.
- VAT là 10%.
- Tổng thanh toán phải khớp sao kê.
- Khi lưu:
  - `Tiền mặt = Tổng tiền`
  - `Khách đưa = Tổng tiền`
  - `Tiền thanh toán = Tổng tiền`
  - `Trả lại = 0`
- Không đánh dấu sao kê đã xử lý và không ghi sổ tồn chỉ vì API trả về thành công.

## Trình tự an toàn

1. Khóa giao dịch sao kê và tồn dự kiến bằng khóa ổn định:
   `transactionId + invoiceId + planHash`.
2. Đọc lại phiếu từ server và kiểm tra phiếu chưa phát hành.
3. Tính phương án từ tồn khả dụng tại thời điểm chạy.
4. Dựng payload theo đúng request lưu chính thức đã bắt từ Network.
5. Đặt toàn bộ trường thanh toán theo điều kiện bắt buộc ở trên.
6. Gửi một request lưu; giai đoạn đầu chạy tuần tự, concurrency bằng 1.
7. Đọc lại phiếu từ server, không chỉ tin response của request lưu.
8. Đối chiếu:
   - mã hàng và số lượng;
   - tiền hàng;
   - tiền giờ;
   - VAT;
   - tổng cộng;
   - trạng thái chưa phát hành.
9. Chỉ khi tất cả khớp mới:
   - đánh dấu giao dịch sao kê `Đã xử lý`;
   - commit sổ tồn;
   - ghi dấu thời gian và mã phiếu vào Batch Review.
10. Nếu đọc lại không khớp:
    - giữ sao kê ở `Chờ lưu/đối soát`;
    - không commit tồn;
    - lưu response và payload đã làm sạch để người dùng kiểm tra.

## Điều chưa được phép suy đoán

Endpoint, method, token chống giả mạo, tên trường payload và định dạng danh sách hàng phải được lấy từ một request `Lưu HĐ` thật trên Network. Không tái tạo chúng dựa trên tên nút hoặc HTML.

## Rollout

1. Chạy thử đúng một phiếu và đối chiếu thủ công.
2. Chạy tuần tự 3 phiếu, dừng ngay khi một phiếu sai.
3. Chạy batch nhỏ 10 phiếu.
4. Chỉ tăng quy mô sau khi log cho thấy không có ghi trùng, âm kho hoặc sai tiền.

Extension không tự phát hành hóa đơn điện tử trong flow này.
