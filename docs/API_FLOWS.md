# Đặc tả API hóa đơn và kế hoạch chuyển Batch sang API thuần

## 1. Mục tiêu

Tài liệu này là nguồn bàn giao để Codex/VS Code tiếp tục phát triển extension tại:

`C:\Users\dopt\Documents\Codex\2026-07-20\h\outputs\invoice-target-mvp`

Mục tiêu cuối cùng:

1. Batch Review tính trước hàng hóa, tiền giờ, VAT và tổng cộng.
2. Người dùng kiểm tra và Accept các phương án.
3. Extension tạo hoặc cập nhật từng phiếu bằng API chính thức của website.
4. Sau mỗi lần lưu, extension đọc lại phiếu và chỉ đối soát/trừ kho khi dữ liệu khớp tuyệt đối.
5. Không thao tác phát hành hóa đơn điện tử.

## 2. Nguyên tắc an toàn

- Không lưu Cookie, Authorization, Proxy-Authorization hoặc thông tin đăng nhập trong mã nguồn, fixture hay tài liệu.
- Không coi HTTP 200 là thành công nghiệp vụ.
- Không trừ kho khi chưa đọc lại phiếu sau lưu.
- Không dùng giảm giá; các trường giảm giá phải bằng 0.
- Xử lý tuần tự một phiếu tại một thời điểm để tránh xung đột `LASTSAVEID` và tồn kho.
- Khi server báo dữ liệu đã thay đổi, dừng hàng đợi và đọc lại phiếu; không tự retry bằng payload cũ.

## 3. API đã xác nhận

### 3.1 Lưu tạo mới/cập nhật hóa đơn

| Thuộc tính | Giá trị |
| --- | --- |
| Method | `POST` |
| URL | `/pariskimgiang/AddEdit/DoSave?is_ajax=1` |
| Content type | Dùng đúng mẫu request website đã bắt; hiện tại là form/urlencoded chứa các khối JSON |
| Bảng | `d56b4b85-68c8-44c1-947d-9f3899e55a7c` |
| Kết quả thành công | Body JSON có `code === 1` và `Tag.ID` hợp lệ |

HTTP 200 với `code === 0` là thất bại. Ví dụ lỗi lạc phiên:

```json
{
  "code": 0,
  "message": "HÓA ĐƠN ĐÃ THAY ĐỔI VUI LÒNG THỰC HIỆN LẠI",
  "Tag": "9999"
}
```

### 3.2 Mở form phiếu mới — đã xác nhận bằng hai trace độc lập

Hai file trace ngày 02/08/2026 có cùng 5 request, cùng URL, body, thứ tự và HTTP 200. Fixture đã làm sạch nằm tại `fixtures/api/create-invoice-init.sanitized.json`.

| Thứ tự | Method và endpoint | Vai trò | API-only có bắt buộc không? |
| --- | --- | --- | --- |
| 1 | `GET /pariskimgiang/AddEdit` | Render/khởi tạo form theo phòng | Chỉ cần khi mở UI hoặc cần lấy mẫu HTML mới |
| 2 | `POST /pariskimgiang/DataGrid/GetDataSearchData` | Nạp lưới mặt hàng | Không, nếu extension đã có danh mục và ID web |
| 3 | `POST /pariskimgiang/Service/GridLookupData` | Lookup khách hàng/CLB | Không, nếu payload không dùng lookup này |
| 4 | `POST /pariskimgiang/Service/GridLookupData` | Lookup UI, response rỗng trong cả hai trace | Không |
| 5 | `POST /pariskimgiang/Service/GridLookupData` | Lookup UI, response rỗng trong cả hai trace | Không |

Query quan trọng của request đầu:

```text
TableID=d56b4b85-68c8-44c1-947d-9f3899e55a7c
RecordID=
Loai=0
MaxTab=0
NOTITLE=1
DBANID=<ROOM_ID>
DKHUVUCID=<AREA_ID>
is_dialog=1
```

Kết luận quan trọng:

- `RecordID` cố ý để rỗng khi mở phòng trống.
- Chuỗi 5 request này chỉ mở và dựng form; nó chưa tạo hóa đơn bán hàng đã thanh toán.
- Website không có request “pre-create” riêng trong hai trace này.
- ID/NAME/LASTSAVEID của phiên phòng được hình thành trong quá trình lưu phiên và phải đọc lại trước lần ghi tiếp theo.
- Request làm phát sinh hóa đơn thanh toán cuối cùng vẫn là `DoSave`.

### 3.3 Hai loại lưu khác nhau trên UI

