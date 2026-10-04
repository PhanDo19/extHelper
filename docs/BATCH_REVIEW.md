# Batch Review

Batch Review lập trước nhiều phương án từ các giao dịch chưa hoàn tất (sao kê ngân hàng hoặc danh sách số tiền CK/TM), rồi lưu và đối soát tuần tự bằng API chính thức của website.

- Giao dịch được sắp theo ngày → giờ giao dịch → thứ tự dòng trong file, tối đa 500 giao dịch mỗi lượt. Giao dịch ở trạng thái `review` (Credit không rõ là chuyển khoản, hoặc từ 20 triệu trở lên) không được lập phương án cho tới khi người dùng bấm **Là doanh thu**.
- Tồn kho được giữ chỗ cộng dồn theo thứ tự giao dịch, kể cả các phương án đã Accept nằm ngoài khoảng ngày đang xem.
- `Accept` chỉ ghi phương án đã duyệt vào hàng đợi `batch_ready`; chưa sửa và chưa lưu hóa đơn.
- Các phương án đã Accept được giữ nguyên khi mở lại Batch Review. Khi mốc công thức (`CALCULATION_VERSION`) đổi, phương án cũ tự bị hủy và giao dịch quay về **Chờ xử lý**.
- Cảnh báo native “không có dữ liệu” của website được chặn cục bộ trong lúc Batch Review tìm kiếm.
- Lỗi mở/đọc một phiếu chỉ đánh dấu lỗi giao dịch đó; các giao dịch sau vẫn tiếp tục được lập phương án. Ba dòng lỗi quá tải liên tiếp thì extension tự tải lại trang rồi chạy tiếp.

## Quầy BÁN LẺ

Quầy BÁN LẺ không lập được hóa đơn điện tử, nên extension không tạo và không dùng phiếu ở đó:

- Phiếu mới chỉ được tạo ở phòng hát: loại theo tên phòng/khu (có dấu hay không, kể cả "BÁN LẺ 2", "KHU BÁN LẺ") và cờ quầy trong sơ đồ phòng. Bridge kiểm tra lại ngay trước khi gửi `DoSave`.
- Phiếu chưa xuất có sẵn ở quầy BÁN LẺ (chỉ biết được khi mở phiếu, vì danh sách không có cột phòng) bị bỏ qua khi Batch Review mở thử phiếu, không tính vào giới hạn 3 phiếu thử, và được nhớ lại trong lần tải trang để không mở lại.
- Nếu mọi phiếu chưa xuất trong ngày đều ở quầy BÁN LẺ, giao dịch được xử lý như không còn phiếu chưa xuất: dò hóa đơn đã xuất khớp tiền, không có thì lập phương án phiếu mới ở phòng hát.
- Lưu API phiếu có sẵn và chế độ "Điều chỉnh một phiếu" cũng từ chối phiếu ở quầy BÁN LẺ.

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
- **Phiếu mới**: tạo ngay trên tab danh sách, không mở tab phụ. Extension chọn phòng trống đúng đơn giá của phương án theo sơ đồ phòng website trả về (không chồng giờ với phiếu khác trong ngày, không bao giờ chọn quầy `BÁN LẺ`), đọc form trống của phòng bằng `GET AddEdit` (chỉ dựng form, không tạo bản ghi), rồi gửi hai request `DoSave` (mode=0 tạo phiên, mode=2 thanh toán).
  - Không có sơ đồ phòng hoặc không đọc được form phòng (lúc đó chưa gửi request ghi nào) thì tự quay về cách cũ: mở một tab Bán hàng phụ, mở form phòng trên giao diện, gửi hai request rồi tự đóng.
  - Sơ đồ phòng chỉ cho trạng thái hôm nay. Để phiếu lập bù cho ngày quá khứ không trùng phòng trùng giờ, cả hai cách đều đọc **lịch phòng thật của ngày đó** trên website (mọi phiếu của ngày, chỉ đọc) và gộp với các phiếu extension vừa tạo. Không đọc được lịch thì dừng, không tạo phiếu.
  - Giờ vào chốt lúc Batch Review theo lưới 45 phút, chưa biết phòng nào còn trống. Từ 1.29.18, nếu khung đó không còn phòng **cùng đơn giá** thì extension dời sang khung trống gần nhất trong buổi tối (vào từ 17:00, ra trước nửa đêm), **giữ nguyên thời lượng** — số tiền không đổi vì Tiền giờ chỉ theo thời lượng × đơn giá. Phương án được ghi lại giờ mới (kèm `plannedCheckIn/plannedCheckOut` cũ) trước khi gửi API. Hết chỗ thật thì dừng, nêu các phòng cùng giá. Ca thật: Nhơn 06/08/2026 chỉ có 3 phòng 400.000đ, phiếu 51 phút 19:15→20:06 được dời sang VIP 36 19:03→19:54.
  - Phiếu mới lưu đơn giá giờ phòng (`DONGIA`) đúng bằng đơn giá của phương án; form phòng có đơn giá khác thì dừng. Xem `docs/ROOM_HOURLY_RATES.md`.
  - Nút **Kiểm tra tạo phiếu không cần tab phụ** chỉ đọc form của một phòng trống để xác nhận cách mới dùng được trên website; không lưu gì.
