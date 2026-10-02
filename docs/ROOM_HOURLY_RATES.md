# Đơn giá giờ hát theo phòng

## Đọc thẳng từ website (từ 1.29.8, mọi cơ sở)

Kim Giang đổi sang giá theo từng phòng (02/10/2026) nên mặc định 600.000đ không
còn đúng. Extension đọc **đơn giá `DONGIA` trên form của từng phòng** bằng đúng
request bước tạo phiếu đang dùng (GET `AddEdit` + `DBANID`, `RecordID` rỗng: chỉ
dựng form, không tạo bản ghi; xem `readRoomHourlyRates` trong `bridge.js`), rồi
lưu theo cơ sở ở `invoiceTargetRoomHourlyRates__<cơ sở>`.

- **Khi nào đọc:** tự đọc lại lúc bấm Tạo Batch Review nếu bảng cũ hơn 12 giờ;
  hoặc bấm **Đọc giá giờ các phòng** ở Batch Review. Đọc lỗi thì dùng bảng cũ.
- **Thứ tự ưu tiên:** giá đọc từ website → bảng cứng bên dưới (Nhơn) → 600.000đ.
  Phòng website không trả giá (`DONGIA` = 0) dùng giá dự phòng.
- **Phiếu mới:** chỉ thử các mức giá có phòng thật mang giá đó, rồi chỉ chọn
  phòng đúng mức của phương án (như Nhơn ở dưới).
- **Phiếu có sẵn:** dùng đơn giá ghi trên chính phiếu (`DONGIA`), vì website
  tính Tiền giờ của phiếu theo số đó kể cả khi phòng đã đổi giá. Phiếu không
  ghi đơn giá thì suy như cũ, có tính cả mức 600.000đ cho phiếu lập trước khi
  đổi giá.
- Phương án phiếu mới đã Accept theo giá cũ sẽ không tìm được phòng đúng giá;
  thông báo nhắc **Tính lại**.

Chưa xử lý giá theo khung giờ (giờ vàng, cuối tuần): bảng lấy giá form trả
về tại lúc đọc.

## Bảng cứng Paris Nhơn (dự phòng)

Khảo sát trực tiếp trên `banhang.thuanvietsoft.com/parisnhon` ngày 17/09/2026:
mở từng phòng ở màn hình Bán hàng, đặt `Ra` = `Giờ vào` + 1 giờ, đọc `Tiền giờ`
hệ thống tự tính. Đây là đơn giá tiền giờ hát thực tế của từng phòng, chưa VAT.

## Bảng giá

Giá **không** đồng nhất 600.000đ/giờ. Có ba mức, phân theo **số cuối** của tên
phòng, lặp lại giống nhau ở tầng 2, 3 và 4:

| Đuôi tên phòng | Đơn giá | Phòng |
|---|---|---|
| 3 | 800.000đ/giờ | VIP 23, 33, 43 |
| 6 | 400.000đ/giờ | VIP 26, 36, 46 |
| còn lại | 600.000đ/giờ | VIP 21, 22, 28, 31, 32, 38, 41, 42, 48, 51, 52, 55 |

Khu BÁN LẺ không phải phòng hát, không có tiền giờ và không bao giờ được dùng
để lập phiếu.

Chưa khảo sát giá theo khung giờ (giờ vàng, cuối tuần). Số liệu trên lấy khoảng
11h-12h ngày thường. Kim Giang và Linh Đàm chưa khảo sát nên vẫn dùng 600.000đ.

## Vì sao đơn giá ảnh hưởng toàn bộ phương án

Website làm tròn thời lượng tới 0,01 giờ, nên **bước giá Tiền giờ là 1% đơn
giá**: 6.000đ ở phòng 600k, 4.000đ ở phòng 400k, 8.000đ ở phòng 800k. Đơn giá
vì thế quyết định ba thứ:

1. **Bước giá** Tiền giờ có thể biểu diễn được.
2. **Sàn theo phút**: 50 phút ở phòng 400k là 333.333đ, không phải 500.000đ.
3. **Thời lượng gợi ý** để sinh giờ vào/ra.

## Cách extension xử lý

Phương án và phòng không còn độc lập, nên `chooseNewInvoiceRoomPlan` thử lần
lượt cả ba mức đơn giá rồi chọn mức cho phương án đẹp nhất, theo thứ tự:

1. Phần bù vào Tiền giờ nhỏ nhất (phương án tự nhiên nhất).
2. Thời lượng gần 90 phút nhất (một ca hát thực tế).
3. Đơn giá thấp hơn (phòng rẻ thường dễ còn trống hơn).

Phương án ghi lại `hourlyRate` đã dùng. Khi mở form, extension **chỉ chọn phòng
có đúng đơn giá đó** — mở phòng khác hạng sẽ cho Tiền giờ khác và phiếu lệch
tổng. Nếu không còn phòng trống đúng hạng, thông báo nêu rõ đơn giá mà phương án
đang cần.

## Khi giá đổi

Sửa bảng `PARIS_NHON_ROOM_HOURLY_RATES` trong `content.js` (khóa là số cuối tên
phòng). Nếu website đổi sang cách đặt giá khác (ví dụ theo từng phòng riêng lẻ
chứ không theo đuôi số), cần thay bảng này bằng bảng tra theo tên phòng đầy đủ,
hoặc đọc đơn giá thẳng từ API sơ đồ phòng nếu về sau nó trả thêm trường giá.

## Đơn giá lưu trên phiếu (`DONGIA`)

Đầu phiếu có trường `DONGIA` là đơn giá giờ của phòng. Khi tạo phiếu mới (cả
cách đọc form bằng API lẫn cách mở tab phụ), extension:

- **lưu `DONGIA` bằng đúng đơn giá của phương án** (dạng `"400000.00"`), giống
  các script chuyển phòng trong `data/` đã chạy trên trang thật. Form đọc bằng
  API có thể chưa được giao diện điền đơn giá; để 0 thì Tiền giờ không còn khớp
  đơn giá × thời lượng;
- **dừng trước khi gửi** nếu form phòng có sẵn đơn giá KHÁC phương án. Đó là
  dấu hiệu bảng giá ở đây sai cho phòng đó.

Kim Giang và Linh Đàm chưa khảo sát nên dùng 600.000đ cho mọi phòng. Nếu phòng
nào ở hai cơ sở này có đơn giá khác, phiếu mới ở phòng đó sẽ bị chặn với thông
báo nêu đơn giá trên website — khi đó cần bổ sung bảng giá cho cơ sở. Nút
**Kiểm tra tạo phiếu không cần tab phụ** báo trước đơn giá form trả về.