Không được đồng nhất hai thao tác sau:

1. **Lưu HĐ** trên form phòng: lưu phiên phòng đang hoạt động. Phòng tiếp tục chạy và chưa xuất hiện trong danh sách hóa đơn bán hàng đã đóng.
2. **Thanh toán (F12) → Đóng bill & không in/in**: đóng phiên, gửi `DoSave`, giải phóng phòng và tạo hóa đơn trong danh sách bán hàng.

Thử nghiệm kiểm chứng ngày 02/08/2026:

- Phòng thử: `VIP 8888`.
- Mặt hàng: `1000001 — BANH QUE`, số lượng `1`, tiền hàng `40.000`.
- Khi đóng bill: tiền giờ `50.000`, VAT `9.000`, tổng/tiền mặt `99.000`.
- Kết quả: phòng được giải phóng và hóa đơn `HD0126080015` xuất hiện trong danh sách với tổng `99.000`, phương thức `TM`.

### 3.4 Trace đầy đủ 12 request — đã xác nhận từ đầu đến cuối

Ngày 02/08/2026 đã chạy lại một luồng sạch, liên tục trên phòng trống và xuất một trace duy nhất gồm đúng 12 request. Fixture đã làm sạch nằm tại `fixtures/api/full-create-payment-flow.sanitized.json`.

| Pha | Request | Kết quả |
| --- | --- | --- |
| Mở phòng trống | `GET AddEdit` + `GetDataSearchData` + 3 `GridLookupData` | Form mới, `RecordID=` rỗng |
| Lưu phiên | `POST AddEdit/DoSave`, `mode=0` | Server trả `Tag.ID`, `Tag.NAME`, `Tag.LASTSAVEID` và ánh xạ ID dòng tạm sang ID dòng thật |
| Mở lại phiên | Lặp lại 5 request mở form; URL vẫn dùng `RecordID=` rỗng + `DBANID=<ROOM_ID>` | Website tìm phiên đang chạy theo phòng và nạp lại dữ liệu |
| Đóng bill | `POST AddEdit/DoSave`, `mode=2` | Dùng `ID`, `NAME`, `LASTSAVEID` từ lần lưu phiên; có `ThanhToan` và `LoaiQuy` |

Điểm chốt cho luồng API-only:

- Không cần đoán ID phiếu hay tự sinh `LASTSAVEID`.
- Lần lưu thứ nhất (`mode=0`) là bước khởi tạo phiên server và là nguồn duy nhất cho `ID`, `NAME`, `LASTSAVEID`, ID dòng hàng thật.
- Lần lưu thứ hai (`mode=2`) phải dùng lại chính các ID server vừa trả về.
- Khi đóng bill, tiền mặt không nằm ở một trường đơn lẻ trong `Maps`; website gửi qua `CustomPostTable`:

```text
ThanhToan.KHACHDUA = TONGCONG
ThanhToan.TRALAI = 0
LoaiQuy.TIENMAT = TONGCONG
LoaiQuy.TIENTHANHTOAN = TONGCONG
```

- `CustomPost.XUATHOADON=false` trong thử nghiệm; extension không phát hành hóa đơn điện tử.
- Thành công nghiệp vụ ở cả hai lần lưu là `HTTP 200` + body `code === 1` + `Tag.ID` hợp lệ.

Kết quả kiểm chứng của trace đầy đủ:

- Phòng thử: `VIP 701`.
- Hàng thử: `1000001 — BANH QUE`, số lượng `1`, tiền hàng `40.000`.
- Lần lưu phiên: tiền giờ `0`, VAT `4.000`, tổng `44.000`.
- Khi đóng bill: tiền giờ `18.000`, VAT `5.800`, tổng/tiền mặt `63.800`, trả lại `0`.
- Server tạo `HD0126080017`; sau Refresh, phiếu xuất hiện trong danh sách với tổng `63.800`, phương thức `TM`.
- Phòng `VIP 701` được giải phóng sau khi đóng bill.

## 4. Cấu trúc payload DoSave

Payload phải được sinh từ mẫu website đã bắt, giữ nguyên tên khóa và kiểu dữ liệu. Các khối chính:

- `mode`: website đã dùng giá trị `2` trong request bắt thực tế.
- `TableID`: ID bảng hóa đơn ở mục 3.1.
- `ID`: GUID phiếu do luồng khởi tạo/cập nhật cung cấp.
- `Maps`: dữ liệu đầu phiếu.
- `Details`: danh sách dòng hàng.
- `CustomPostTable`: dữ liệu quỹ/tiền mặt.
- `CustomPost`: các tham số bổ sung như `MODEQUANLY=30` và `GioClient`.