- Sau mỗi phiếu, tab gốc mở lại phiếu **từ danh sách trên server** và đối soát tuyệt đối với phương án. Chỉ khi khớp mới đánh dấu giao dịch `done` và trừ tồn kho.

### Chống tạo trùng phiếu mới

- Trước khi gửi API tạo phiếu, extension ghi dấu `newInvoiceCreateStartedAt` vào giao dịch. Lần gửi trước chưa có kết quả chắc chắn (tab bị đóng, hết giờ, website báo lỗi sau khi đã nhận request) thì mọi lần chạy lại đều bị chặn.
- Lỗi xảy ra **trước** khi request được gửi thì được gỡ dấu và thử lại bình thường.
- Tạo phiên thành công mà bước thanh toán lỗi: thông báo nêu rõ số phiếu và ID phiên tạo dở.
- Bước thanh toán **mất phản hồi** (`Failed to fetch`) thì server có thể đã đóng bill. Từ 1.29.17 extension đọc lại phiếu theo ID, **không gửi lại**. Đã thanh toán đúng phương án (cờ `DATHANHTOAN = 30`, diễn giải "Xuất bán hàng", tiền thanh toán = tổng, tiền hàng/giờ/VAT đúng, chưa có số HĐ) thì ghi nhận như lưu thành công và đối soát tiếp; thiếu một dấu hiệu thì vẫn chặn. Giao dịch đã bị chặn vì lỗi này ở bản cũ được đọc lại tương tự ở lần **Lưu API** kế tiếp — không cần Đặt lại. Ca thật: Paris Nhơn 01000000781 (06/08, 491.700đ).
- Tab phụ gặp lỗi (không có phòng trống, không áp được phương án…) thì báo về ngay; tab gốc dừng lô với đúng lý do.
- Gỡ chặn: kiểm tra danh sách Bán hàng ngày đó. Có phiếu rồi → **Đặt lại** giao dịch và **Tạo Batch Review** để gắn đúng phiếu; chưa có → **Đặt lại** rồi chạy lại.

## Phiên làm việc

- Phiên Batch Review (danh sách phương án, khoảng ngày, giới hạn, giao dịch đang tạo phiếu mới) được lưu vào `chrome.storage.local` và khôi phục khi tải lại trang. Phiên chỉ lưu `transactionId`; dữ liệu giao dịch được liên kết lại với bản sao kê mới nhất.
- Tab phụ chỉ tự mở phòng **một lần** cho mỗi lượt; nếu tab phụ bị tải lại sau khi đã mở form, extension không tự mở lại mà báo lỗi về tab gốc.
- Phiên tự hết hạn sau 7 ngày. Đóng chế độ xử lý hàng loạt (bấm lại nút **Mở xử lý hàng loạt**) sẽ xóa phiên Batch Review đã lưu.
