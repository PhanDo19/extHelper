# Hoàn kho để chạy lại một lô

Khi một lô đã đối soát nhưng phương án sai (lập nhầm phòng, sai đơn giá giờ, tổ
hợp hàng không hợp lý), cần trả số lượng đã trừ về kho rồi chạy lại Batch Review.
Nút **Hoàn kho theo khoảng ngày** nằm ở màn hình **Kho vật lý**.

## Cách dùng

1. Mở màn Kho vật lý, chọn `Từ ngày` và `Đến ngày` theo **ngày giao dịch sao kê**
   (không phải ngày ghi sổ).
2. Bấm **Hoàn kho theo khoảng ngày**. Hộp thoại liệt kê số giao dịch, số lượng sẽ
   trả về kho theo từng mặt hàng, và danh sách số phiếu đã lưu trên website.
3. Xác nhận. Extension trả tồn, đưa các giao dịch về **Chưa xử lý**, và xóa phiên
   Batch Review hiện tại.
4. Bấm **Tạo Batch Review** để lập lại phương án.

## Phạm vi

Chỉ tác động dữ liệu **trong extension**: tồn kho riêng của cơ sở, kho vật lý dùng
chung, sổ đối soát và trạng thái sao kê.

**Hóa đơn đã lưu trên website KHÔNG bị xóa.** Extension không tự xóa phiếu vì thao
tác đó không hoàn tác được và có thể đụng vào số hóa đơn đã phát hành. Danh sách số
phiếu được nêu trong hộp thoại xác nhận, trong thông báo sau khi chạy, và trong ghi
chú của từng giao dịch (`restockedNote`). Kế toán tự kiểm tra và xử lý trên website.

Nếu phiếu cũ vẫn còn trên website, lần chạy lại sẽ thấy nó ở danh sách "chưa xuất
hóa đơn" và có thể gán lại cho giao dịch, thay vì tạo phiếu mới.

## Vì sao lấy từ sổ đối soát

Mỗi lần ghi sổ, extension lưu đúng danh sách mặt hàng và số lượng đã trừ
(`verificationLedger`). Hoàn kho cộng ngược lại đúng những dòng đó.

Không suy từ phương án hiện tại của giao dịch: phương án có thể đã được tính lại
sau đó và khác với thứ thực sự đã trừ, hoàn theo nó sẽ làm sai tồn.

## Các trường hợp không hoàn

| Trường hợp | Xử lý |
|---|---|
| Mặt hàng bán theo suất (đĩa hoa quả) | Không trừ tồn nên cũng không hoàn |
| Bản ghi sổ không còn giao dịch sao kê | Bỏ qua, vì không có ngày để lọc theo khoảng |
| Mã web đã bị gỡ ánh xạ | Dừng hẳn, báo rõ mã; không ghi nửa vời |
| Giao dịch chưa đối soát | Không có trong sổ nên không bị đụng |

Mọi thay đổi được ghi xuống storage trong **một lần** (`commitVerifiedInvoice`), nên
lỗi giữa chừng không để lại trạng thái nửa vời. Kho vật lý dùng chung cũng được cộng
lại kèm một dòng vết trong sổ kho, để hai cơ sở không lệch nhau.

Sổ đối soát xóa đúng các bản ghi đã hoàn, nên không thể hoàn kho hai lần cho cùng
một giao dịch.