### 4.1 Trường đầu phiếu quan trọng

Các trường đã thấy trong request thực tế:

- `BATDAUPHONGCUOI`, `BATDAU`, `KETTHUC`
- `DBANID`, `DCUAHANGID`, `DKHOXUATID`
- `ID`, `NAME`, `NGAY`, `LASTSAVEID`
- `TIENHANG`, `TIENGIO`, `TIENTHUE`, `TONGCONG`
- `TIENMAT`, `TIENTHANHTOAN`
- `DONGIA`, `TIENGIOPHONGCUOI`
- `MODE=1`

### 4.2 Trường dòng hàng quan trọng

- `ID`: GUID riêng của dòng.
- `DMATHANGID`, `DMATHANG_CODE`
- Số lượng thực xuất/xuất theo đúng mẫu website.
- Đơn giá, thành tiền và các trường giá báo cáo.
- `DKHOID`/kho xuất theo đúng mẫu.
- `NGAYTHUCHIEN` theo ngày phiếu.
- Mọi trường giảm giá bằng 0.

### 4.3 Tiền mặt

Khi không trả lại tiền:

```text
TIENMAT = KHACHDUA = TIENTHANHTOAN = TONGCONG
TRALAI = 0
```

Các giá trị này phải xuất hiện nhất quán trong `Maps` và `CustomPostTable` loại quỹ.

## 5. Công thức tiền

Sao kê là tổng đã gồm VAT 10%.

```text
preTax = số nguyên sao cho preTax + round(preTax × 10%) = saoKe
VAT = saoKe - preTax
tienHang + tienGio = preTax
tongCong = tienHang + tienGio + VAT = saoKe
```

Không dùng `saoKe × 10%` làm VAT vì cách đó tính VAT trên số đã gồm VAT.

Quy tắc tiền giờ:

- Phiếu đã có: lấy tiền giờ/giờ vào hiện tại làm mốc.
- Phiếu mới: thời lượng tối thiểu 30 phút; nếu sao kê lớn hơn 1.000.000 đồng thì tối thiểu 50 phút.
- Bộ giải ưu tiên tổ hợp hàng thực tế; phần dư nhỏ mới bù vào tiền giờ.
- Từ chối phương án có tỷ lệ tiền giờ/tiền hàng vượt giới hạn nghiệp vụ cấu hình.

## 6. Flow cập nhật phiếu có sẵn

1. Lấy các phiếu chưa xuất hóa đơn đúng ngày sao kê.
2. Loại phiếu đã phát hành/đã dùng bởi giao dịch khác.
3. Chọn phiếu có tổng hiện tại gần tiền sao kê nhất.
4. Đọc chi tiết và `LASTSAVEID` mới nhất.
5. Tính phương án stock-first.
6. Người dùng Accept.
7. Dựng payload DoSave từ mẫu website + dữ liệu mới.
8. Kiểm tra bất biến tiền, ngày, tồn và giảm giá trước khi gửi.
9. Gửi DoSave.
10. Chỉ khi `code === 1`, đọc lại phiếu từ server.
11. Nếu ngày, hàng, số lượng, tiền hàng, tiền giờ, VAT và tổng đều khớp: đánh dấu sao kê `done` và ghi sổ tồn.
12. Nếu không khớp: trạng thái `reconcile_error`, không trừ kho.

## 7. Flow tạo phiếu mới

1. Batch Review tính và giữ nguyên phương án đã Accept.
2. Chọn phòng trống theo dữ liệu server, không dựa riêng vào màu UI.
3. Với UI fallback, mở `GET /AddEdit` bằng `RecordID=` rỗng, `DBANID` và `DKHUVUCID` của phòng. Bốn request lookup sau đó chỉ phục vụ UI.
4. Với API-only, không cần gọi bốn lookup UI nếu đã có đủ ID; dựng payload từ mẫu `DoSave` đã xác nhận.
5. Gắn ngày/giờ lịch sử theo ngày sao kê; không dùng ngày hiện tại nếu đang tạo bù quá khứ.
6. Dựng hàng hóa, tiền giờ, VAT và tiền mặt theo phương án Accept.
7. Nếu website yêu cầu phiên phòng tồn tại trước khi thanh toán, lưu phiên phòng rồi đọc lại ID/NAME/LASTSAVEID mới nhất; không dùng GUID tự đoán.
8. Gửi `DoSave` thanh toán/đóng bill chính thức với tiền mặt bằng tổng cộng.
9. Chỉ công nhận thành công khi body có `code === 1` và `Tag.ID` hợp lệ.
10. Đọc lại hóa đơn theo `Tag.ID` hoặc số phiếu server trả về.
11. Chỉ đối soát và trừ kho khi ngày, dòng hàng, tiền hàng, tiền giờ, VAT, tổng và tiền mặt đều khớp.
12. Nếu lỗi trước khi thanh toán, giữ trạng thái `failed/needs_refresh`; không tự hủy hay sửa phiên phòng ngoài payload đã được duyệt.

