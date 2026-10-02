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

# Đối soát lại từ website

Phiếu đã đối soát có thể bị sửa ngoài extension, ví dụ chuyển phiếu khỏi quầy
BÁN LẺ sang phòng hát và đổi số lượng một dòng hàng để tiền giờ khớp bước giá
phòng mới (các script `data/chuyen-phong-*.js`). Sổ đối soát khi đó vẫn giữ dòng
hàng cũ, mà sổ lại là nguồn mặt hàng khi phát hành HĐĐT và xuất file hạch toán.

## Tự động ở bước phát hành

Ở màn **Phát hành hóa đơn**, mỗi lần **Tải danh sách** và mỗi lần bấm **Phát
hành**, extension so nhanh tiền hàng của từng phiếu chưa phát hành trên website
với tổng dòng hàng trong sổ. Bước này chỉ đọc (`GET AddEdit?RecordID=…`), không
mở phiếu, khoảng một request mỗi phiếu.

- Phiếu lệch được đánh dấu ⚠ ở cột mặt hàng.
- Khi phát hành, bước **lấy mặt hàng** của phiếu lệch đọc lại từ phiếu trên
  website thay vì tin sổ (cần màn hình danh sách Bán hàng, extension tự chuyển).
  Phát hành xong, sổ đối soát và tồn kho được cập nhật theo phiếu thật. Hộp xác
  nhận phát hành nêu rõ các phiếu này.

## Nút "Đối soát lại mặt hàng từ website"

Ở màn **Phát hành hóa đơn**, cạnh **Thử đọc mặt hàng**. Dùng khi muốn cập nhật
sổ ngay mà chưa phát hành.

1. Mở danh sách Bán hàng, chọn ngày ở màn Phát hành rồi bấm **Tải danh sách**.
2. Bấm **Đối soát lại mặt hàng từ website**. Extension so nhanh mọi phiếu chưa
   phát hành, rồi chỉ mở những phiếu lệch để đọc dòng hàng thật.
3. Hộp thoại liệt kê các phiếu có dòng hàng khác sổ. Bấm OK để cập nhật.

Khi cập nhật:

- Chỉ hoàn/trừ tồn đúng các mã thay đổi; mã giữ nguyên không bị đụng.
- Sổ đối soát nhận dòng hàng của phiếu thật (tăng `revision`, ghi `resyncNote`).
- Phương án đã duyệt của giao dịch và phòng/giờ của phiếu mới được cập nhật theo
  phiếu thật, để lịch phòng của các phiếu mới kế tiếp trong ngày đúng phòng mới.
- Tất cả ghi xuống storage trong **một lần**, có kiểm tra phiên bản sao kê.
- **Phiếu trên website không bị sửa.**

Không tự xử lý:

| Trường hợp | Xử lý |
|---|---|
| Tổng tiền phiếu khác sổ | Chỉ báo; cần người kiểm tra vì phiếu không còn khớp sao kê |
| Phiếu không còn trong danh sách Chưa xuất hóa đơn | Giữ nguyên sổ; thường là phiếu đã phát hành HĐĐT |
| Tồn không đủ cho phần tăng thêm | Dừng cả lần cập nhật, không ghi nửa vời |