## 8. Hàng đợi Batch API

Trạng thái đề xuất:

```text
planned -> accepted -> initializing -> saving -> verifying -> done
                                      \-> failed
                                                \-> needs_refresh
```

- Mỗi lần chỉ có một mục ở `initializing/saving/verifying`.
- Sau mỗi mục thành công, cập nhật tồn khả dụng trước khi xử lý mục kế tiếp.
- Khi gặp lỗi server, dừng hàng đợi; các mục sau chưa được gửi.
- Mỗi mục có khóa idempotency nội bộ gồm `transactionId + invoiceId + targetGrand`.
- Không gửi lại cùng payload sau khi mất phản hồi; trước tiên phải đọc lại server để biết lần trước đã lưu hay chưa.

## 9. API Trace trong extension v1.12.0

Batch Review có hai nút:

- **Bắt API tạo phiếu**: xóa trace cũ và ghi request cùng origin trong 10 phút.
- **Xuất trace JSON**: tải file không chứa Authorization/Cookie/Proxy-Authorization.

Các nhóm URL được ghi: `AddEdit`, `DoSave`, `GetDataSearchData`, `LayDuLieu`, `GridLookupData`, `KiemTra`.

Quy trình lấy fixture chuẩn:

1. Mở màn hình danh sách phòng.
2. Bấm **Bắt API tạo phiếu**.
3. Mở đúng một phòng trống.
4. Không thêm hàng và không lưu nếu chỉ cần request khởi tạo.
5. Bấm **Xuất trace JSON**.
6. Đóng phiếu bằng **Thoát**.
7. Lưu bản đã làm sạch tại `fixtures/api/` rồi viết test tái hiện thứ tự request và trường bắt buộc.

## 10. Kế hoạch triển khai tiếp

### Pha A — chốt trace (đã hoàn thành)

- Hai trace mở VIP 8888 đã được đối chiếu và giống hệt nhau.
- Đã phân loại request mở form với bốn request lookup UI.
- Đã tạo fixture làm sạch tại `fixtures/api/create-invoice-init.sanitized.json`.
- Đã tạo trace end-to-end 12 request và fixture làm sạch tại `fixtures/api/full-create-payment-flow.sanitized.json`.
- Đã xác nhận hai `DoSave` bắt buộc cho phiếu mới: `mode=0` lưu phiên, sau đó `mode=2` thanh toán/đóng bill.
- Đã xác nhận bằng giao dịch thật rằng Lưu HĐ chỉ giữ phiên phòng, còn đóng bill mới tạo hóa đơn cuối.

### Pha B — API thuần cho phiếu có sẵn

- Hoàn thiện read-before-write và `LASTSAVEID` refresh.
- Dùng DoSave trực tiếp.
- Verify sau lưu và rollback trạng thái local khi không khớp.

### Pha C — API thuần cho phiếu mới

- Không giả định có API pre-create riêng: `AddEdit` với `RecordID=` chỉ dựng form.
- Tái hiện hai bước website khi cần: lưu phiên phòng → đọc lại ID/LASTSAVEID → DoSave đóng bill.
- Hỗ trợ ngày/giờ quá khứ.
- Không cần mở form UI trong luồng bình thường.
- Giữ UI fallback để xử lý khi website đổi hợp đồng API.

## 11. Tiêu chí nghiệm thu

- Tạo mới và cập nhật mỗi loại ít nhất ba phiếu thử mà không cần nhấp từng mặt hàng.
- Tổng sau đọc lại bằng sao kê tuyệt đối, chênh lệch 0 đồng.
- VAT, tiền hàng, tiền giờ và tiền mặt đồng nhất với website.
- Không dùng giảm giá.
- Không âm kho và không trừ kho hai lần.
- Một lỗi không làm các mục Batch phía sau tiếp tục gửi.
- Không có Cookie/token trong log, fixture, JSON xuất hoặc repository.
- Không tự phát hành hóa đơn điện tử.
