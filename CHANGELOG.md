# Changelog

## 1.29.22 (2026-10-05)

- **Sửa lỗi mức "Lập ở …" của một giao dịch bị gán sang giao dịch kế tiếp, khiến phiếu bị lưu và đối soát ở tổng sai.** Ca thật Linh Đàm: 01/07 dòng 6 (4.155.000đ) và dòng 7 (2.233.000đ) mang mức 1.699.999đ của dòng 5 (1.700.000đ); 04/07 dòng 33 (2.883.000đ) mang 3.734.999đ của dòng 32; 16/07 dòng 125 (2.152.000đ) mang 3.162.999đ của dòng 124. Bốn phiếu HD0126070016/005/058/268 đã lưu ở tổng sai (chưa phát hành HĐĐT); 42 mức Lập ở còn lại đều đúng −1đ.
  - Nguyên nhân: tính lại riêng một giao dịch tạm rút dòng đó khỏi `batchPlans` nên các dòng sau dồn lên một chỗ trong khi bảng cũ vẫn hiển thị; nút "Lập ở" tìm dòng theo vị trí (`data-index`), bấm lại lúc đó rơi sang dòng kế.
  - Mọi nút/ô chọn trên dòng Batch Review mang `data-transaction-id`; `batchIndexFromButton` tìm theo mã giao dịch (không còn trong `batchPlans` thì dừng, không rơi sang dòng khác).
  - "Lập ở" chỉ nhận mức có trong danh sách của chính giao dịch, lệch sao kê ≤ 100đ, và khóa các nút "Lập ở" tới khi tính lại xong.
  - Lưới an toàn: Batch Review không dùng mức Lập ở lệch sao kê quá 100đ (`grandOverrideFor`); Lưu API (phiếu có sẵn, phiếu mới, tab phụ) chặn phương án có tổng lệch sao kê quá 100đ (`planGrandMismatchError`).
- **Sửa dữ liệu đã hỏng:** dòng sao kê "Đã xử lý" mang mức Lập ở bị gán nhầm hiện cảnh báo đỏ và nút **Hoàn kho & lập lại** — hoàn kho riêng giao dịch đó, xóa mức sai, giữ liên kết phiếu để lần lập lại lưu lại chính phiếu đó theo đúng số tiền sao kê. Hoàn kho theo khoảng ngày cũng xóa mức bị gán nhầm.

## 1.29.21 (2026-10-05)

- **Phát hành gửi đúng tham số website của từng cơ sở.** Giao diện được cấu hình riêng theo cơ sở: Paris Nhơn đã sang giao diện mới (`phatHanhHoaDon(id, kyHieu)`), Linh Đàm vẫn giao diện cũ (`phatHanhHoaDon(id)`, đọc trên trang thật 05/10/2026). Trước đây extension luôn gửi `{ id, kyHieu: "" }`; nay `phatHanhHoaDonPayload` đọc tên tham số từ chính hàm service của trang đang mở. Không đọc được hàm thì giữ cách của giao diện mới. Cơ sở nào được website chuyển sang giao diện mới sẽ tự theo, không cần sửa code.
- Đã chạy chỉ đọc trên Linh Đàm (giao diện cũ): `LayDuLieu` `TRANGTHAI` 0/1/2 cùng nghĩa như Nhơn; tìm phiếu chưa xuất/đã xuất, mở phiếu theo ID, `scan()`, đọc mặt hàng qua `LayDuLieuChiTiet` và `readInvoiceSnapshot` đều đúng. Không phần nào khác cần tách theo cơ sở.

## 1.29.20 (2026-10-04)

- **Sắp xếp lại màn Kho.** Chỉ đổi hiển thị.
  - Khối đầu: kho riêng/dùng chung (bỏ dòng "Paris Nhon dung kho rieng" không dấu bị lặp; chữ nhỏ "KHO VẬT LÝ …" nay đọc được) và **một** nút chính "Cập nhật kho Nhơn / kho chung" — trước có hai nút cùng việc ở hai chỗ. Sao lưu kho, Khôi phục bản sao, Xuất kho đã phát hành thành nhóm nút nhỏ ngay dưới.
  - "Hoàn kho để chạy lại batch" thu gọn thành một dòng, bấm mới mở (thao tác ít dùng và đổi dữ liệu); trước là khối cam chiếm nửa màn hình.
  - Thứ tự: KPI (5 ô một hàng) → ô tìm + ô lọc → bảng. Trước đây thanh công cụ là lưới 3 cột chứa 4 khối nên nhóm nút rớt xuống hàng hai, nằm lệch trong cột đầu.
  - Tiêu đề màn ở Paris Nhơn là "Bước 1 · Kho vật lý riêng" (trước ghi "dùng chung"); chú thích ô Kho ở thanh tóm tắt cũng theo cơ sở.
  - Nhãn ngày trong các hàng điều khiển (Kho, Phát hành) cách ô nhập một khoảng.

## 1.29.19 (2026-10-04)

- **Bỏ qua phiếu không gắn phòng hát khi Batch Review dò phiếu có sẵn.** Ca thật Paris Nhơn: Lưu API dừng ở 0/218 với "Phuong an thieu ngay hoa don hoac Gio vao/Ra hop le". Phiếu 01000000142 (21/08/2026) là phiếu bán hàng không qua phòng — không `DBANID`, không đơn giá giờ, form không có ô giờ vào/ra, Tiền giờ 0, toàn tiền hàng 2.410.000đ — nhưng Batch Review vẫn chọn nó cho giao dịch 401.500đ và lập phương án có Tiền giờ.
  - Bridge `scan()` thêm `roomMissing`: chỉ bật khi đọc được dữ liệu form mà không có phòng (không đọc được form thì không kết luận).
  - Content: phiếu `roomMissing`, không giờ vào/ra và Tiền giờ 0 đi cùng đường với phiếu quầy BÁN LẺ — bỏ qua khi dò, nhớ lại trong lần tải trang, lý do nêu "không gắn phòng hát".
  - Bridge: Lưu API phiếu có sẵn không có `DBANID` bị chặn trước khi gửi, kèm hướng dẫn Tính toán lại (dòng đã Accept từ trước sẽ dừng với lý do này thay vì "thiếu giờ vào/ra").
  - Đã đối chiếu trên website thật: 142 đọc được form nhưng không phòng; 141 cùng ngày có VIP 22, 600.000đ, 20:21→20:51. Trong 218 dòng đã Accept chỉ dòng 21/08 · 401.500đ dùng phiếu kiểu này.

## 1.29.18 (2026-10-04)

- **Phiếu mới không còn dừng lô vì "Không còn phòng hát trống phù hợp" khi vẫn còn chỗ.** Ca thật Paris Nhơn 06/08/2026, lô dừng ở 14/113: chỉ 3 phòng 400.000đ (VIP 26/36/46), giờ vào xếp lưới 45 phút mà phiếu 1.540.000đ cần 51 phút 19:15→20:06, chồng các phiếu đã tạo — dù VIP 36 trống 19:03→19:59 và VIP 46 trống từ 19:48. Nay khung đã chốt hết phòng cùng đơn giá thì dời sang khung trống gần nhất (`shiftedNewInvoiceWindow`): giữ nguyên thời lượng (số tiền không đổi), vào từ 17:00, ra trước nửa đêm, chỉ phòng cùng giá, không bao giờ quầy BÁN LẺ. Phương án được ghi giờ mới trước khi gửi API. Hết chỗ thật thì thông báo nêu các phòng cùng giá.
- **Lưu API phiếu có sẵn mất phản hồi ("Failed to fetch"/hết giờ) không dừng lô ngay**: đọc lại để đối soát; khớp phương án thì đi tiếp, không khớp thì dòng về Đã Accept (chưa trừ kho). Lỗi nghiệp vụ thường vẫn dừng như cũ.
- **Lưu API tự tải lại trang rồi chạy tiếp khi rớt mạng** (tối đa 3 lần), trừ khi bị chặn chống trùng phiếu hoặc mất đăng nhập.
- Mất phản hồi ở bước lưu phiên phiếu mới (chưa có số phiếu): thông báo nêu phòng đã chọn và sơ đồ phòng hiện có báo phiên trên phòng đó không.
- Đã kiểm tra trên website thật bằng bridge thật (chỉ đọc): tìm phiếu chưa xuất qua API, mở phiếu theo ID, `scan()` đọc đúng lưới của form trên màn Hóa đơn điện tử; HD0126080003 và 01000000781 đều đã ở trạng thái Đã xử lý.

## 1.29.17 (2026-10-04)

- **Lô Batch API không còn dừng khi bước thanh toán phiếu mới mất phản hồi nhưng server đã đóng bill.** Ca thật Paris Nhơn 04/10/2026: lô dừng ở 4/116 với "Da tao phien 01000000781 … nhung buoc thanh toan loi: Failed to fetch". Đọc lại trên website: phiếu đã đóng bill đủ 491.700 (hàng 235.000 + giờ 212.000 + VAT 44.700) — request thanh toán tới server, chỉ phản hồi bị rớt.
  - Bridge: khi DoSave thanh toán ném lỗi mạng, chờ 1,5 s rồi đọc lại phiếu theo ID (`confirmFreshInvoicePayment`), **không gửi lại** payload. Chỉ coi là đã thanh toán khi mọi dấu hiệu khớp: `DATHANHTOAN = 30`, diễn giải "Xuất bán hàng" (bước lưu phiên ghi rỗng), tiền thanh toán = tổng, tiền hàng/giờ/VAT/tổng đúng phương án, đúng số phiếu, chưa có số HĐ. Thiếu một dấu hiệu thì báo lỗi và chặn như cũ.
  - Content: giao dịch đã bị chặn vì đúng lỗi này (từ bản cũ, hoặc đọc lại cũng rớt mạng) được đọc lại ở lần Lưu API kế tiếp; xác nhận được thì ghi nhận như lưu thành công (dùng phòng thật của phiếu) rồi đối soát sau lưu như thường — bước này vẫn so từng mặt hàng trước khi trừ kho. Không bao giờ tạo phiếu thứ hai cho giao dịch đó.
  - Tách `recordFreshInvoiceSaved` (ghi nhận phiếu mới đã lưu) và `submitNewInvoiceOnIdleRoom` (chọn phòng + tạo phiếu) khỏi hai hàm cũ để dùng chung.

## 1.29.16 (2026-10-04)

- **Sửa Lưu API phiếu có sẵn báo "Phieu hien tai khong co dong hang mau de tao request API" dù phiếu có hàng** (ca thật Paris Nhơn: HD0126080003 có 7 dòng hàng). Màn Hóa đơn điện tử mới có lưới `grDetail` (Mã hàng/Số lượng/Đơn giá, rỗng khi chưa chọn dòng) nằm trước form phiếu trong DOM; `invoiceGrid()` lấy lưới đầu tiên khớp cột nên đọc nhầm lưới rỗng đó. Nay khi có form phiếu đang mở, chỉ xét lưới bên trong cửa sổ form (`openInvoiceFormContainer`). Đã thử trên trang thật: chọn đúng lưới của form, đọc đủ 7 dòng. Batch Review không bị vì `scan()` có đường dự phòng đọc DOM của dialog.
- **Request chỉ đọc tự thử lại khi rớt mạng** (`TypeError: Failed to fetch`): danh sách hóa đơn điện tử, mặt hàng, đầu phiếu `AddEdit`, danh mục hàng, sơ đồ phòng — thử thêm 2 lần (1,5 s, 4 s), hết lượt thì báo "Mất kết nối tới website… kiểm tra mạng rồi bấm lại". Request ghi (DoSave, kiểm tra/phát hành HĐĐT) **không** thử lại vì server có thể đã nhận.

## 1.29.15 (2026-10-04)

- **Tìm phiếu chưa xuất bằng API và mở phiếu theo ID — chạy lại được Batch Review, Lưu API và đối soát sau lưu trên giao diện mới.** "Danh sách phiếu" mà extension vẫn gọi là danh sách Bán hàng thực ra là màn hình **Hóa đơn điện tử**: bridge tìm bộ lọc `rdTrangThai_2` (Chưa phát hành) và chỉ màn này có control đó. Giao diện 10/2026 đổi radio thành dropdown, thêm cột Chọn/Chiết khấu vào lưới, nên cách cũ (đặt ô ngày + radio, Refresh, đọc DOM từng trang, nhấp đúp dòng) không chạy nữa.
  - `findInvoiceCandidates` lấy danh sách bằng `HoaDonDienTu/LayDuLieu` với Loại = Chưa phát hành (`TRANGTHAI = 2`, server lọc); `findIssuedInvoiceByAmount` dùng Loại = Đã phát hành (`1`) và bỏ hóa đơn đã hủy. Danh sách một ngày được dùng lại trong 2 phút; tìm một số phiếu cụ thể (đối soát sau lưu) luôn đọc lại server.
  - `openInvoiceCandidate` mở phiếu theo ID bằng `UiUtils.ShowEditForm` — đúng lời gọi website dùng khi nhấp đúp dòng. Đã thử trên màn Hóa đơn điện tử và trên sơ đồ phòng: không cần chuyển màn hình. Vẫn chỉ mở ID đã thấy trong danh sách Chưa phát hành; không tự đóng phiếu người dùng đang mở.
  - Sau mỗi phiếu, Lưu API chỉ còn kiểm form đã đóng, không đòi "đã trở về danh sách".
  - Bỏ toàn bộ mã điều khiển lưới cũ (radio, ô ngày, phân trang, chờ pager Kendo).
- **Đối soát lại mặt hàng từ website chạy bằng API**: tìm ID trên danh sách Hóa đơn điện tử theo ngày, đọc đầu phiếu (`AddEdit`) + dòng hàng (`LayDuLieuChiTiet`) + tên phòng (sơ đồ phòng) bằng action mới `readInvoiceSnapshot`, không mở phiếu. Phiếu đã phát hành HĐĐT hoặc đã hủy giữ nguyên sổ.
- **Sửa sai của 1.29.14**: bản đó loại lưới Hóa đơn điện tử khỏi `invoiceListElement()` vì tưởng nhận nhầm; thực ra đó chính là danh sách extension dùng. Đã hoàn lại. Mục CHANGELOG 1.29.14 cũng đã chuẩn hóa xuống dòng (có 8 dòng CRLF lẫn vào).

## 1.29.14 (2026-10-04)

- **Theo giao diện mới của màn hình Hóa đơn điện tử trên website** (ô "Loại" thay radio, nút Phát hành/Kiểm tra hàng loạt, lưới mặt hàng của phiếu đang chọn). API đọc từ `HoaDonDienTu_JsClient` trên trang Paris Nhơn và gọi thử phần chỉ đọc; chi tiết ở `docs/API_FLOWS.md` mục 3.6.
  - **Đọc mặt hàng qua API, không còn chuyển màn hình.** Phiếu chưa có trong sổ đối soát (hoặc sổ lệch web) được đọc bằng `TDONHANG0Ae/LayDuLieuChiTiet`, chính API website dùng cho lưới mặt hàng. Trước đây extension phải tự chuyển sang danh sách Bán hàng, nhấp đúp mở phiếu rồi đóng. Ở Paris Nhơn, menu "Bán hàng" mở sơ đồ phòng, không có lưới danh sách, nên bước chuyển màn hình không tới được danh sách và lô bị chặn với "Chưa mở được danh sách Bán hàng". Mở phiếu qua giao diện chỉ còn là đường dự phòng khi API lỗi và đang đứng ở danh sách Bán hàng thật. Nút **Thử đọc mặt hàng** cũng dùng API.
  - **Không còn nhận nhầm lưới Hóa đơn điện tử là danh sách Bán hàng.** Lưới mới có cột Ngày/Số phiếu/Tổng cộng nên `invoiceListElement()` từng coi nó là danh sách Bán hàng. Khi đó `ensureInvoiceListScreen` tưởng đã tới nơi, còn luồng mở phiếu đi tìm phiếu trên một lưới lọc theo ngày của website. Nay lưới có cột Kiểm tra + Phát hành bị loại.
  - `phatHanhHoaDon` gửi `{ id, kyHieu: "" }` như website (tham số `kyHieu` mới; rỗng khi form tắt chọn ký hiệu).
  - `LayDuLieu` gửi đủ 6 ô lọc như website. "Loại" vẫn là Tất cả (`TRANGTHAI = 0`; `1` Đã phát hành, `2` Chưa phát hành) vì Check/Đồng bộ sổ cần cả phiếu đã phát hành. Danh sách tải được như trước; payload cũ vẫn được chấp nhận.

## 1.29.12 (2026-10-03)

- **Giao diện Batch Review và Phát hành gọn hơn, không còn phải kéo thanh cuộn ngang.** Chỉ đổi cách hiển thị; logic lập phương án, Lưu API, phát hành giữ nguyên.
  - **Mặt hàng mở ở dòng riêng rộng hết bảng**: bấm "N mã ▾" để mở dòng chi tiết ngay dưới (Mã · Tên · SL · Đơn giá · Thành tiền, Batch thêm Tồn trước · Giới hạn/HĐ, kèm dòng tổng tiền hàng). Trước đây bảng con rộng tối thiểu 480px nằm trong cột 92px nên phải kéo ngang mới thấy số lượng/giá. Dòng đang mở vẫn mở sau khi bảng vẽ lại.
  - **Bảng Batch còn 6 cột** (trước 10): Giao dịch (ngày + số tiền + diễn giải, mức "lập ở …" nếu có) · Phiếu (hoặc nhãn "Phiếu mới") · Phương án (Hàng / Giờ / VAT thẳng cột và giờ vào–ra một dòng, chi tiết ở tooltip) · Trạng thái (nhãn, lỗi ⚠ nổi bật, lý do chữ nhỏ) · **Thao tác** (nút nhỏ xếp dọc, nút bước chính tô màu). Bỏ `min-width` 1.100px.
  - 7 ô KPI tự xếp một hàng; thanh thao tác chia nhóm Lọc/chọn · Accept, Lưu API · công cụ kiểm tra (nút nhỏ, dạt phải).
  - **Màn Phát hành**: tiêu đề + một hàng điều khiển; mục "Sửa người mua / TM-CK" thu gọn (tiến độ hiện ngay trên tiêu đề, tự mở khi đang có lượt chạy dở); nút công cụ nhỏ; bỏ `min-width` 900–940px.

## 1.29.11 (2026-10-03)

- **Phiếu mới lập ở mức tổng đã làm tròn ("Lập ở …") không còn bị hủy mỗi lần Lưu API.** Sao kê không biểu diễn được theo VAT 10% của website (ca thật Kim Giang: 1.282.000đ, chỉ lập được 1.281.999đ hoặc 1.282.001đ) thì người dùng chọn "Lập ở …" và phương án lập ở mức đó; API tạo phiếu cũng gửi đúng mức đó. Nhưng bước kiểm tra phương án phiếu mới (`newInvoicePlanValidationError`) lại so tổng với sao kê gốc, nên lệch đúng 1đ → "Tiền hàng + tiền giờ + VAT chưa khớp sao kê" → phương án bị hủy kèm luôn mức đã chọn → giao dịch quay về "không biểu diễn chính xác", vòng lặp không bao giờ tạo được phiếu. Nay so với mức đã chọn (không có mức đã chọn thì vẫn so với sao kê như trước). Phiếu có sẵn không bị ảnh hưởng (không qua bước này).
- **Dòng "Cần tạo phiếu" chỉ cần chọn mức "Lập ở …" thì hướng dẫn tạo bằng API**, không còn mời "Mở tab Bán hàng mới": khi chưa có phương án, tab phụ không có gì để áp dụng và đứng yên. Chọn mức → Accept → Lưu API: phiếu mới được tạo bằng API ngay tại tab danh sách. Các lỗi khác vẫn giữ nút mở tab phụ để làm tay.
- Lỗi khi Lưu API/đối soát gắn lên dòng theo **mã giao dịch** thay vì vị trí dòng: Batch Review vừa dựng lại (vd sau khi hủy phương án) thì thứ tự dòng đổi và lỗi từng có thể gắn nhầm sang giao dịch khác.

## 1.29.10 (2026-10-02)

- **Phiếu có sẵn nhiều giờ hát không còn kẹt ở "Tiền giờ vượt 2 lần tiền hàng".** Ca thật Kim Giang 27/07/2026, sao kê 952.000đ (lập ở 951.999đ, trước VAT 865.454đ), kho dư (sức chứa ước tính 2.940.000đ): phiếu có sẵn Tiền giờ ~720.000đ nên sàn mềm "nền − 20%" là 576.000đ, trong khi tỷ lệ Tiền giờ ≤ 2 lần tiền hàng đòi Tiền giờ ≤ 578.636đ. Trên lưới giá hàng 5.000đ không có giá trị chung: 285.000đ hàng cho giờ 580.454đ (vỡ tỷ lệ), 290.000đ cho 575.454đ (hụt sàn 546đ). Solver xếp sàn mềm trước tỷ lệ nên luôn chọn 285.000đ rồi cổng cuối loại; Tính lại bao nhiêu lần cũng vậy, dù cổng "phần bù ≤ 20% HOẶC Tiền giờ ≤ trần" vẫn chấp nhận 575.454đ.
  - Nay với phiếu có sẵn, sàn mềm nhường tỷ lệ: hạ vừa đủ để có tiền hàng trên lưới 5.000đ đạt tỷ lệ, **không bao giờ dưới sàn phút** (30/50 phút). Ca trên ra hàng 290.000đ, giờ 575.454đ. Phiếu mới và phiếu đang lập được không đổi; không tăng `CALCULATION_VERSION`. Màn xem phương án thủ công (`solveInvoice`) giữ nguyên.
  - Thêm: tổ hợp hụt tỷ lệ thì thử tiếp bội số trần số lượng/HĐ lớn hơn (tối đa ×5, chỉ nhận kết quả đạt tỷ lệ) — cho trường hợp kho bị giới hạn số lượng/HĐ.
  - Vẫn không lập được thì thông báo nêu rõ: cần tiền hàng từ bao nhiêu, ghép được bao nhiêu, sức chứa ước tính với bao nhiêu mã.

## 1.29.9 (2026-10-02)

- **Lưu API dừng vì đối soát sau lưu thất bại nay nêu lý do.** Thông báo cũ chỉ ghi "Đã gửi API nhưng chưa đối soát được HD…; tồn kho và sao kê chưa bị thay đổi" (Kim Giang, HD0126070309): lý do thật (đọc lại lệch phương án, tồn kho/kho chung không đủ để ghi sổ, không thấy phiếu trong danh sách…) có hiện ở dòng trạng thái nhưng bị thông báo dừng lô ghi đè ngay sau đó. Nay thông báo dừng kèm lý do và cách xử lý tiếp: sửa nguyên nhân, bấm **Đối soát sau lưu** ở dòng đó (không Lưu API lại phiếu đã lưu), rồi Lưu API tiếp.
- **Bộ lọc trạng thái ở bảng Batch Review** (dropdown **Lọc**, kèm số dòng mỗi nhóm): Tất cả · Lỗi / cần xử lý · Đã lưu, chờ đối soát · Sẵn sàng duyệt · Đã Accept, chờ Lưu API · Cần tạo phiếu · Đã có HĐ / đã xử lý.
  - Lỗi khi Lưu API (cả lô hay từng dòng) và khi Đối soát sau lưu nay được ghi lên đúng dòng (⚠ màu đỏ, giữ qua lần tải lại trang). Phiếu đã lưu mà đối soát thất bại vẫn mang trạng thái "Chờ lưu/đối soát" nhưng nằm trong nhóm **Lỗi / cần xử lý**. Lỗi tự hết khi dòng đổi trạng thái (lưu/đối soát lại thành công, tính lại phương án).
  - Ô KPI "Cần xử lý" đếm cùng cách với bộ lọc này.
  - Đang lọc thì nút "Chọn tất cả" / Accept chỉ tác động các dòng đang hiện; nút Lưu API vẫn chạy mọi phiếu đã Accept.

## 1.29.8 (2026-10-02)

- **Đơn giá giờ hát đọc thẳng từ website theo từng phòng.** Kim Giang đổi sang giá theo phòng thay vì 600.000đ cho mọi phòng, nên phương án phiếu mới (tính 600.000đ) bị bridge chặn "đơn giá giờ trên website khác phương án", và phiếu có sẵn bị quy sai về 600.000đ. Nay:
  - Bridge `readRoomHourlyRates` đọc `DONGIA` trên form từng phòng (GET `AddEdit` + `DBANID`, `RecordID` rỗng — đúng request bước tạo phiếu đã dùng, chỉ đọc). Lỗi một phòng không hỏng cả lượt; mất đăng nhập thì dừng.
  - Content lưu bảng theo cơ sở (`invoiceTargetRoomHourlyRates__<cơ sở>`), tự đọc lại khi Tạo Batch Review nếu bảng cũ hơn 12 giờ, và có nút **Đọc giá giờ các phòng** ở Batch Review. Đọc lỗi thì dựng Batch theo bảng cũ và nhắc.
  - `roomHourlyRate` / `tenantHourlyRates` ưu tiên giá đọc từ website; bảng cứng Nhơn và 600.000đ chỉ còn là dự phòng cho phòng website không trả giá. Phiếu mới chỉ thử các mức có phòng thật mang giá đó và chỉ chọn phòng đúng mức.
  - Phiếu có sẵn dùng đơn giá ghi trên chính phiếu (`scan` trả thêm `roomRate` = `DONGIA` của form đang mở); không có thì suy như trước, có tính cả 600.000đ cho phiếu lập trước khi đổi giá.
  - Phương án phiếu mới đã Accept theo giá cũ: khi Lưu API sẽ báo không còn phòng đúng giá và nhắc **Tính lại**. Không tăng `CALCULATION_VERSION` (phương án đã Accept ở Linh Đàm/Nhơn giữ nguyên).
  - Áp cho mọi cơ sở: nếu form phòng Linh Đàm/Nhơn trả đơn giá khác bảng cũ thì extension dùng đơn giá website. Xem `docs/ROOM_HOURLY_RATES.md`.

## 1.29.7 (2026-10-02)

- **Nút xuất (sao lưu) kho dùng chung không còn báo "Tên file tải xuống không hợp lệ".** Content đặt tên file `TonKho_DungChung_<thời điểm>.json` nhưng background chỉ cho tải `TonKho_ParisKimGiang|ParisLinhDam|ParisNhon_…json`, nên nút này bị chặn từ khi có kho dùng chung (9e39e36, 16/08/2026). Nay cho phép thêm tên `TonKho_DungChung_…json`; mẫu tên vẫn chặn đường dẫn và ký tự lạ như trước. Thay đổi nằm ở service worker nên phải tải lại extension.
- Script chỉ đọc `scripts/kiem-tra-kho-chung.js`: chạy trong Console (ngữ cảnh extension) để xem kho dùng chung Kim Giang + Linh Đàm đã khởi tạo chưa, các lần trừ kho gần nhất của từng cơ sở và mã nào đang lệch kho chung.

## 1.29.6 (2026-10-02)

- **Lệnh gửi kèm ID phiếu không còn chờ tới hết giờ dù bridge đã làm xong.** `request()` của content trải payload sau mã yêu cầu, nên lệnh có khóa `id` (ID phiếu) bị đè mất mã đó; bridge trả lời theo `detail.id` (tức ID phiếu) và content không nhận ra câu trả lời. Lỗi có từ khi thêm Phát hành (8916b54, 07/08/2026) và ảnh hưởng:
  - **Phát hành** (`issueEInvoice`): theo code, mỗi hóa đơn chờ hết 30s (90s nếu phải đọc mặt hàng) rồi mới được xác nhận bằng cách đọc lại danh sách, kèm cảnh báo "mất phản hồi nhưng hóa đơn ĐÃ phát hành". Nay đi đúng nhánh thành công, ghi sổ bằng số liệu bridge trả về.
  - **So sổ đối soát với website** (`readInvoiceSummary`, chạy trước khi phát hành và ở nút "Đối soát lại mặt hàng từ website"): mỗi phiếu chờ hết 30s rồi bị đánh dấu "chưa so được", nên phiếu lệch sổ chưa bao giờ được phát hiện.
  - **Đọc mặt hàng từ phiếu** (`readInvoiceItems`): chờ hết 45s.
  - Sửa người mua/TM-CK (`buyerFixInvoice`, 1.29.5) đã tránh lỗi bằng `recordId`.
- Cách sửa: content gửi thêm `requestId` (đặt sau cùng nên không bị đè), bridge trả lời theo `requestId` (không có thì dùng `id` như cũ). Handler vẫn đọc ID phiếu ở `detail.id`, không đổi. Test `test-request-bus.js` chạy thật `request()` của content với bộ lắng nghe của bridge.

## 1.29.5 (2026-10-02)

- **Sửa người mua/TM-CK cho phiếu đã lưu ngay trong extension, tự tải lại trang và chạy tiếp.** Màn Phát hành hóa đơn có khối "Sửa người mua / TM-CK" (Từ ngày/Đến ngày riêng, vì lô phát hành khóa một ngày). Phiếu chưa xuất hóa đơn ghi `TM` hoặc `CK` được đổi thành `TM/CK` và người mua "Bán cho người tiêu dùng" (địa chỉ mặc định nếu trống); tiền, giờ, phòng, dòng hàng giữ nguyên, đọc lại từng phiếu để xác nhận. Bỏ qua phiếu đã xuất, đã hủy, quầy BÁN LẺ, có người mua thật.
  - **Chỉ phiếu extension đã tạo hoặc cập nhật**: số phiếu gắn giao dịch sao kê/danh sách số tiền hoặc có trong sổ đối soát. Phiếu nhân viên tự lập không bị đụng tới. Với phiếu extension, phiếu đã `TM/CK` mà người mua còn "Khách lẻ - Không lấy hóa đơn" (luồng sao kê trước 1.29.4) cũng được sửa.
  - **Chỉ dùng API, không mở phiếu trên giao diện.** Mỗi phiếu: đọc `GET AddEdit` (đúng request website gọi khi mở phiếu: `MaxTab=6`, `ModeQuanLy=30`; chẩn đoán trên trang thật Linh Đàm cho thấy dòng hàng nằm sẵn trong HTML này) → `DoSave` → đọc lại, so đầu phiếu và từng dòng hàng. Bản thử trước đó mở phiếu qua giao diện (lọc ngày, lật trang, chờ form) bị treo quá 90s ở phiếu nằm trang 2 (HD0126080369).
  - **Sửa lỗi "Trang không phản hồi sau 90s (buyerFixInvoice)" ngay phiếu đầu.** Content gửi phiếu kèm khóa `id` (ID phiếu), mà `request()` trải payload sau mã yêu cầu nên `id` của phiếu đè mất mã đó: bridge vẫn sửa xong phiếu nhưng trả lời bằng ID phiếu, content không nhận ra câu trả lời và chờ tới hết 90s. Chạy thật 02/10/2026: HD0126080369 và HD0126080370 thực ra đã được sửa (lượt sau quét lại thì HD0126080369 không còn trong danh sách cần sửa). Nay ID phiếu đi trong `recordId`. Sau vài lần hết giờ liên tiếp, bộ đếm tự tải lại chạm giới hạn 3 nên extension dừng hẳn — đó là lý do "không thấy hoạt động gì nữa".
  - Dòng hàng gửi lại phải đúng từng dòng đang có (thiếu dòng là website xóa dòng đó): không đọc được dòng, dòng sai số lượng/giá, hoặc tổng dòng khác tiền hàng thì **bỏ qua phiếu, không gửi gì**, và ghi số phiếu vào "Cần xem tay".
  - Lý do chạy trong extension: script console chạy thật cứ khoảng 50 phiếu lại dừng (`Failed to fetch`) và mất khi tải lại trang. Nay danh sách phiếu còn lại nằm trong storage (`invoiceTargetBuyerFixJob__<cơ sở>`); extension tự tải lại sau mỗi 15 phiếu đã sửa và khi lỗi tải lại được (rớt kết nối, trang không phản hồi, HTTP 5xx), rồi chạy tiếp. Lỗi dữ liệu (đọc lại thấy sai, website từ chối lưu, mất đăng nhập) thì dừng; 3 lần tải lại liên tiếp không tiến triển cũng dừng. Nút **Dừng** dừng sau phiếu đang làm, bấm lại nút chính để chạy tiếp. Lượt lập bằng bản thử trước (chưa giới hạn phạm vi) tự bị bỏ.
  - Mỗi phiếu được đọc lại từ server trước khi sửa, nên phiếu đã lưu trước lần tải lại (kể cả khi mất phản hồi) ra "đã đúng" chứ không bị lưu lần hai; website cũng từ chối `LASTSAVEID` cũ.
  - Payload lấy nguyên form server, chỉ đổi người mua/phương thức (không dùng `buildCurrentSavePayload`, vốn ghi đè tiền/giờ theo phương án và chặn giảm giá). Không đổi luồng Batch Review, Lưu API hay Phát hành.
- Script console `scripts/sua-nguoi-mua-tmck.js` (giữ để dùng tay; ưu tiên khối trong extension ở trên) sửa hàng loạt các phiếu đó mà không chạy lại batch: chỉ đổi người mua và phương thức, giữ nguyên tiền, giờ, phòng, dòng hàng; đọc lại từng phiếu để xác nhận. Bỏ qua phiếu đã phát hành, đã hủy, ở quầy BÁN LẺ hoặc có người mua thật. Mặc định chạy thử 1 phiếu; chạy lại tự bỏ qua phiếu đã sửa.
  - Chỉ sửa phiếu **chưa xuất hóa đơn theo chính website**: script dừng nếu danh sách Bán hàng chưa lọc "Chưa xuất hóa đơn", nạp đủ mọi trang của danh sách đó và chỉ xét phiếu có mặt trong đó. API `LayDuLieu` trả cả phiếu đã xuất, và phiếu đã xuất không phải lúc nào cũng mang số hóa đơn trên dòng/form, nên không được dựa vào số hóa đơn để lọc.
  - Sửa **mọi phiếu chưa xuất ghi đúng `TM` hoặc `CK`** (người dùng chốt 02/10/2026), kể cả phiếu người mua để trống (ghi thêm người mua "Bán cho người tiêu dùng"). Chạy trên web thật (Linh Đàm tháng 7) ra CK 235 (khớp 236 dòng CK đã nhập) và TM 298: `TM` là mặc định của website nên gồm cả phiếu nhân viên tự lập, và phiếu extension lưu trước 07/08/2026 cũng ghi `TM` với người mua trống (extension chỉ ghi người mua từ ngày đó). Phiếu đã là `TM/CK` hoặc ghi khác, và phiếu có người mua thật, giữ nguyên.
  - **Rớt mạng không còn làm dừng cả lô.** Chạy thật cứ khoảng 50 phiếu lại gặp `Failed to fetch` và script dừng. Nay request đọc tự thử lại (2s, 5s, 15s); lần lưu bị rớt thì đọc lại phiếu: website đã lưu thì xác nhận như thường (không gửi lại), chưa lưu thì làm lại phiếu đó. Lỗi không phải mạng vẫn dừng ngay. Nghỉ 0,4s giữa hai phiếu để không dồn request.
  - Phiếu "chỉ hát" không có dòng hàng: form được nhận qua số phiếu thay vì lưới dòng hàng (trước đây báo "Không mở được form" và có thể để form mở); tiền hàng 0 thì gửi lưới rỗng, có tiền hàng mà không đọc được dòng nào thì chặn.

## 1.29.4 (2026-10-02)

- **Mọi phiếu extension lưu đều ghi phương thức thanh toán `TM/CK`** (kế toán chốt 02/10/2026), kể cả dòng CK/TM của danh sách số tiền. Trước đây dòng CK/TM giữ nguyên `CK` hoặc `TM` khi lưu, và hóa đơn điện tử ra theo đó: tài liệu ghi "khi phát hành dùng TM/CK" nhưng bước phát hành chỉ gửi ID phiếu (`kiemTraThongTin` → `phatHanhHoaDon`), không đổi được phương thức. CK/TM của dòng nguồn vẫn giữ trong dữ liệu extension.
- **Người mua ghi "Bán cho người tiêu dùng"** thay cho "Khách lẻ - Không lấy hóa đơn" (mặc định của website), ở cả luồng sửa phiếu có sẵn lẫn tạo phiếu mới. Địa chỉ giữ "Khách không cung cấp thông tin".
- Màn Phát hành hóa đơn hiện phương thức thanh toán dưới tên người mua để soát trước khi phát hành.
- Phiếu đã lưu trước bản này vẫn mang `CK`/`TM` và "Khách lẻ - Không lấy hóa đơn" trên website; phải sửa (lưu lại) trước khi phát hành, vì hóa đơn điện tử lấy nguyên thông tin từ phiếu.

## 1.29.3 (2026-10-01)

- **Hóa đơn lớn không còn báo "Kho có sức chứa lý thuyết… nhưng không ghép được" khi nâng trần số lượng/HĐ là lập được.** Bội số trần (×1…×5) chỉ được chọn theo sức chứa lý thuyết: 20 dòng đắt nhất ở mức trần, bỏ qua trần nhóm (1 đĩa hoa quả/HĐ), dòng khăn ướt bắt buộc và việc solver gộp trạng thái. Ca thật Linh Đàm 13/07/2026, sao kê 12.623.000đ (chọn 12.622.999đ): sức chứa lý thuyết 8.020.000đ ≥ 110% mức cần 6.311.500đ nên giữ ×1, solver không ghép được và phiếu báo lỗi. Nay không ghép được thì thử tiếp bội số lớn hơn (vẫn tối đa ×5) trước khi báo lỗi. Phiếu đã lập được ở bội số đầu không đổi; không tăng `CALCULATION_VERSION` nên phương án đã Accept được giữ nguyên. Phiếu đang báo lỗi: tải lại extension và trang rồi bấm **Thử dò lại** ở dòng đó.
- **Màn Kho không còn báo "Chưa ánh xạ" cho mã đã xác nhận nhưng hết hàng.** Bảng Kho lấy danh sách mã đã ánh xạ từ `inventory`, mà `inventory` chỉ gồm mã còn tồn; mã tồn 0 vì thế bị coi là chưa ánh xạ. Linh Đàm báo "Chưa ánh xạ: 17" trong khi màn Ánh xạ ghi cả 17 mã "Đã xác nhận". Nay mã đã xác nhận mà hết hàng hiện đúng mã web, tồn 0 và tính vào "Đã hết"; dòng kho hết hàng dùng chung mã web với dòng còn hàng (CAMEL1913 → 1400018) được gắn vào "Nguồn kho" của mã đó. Chỉ thay đổi hiển thị, không đổi tồn hay dữ liệu lập phương án.
- **Ô KPI đầu màn Kho ghi đúng nghĩa.** "Mã đủ điều kiện" từng đếm mọi dòng của bảng (mã web, kể cả mã hết hàng và mã chưa ánh xạ), nên không khớp số dòng ở màn Ánh xạ: Linh Đàm có 109 dòng ánh xạ nhưng màn Kho hiện 77, vì màn Kho gộp theo mã web. Nay ô này là **"Đủ điều kiện lập phương án"** (mã còn tồn hoặc bán theo suất — đúng số mã solver dùng được, 61) kèm dòng phụ "77 mã web · 109 dòng kho". "Đã hết" chỉ đếm mã đã ánh xạ; mã chưa ánh xạ chỉ nằm ở ô riêng.
- **Luật hoa quả áp cho cả Kim Giang và Linh Đàm** (trước đây chỉ Nhơn): hóa đơn trên 1.000.000đ có đúng một đĩa hoa quả, loại nào cũng được (TC 350.000đ hoặc TCTO).
  - **Linh Đàm** nay bán TC/TCTO theo suất (tối đa 1 đĩa/HĐ, không trừ tồn) như Kim Giang. Trước đây TC/TCTO tồn 0 trong kho chung nên bị loại khỏi tồn khả dụng: phiếu Linh Đàm không bao giờ có hoa quả, và rule ưu tiên TCTO mặc định cũng bị bỏ qua mà không báo. Giá theo danh mục web Linh Đàm: TCTO **450.000đ** (Kim Giang 400.000đ).
  - Rule ưu tiên TCTO (nếu còn trong panel) vẫn chạy trước, nên phiếu trên 1 triệu thường ra TCTO; tắt rule đó nếu muốn luân phiên TC/TCTO.
  - Đĩa rẻ nhất 350.000đ nên phiếu vừa qua 1 triệu (khoảng 1.000.001–1.095.000đ) không đủ chỗ cho đĩa + 3 bia + 2 khăn mà vẫn giữ sàn 50 phút. Khi đó phương án bỏ đĩa (`fruitPlatterRelaxed`) thay vì báo "Tiền giờ thấp hơn sàn".
  - Phương án đã Accept không đổi. Giao dịch chưa Accept: dựng lại Batch Review để có hoa quả.

## 1.29.2 (2026-10-01)

- **Phiếu mới lưu đúng đơn giá giờ của phòng (`DONGIA`).** Trước đây extension không đặt trường này mà lấy nguyên từ form; form đọc bằng API (cách không cần tab phụ) có thể chưa được giao diện điền và để 0, khiến Tiền giờ không khớp đơn giá × thời lượng. Bước đối soát sau lưu không so `DONGIA` nên lỗi này sẽ lọt. Nay `DONGIA` = đơn giá của phương án (như các script chuyển phòng đã làm trên trang thật), và nếu form phòng có sẵn đơn giá KHÁC phương án thì dừng trước khi gửi request. Áp dụng cho cả cách mở tab phụ. Nút kiểm tra hiện đơn giá form trả về.
- **Chọn phòng cho phiếu mới theo lịch phòng thật của ngày đó trên website.** Sơ đồ phòng chỉ cho trạng thái hôm nay và extension chỉ biết phòng/giờ của phiếu do chính nó tạo, nên phiếu lập bù cho ngày quá khứ có thể trùng phòng trùng giờ với phiếu khác trên website. Nay bridge đọc mọi phiếu của ngày (`readDayRoomBookings`: danh sách hóa đơn điện tử + đầu phiếu từng phiếu, chỉ đọc, bỏ phiếu đã hủy) và gộp vào lịch phòng; đọc một lần mỗi ngày trong 10 phút. Không đọc được lịch thì dừng, không mở phòng. Áp dụng cho cả hai cách tạo phiếu mới.

## 1.29.1 (2026-10-01)

- **Sổ đối soát tự khớp lại với phiếu trên website ở bước phát hành.** Phiếu bị sửa ngoài extension sau khi ghi sổ — như 9 phiếu Paris Nhơn 01/07/2026 được chuyển khỏi quầy BÁN LẺ bằng script `data/chuyen-phong-*.js`, trong đó 01000000269 còn đổi số lượng một dòng hàng — làm sổ lệch phiếu thật, mà sổ là nguồn mặt hàng ("lấy mặt hàng") khi phát hành HĐĐT và xuất file hạch toán.
  - **Tự động:** Tải danh sách phát hành và bấm Phát hành đều so nhanh tiền hàng trên web với tổng dòng hàng trong sổ (`readInvoiceSummary`: `GET AddEdit?RecordID=…`, chỉ đọc, không mở phiếu). Phiếu lệch được đánh dấu trên bảng; khi phát hành, bước lấy mặt hàng đọc lại từ phiếu thay vì tin sổ, rồi cập nhật sổ đối soát và tồn kho theo phiếu thật. Hộp xác nhận phát hành nêu rõ các phiếu này.
  - **Nút "Đối soát lại mặt hàng từ website"** ở màn Phát hành hóa đơn: cập nhật ngay không cần phát hành, chỉ mở những phiếu lệch. Hiện danh sách chênh lệch để xác nhận; cập nhật sổ, tồn kho (chỉ đúng các mã thay đổi), phương án đã duyệt và phòng/giờ của phiếu trong một lần ghi. Phiếu lệch tổng tiền chỉ được báo, không tự sửa. Xem `docs/RESTOCK.md`.
  - Phiếu mất phản hồi khi phát hành mà sổ lệch web: không ghi mặt hàng sai của sổ vào sổ phát hành, để trống và báo thiếu.

## 1.29.0 (2026-09-30)

- **Tạo phiếu mới không cần mở tab Bán hàng phụ.** Lưu API chọn phòng theo sơ đồ phòng của website, đọc form trống của phòng bằng `GET AddEdit` (RecordID rỗng: chỉ dựng form, không tạo bản ghi — trace 02/08/2026), rồi gửi hai request `DoSave` và đối soát ngay trên tab danh sách. Bỏ được một lần tải trang đầy đủ và thời gian chờ tab phụ cho mỗi phiếu mới.
  - Chưa kiểm chứng trên website thật rằng HTML trả về chứa `new DataTransferJs(...)`; nút **Kiểm tra tạo phiếu không cần tab phụ** chỉ đọc form của một phòng trống để xác nhận, không lưu gì.
  - Không có sơ đồ phòng hoặc không đọc được form phòng (chưa gửi request ghi nào) thì tự quay về cách mở tab phụ như trước. Phòng đang có phiên chạy hoặc mất phiên đăng nhập thì dừng, không quay về.
  - Lõi tạo phiếu (dấu chống trùng, gọi API, ghi kết quả) dùng chung cho cả hai cách; cách mới ghi luôn phòng và giờ đã dùng để phiếu mới kế tiếp không trùng phòng trùng giờ.
- **Không tạo và không dùng phiếu ở quầy BÁN LẺ** vì không lập được hóa đơn điện tử.
  - Nhận diện quầy BÁN LẺ theo cụm từ (cả "BÁN LẺ 2", "KHU BÁN LẺ"); trước đây chỉ khớp đúng chuỗi "BAN LE". Cộng thêm cờ quầy của sơ đồ phòng.
  - Bridge từ chối tạo phiếu mới và từ chối lưu phiếu có sẵn ở quầy BÁN LẺ, kiểm tra ngay trước khi gửi `DoSave`.
  - Batch Review bỏ qua phiếu chưa xuất ở quầy BÁN LẺ khi mở thử (không tính vào giới hạn 3 phiếu thử, nhớ lại để không mở lại); nếu cả ngày chỉ còn phiếu BÁN LẺ thì dò HĐ đã xuất rồi lập phiếu mới ở phòng hát. Chế độ "Điều chỉnh một phiếu" cũng từ chối phiếu BÁN LẺ.
  - Kết quả đọc phiếu (`scan`) trả thêm tên phòng, id phòng và cờ quầy bán lẻ.
- **Sửa lỗi lệnh ghi hết giờ sau 5 giây.** `createAndPayFreshInvoiceViaApi` và `saveExistingInvoicePlanViaApi` gửi 2–3 request lên server nhưng chỉ được chờ 5 giây: server chậm là extension báo "Trang không phản hồi" trong khi bridge vẫn đang gửi và có thể đã lưu. Nay chờ 90 giây.

## 1.28.9 (2026-09-29)

- **Kiểm tra phiên bản sao kê giữa các tab.** Mỗi lần ghi sao kê tăng `revision`; tab nào ghi dựa trên bản cũ hơn bản đang lưu sẽ bị từ chối với lời nhắc tải lại trang, thay vì âm thầm đè mất thay đổi của tab khác. Ghi sổ đối soát (`commitVerifiedInvoice`) cũng kiểm tra như vậy và từ chối cả lần ghi, để tồn kho và sổ không bị ghi nửa vời.
- Bước "kiểm tra rồi ghi" chạy trong Web Lock dùng chung giữa các tab cùng origin. Trình duyệt không có Web Locks (trang `http://`) thì vẫn kiểm tra revision, chỉ còn khe nhỏ khi hai lần ghi trùng đúng thời điểm.
- Mọi lần ghi của tab tạo phiếu phụ (dấu "đang tạo phiếu", kết quả API, báo lỗi, phòng đã mở, hủy phương án) nay sửa đúng giao dịch trên **bản mới nhất** trong storage (`mutateStatement`): không thất bại vì tab gốc vừa ghi và không đè thay đổi của tab gốc. Kiểm tra dấu chặn và ghi dấu "đang tạo phiếu" gộp trong một lần khóa, nên hai tab không thể cùng tạo phiếu cho một giao dịch.
- Nhập sao kê / danh sách số tiền giữ revision của bản đang có.

## 1.28.8 (2026-09-29)

- **Sửa lỗi đối soát ở Paris Nhơn ghi đè kho chung của Kim Giang/Linh Đàm.** `commitVerifiedInvoice` ghi kho vào khóa cố định `invoiceTargetSharedWarehouseV1` thay vì `warehouseKey()`, nên từ khi Nhơn tách kho riêng (10/09/2026) mỗi lần đối soát một phiếu ở Nhơn lại đè kho Nhơn lên kho chung của Kim Giang/Linh Đàm, còn kho riêng của Nhơn không bao giờ bị trừ. Khi Kim Giang/Linh Đàm mở lại trang, mã kho không có trong kho bị đè sẽ về tồn 0 và "thiếu trong kho". Cần kiểm tra và kiểm kê lại kho của cả ba cơ sở nếu đã đối soát ở Nhơn từ 10/09.
- Test lưu trữ đa cơ sở nay dùng chung một storage cho cả ba cơ sở; trước đây tab Nhơn dùng storage riêng nên phép kiểm "không ghi đè kho chung" luôn đúng dù code sai.

## 1.28.7 (2026-09-29)

- Thêm quyền `unlimitedStorage`: sổ đối soát và sổ phát hành chỉ tăng, trong khi `chrome.storage.local` mặc định giới hạn khoảng 10 MB cho cả ba cơ sở. Đầy bộ nhớ có thể làm hỏng đúng bước ghi kết quả sau khi phiếu đã được tạo.
- Sửa thông báo còn ghi cứng "trần 35%" (ở lý do loại phương án và bảng kiểm tra phương án): nay đọc thẳng từ `MAX_HOUR_PRETAX_RATIO` (hiện 45%).
- Sửa 20 comment còn ghi "sàn Nhơn 15 phút" / "trần 35%" cho khớp luật hiện hành; số liệu lịch sử được ghi rõ là của luật cũ. Ngưỡng phiếu nhỏ của Nhơn trong comment sửa thành 275.000đ / 385.000đ / 495.000đ (phòng 400k/600k/800k).
- Gỡ luồng cũ không còn được gọi trong `bridge.js`: năm lệnh điều phối (`apply`, `applyInvoiceTimes`, `applyInvoiceTotals`, `normalizePaymentDialog`, `saveCurrentInvoiceViaApi`) và bảy hàm của luồng "bấm nút Lưu của website để khởi tạo phiếu mới", đã được thay bằng API tạo phiếu hai bước. Chốt chặn thanh toán khi người dùng tự bấm Lưu vẫn giữ nguyên.
- Đổi tên `createAndPayFreshInvoiceViaApiLegacy` thành `postFreshInvoiceTwoStep` — đây là hàm tạo phiếu duy nhất đang chạy, không phải bản cũ.
- Cập nhật README và `docs/BATCH_REVIEW.md` theo luồng hiện tại: extension tự lưu phiếu bằng API rồi đối soát, file hạch toán là `.xlsx`, cách chọn phiếu ưu tiên giờ vào/ra khớp ngày sao kê.

## 1.28.6 (2026-09-29)

- **Danh sách số tiền CK/TM dùng được ở mọi cơ sở** (kế toán chốt 29/09/2026). Nút nhập danh sách số tiền hiện ở cả Kim Giang và Linh Đàm, và bridge không còn chặn phương thức `CK`/`TM` ngoài Paris Nhơn. Giao dịch từ sao kê ngân hàng vẫn ghi `TM/CK` như cũ.
- **Paris Nhơn tách khỏi điều phối phát hành** vì có dải số hóa đơn điện tử riêng. Nhơn không còn bị nhắc chờ Linh Đàm/Kim Giang, không hiện ô Thứ tự phát hành, không ghi chốt vào bản ghi dùng chung; Linh Đàm/Kim Giang cũng không còn nhận cảnh báo về lô của Nhơn. Dữ liệu Nhơn còn sót trong bản ghi điều phối cũ được tự loại khi đọc.
- Luật sàn 30 phút (kể cả với phiếu có sẵn) xác nhận áp dụng cho cả ba cơ sở; không đổi code.

## 1.28.5 (2026-09-28)

- **Chống tạo trùng phiếu mới.** Tab worker ghi dấu `newInvoiceCreateStartedAt` vào sao kê TRƯỚC khi gửi API tạo phiếu. Khi lần gửi trước chưa có kết quả chắc chắn (tab bị đóng hoặc crash giữa chừng, request hết giờ, website trả lỗi sau khi đã nhận request), mọi lần chạy lại đều bị chặn với hướng dẫn: kiểm tra danh sách Bán hàng ngày đó rồi bấm **Đặt lại** giao dịch. Trước đây giao dịch vẫn ở `batch_ready` nên bấm Lưu API lần nữa sẽ tạo thêm một phiếu.
- API tạo phiếu thành công thì kết quả được ghi vào sao kê **ngay lập tức**, trước bước ghi/tải log debug, để khoảng hở giữa "server đã cấp số" và "extension đã ghi nhận" ngắn nhất có thể.
- Bridge đánh dấu lỗi xảy ra trước khi request rời trình duyệt (`[chua-gui-api]`). Chỉ những lỗi này mới được gỡ dấu để thử lại ngay.
- Phiên mode=0 đã được cấp số mà bước thanh toán mode=2 lỗi: thông báo nêu rõ số phiếu và ID phiên tạo dở để xử lý trên website.
- **Tab gốc dừng ngay khi tab worker lỗi.** Worker ghi `newInvoiceWorkerError` (không có phòng rảnh, không áp được phương án, form đã mở từ trước, phương án bị hủy) và tab gốc dừng lô với đúng lý do. Trước đây tab gốc chờ tín hiệu `status === "error"` mà không nơi nào ghi, nên luôn chờ đủ 90 giây. Khi hết giờ, tab gốc nạp lại sao kê mới nhất để không ghi đè dấu worker vừa ghi.
- **Đặt lại** giao dịch và **Hoàn kho theo khoảng ngày** gỡ các dấu trên.

## 1.28.4 (2026-09-28)

- **Phiếu ĐÃ CÓ SẴN nay cũng phải đạt sàn 30 phút.** Trước đây nền Tiền giờ của phiếu có sẵn là chính Tiền giờ cũ trên form, nên phiếu đang ghi 52.000đ cho sàn ~41.600đ và mọi tổ hợp hàng tới 415.000đ đều hợp lệ — ca thật Nhơn 21/07/2026 ra 3-14 phút hát (sao kê 500.500đ–607.200đ). Nay nền không thấp hơn mốc phút, phần nới 20% không kéo sàn xuống dưới mốc, và có cổng chặn cuối so theo số phút. Các ca đó nay ra 30-32 phút. Tăng mốc công thức lên `website-inclusive-vat-4` để phương án cũ tự hủy.
- Chọn phòng cho phiếu mới theo **sơ đồ phòng do website trả về** thay vì chỉ quét thẻ trên trang. Bridge bắt thụ động response sơ đồ (nhận diện theo hình dạng dữ liệu `Tag[].items[]` có `DKHUVUCID`/`trangThai`, không cần biết trước endpoint) khi màn hình Bán hàng tự tải, nhớ luôn request đó để gọi lại bản mới nhất. Mỗi cơ sở tự lấy sơ đồ của mình, không cần cung cấp dữ liệu tay.
- Phòng hợp lệ: trạng thái 0, không có giờ đang chạy, không phải quầy bán lẻ (theo tên phòng, tên khu hoặc cờ quầy), không trùng giờ với phiếu đã lập trong ngày; phòng chưa dùng trong ngày được ưu tiên. Thẻ chưa render (Nhơn mặc định chỉ hiện BÁN LẺ) thì tự chọn TẤT CẢ rồi bấm đúng thẻ theo tên.
- Sau khi form mở, đối chiếu `DBANID` trên form với id phòng đã chọn; lệch thì đóng form và báo lỗi, không lập phiếu. Đây là chốt chặn cho tình huống phiếu 01000000260 bị lập lên BAN LE.
- Không bắt được sơ đồ thì giữ nguyên cách quét thẻ cũ. Thông báo lỗi nêu số phòng theo sơ đồ API và số thẻ trên trang để phân biệt hai nguồn.
- `bridge.js` chuyển sang nạp ở `document_start` để móc XHR/fetch trước khi website tải sơ đồ phòng; các việc bridge làm lúc nạp (bọc alert, móc request, observer, listener) đều không cần DOM dựng xong.
- Thông báo "Extension context invalidated" (extension vừa Reload/cập nhật, tab còn content script cũ) ở mọi đường đều đổi thành hướng dẫn F5 kèm nút **Tải lại trang**; Batch Review và Lưu API kiểm tra context ngay từ đầu để không chạy hết lô rồi mới vỡ ở bước lưu.
- Tự tải lại trang khi website quá tải rồi chạy tiếp: lô dài làm grid Kendo tích lũy lỗi (`Cannot call method 'value' of kendoDropDownList before it is initialized`, danh sách không tải xong, trang không phản hồi). Lưu API và Batch Review nhận diện dấu hiệu đó, ghi cờ tiếp tục vào phiên, tải lại trang, chờ danh sách dựng xong rồi chạy tiếp phần dở (tối đa 3 lần vì lỗi mỗi lô). Lưu API còn tự tải lại chủ động sau mỗi 15 phiếu.
- Paris Nhơn có rule hoa quả: ánh xạ tự thêm 4 đĩa hoa quả bán theo suất (Hoa quả thập cẩm 450.000đ, Bưởi da xanh 350.000đ, Nho 250.000đ, Bưởi da xanh đĩa nhỏ 250.000đ; mã web 0000013/0000012/0000047/0000048), tối đa một đĩa mỗi hóa đơn, không trừ tồn. Hóa đơn trên 1.000.000đ phải có đúng một đĩa **bất kỳ loại nào** (đặt theo nhóm, không ghim một mã) để bốn loại đĩa được luân phiên.
- **Sàn 30 phút hát nay thắng các quy ước cơ cấu.** Kế toán chốt 18/09/2026: mọi hóa đơn tối thiểu 30 phút. Sàn này mâu thuẫn với trần Tiền giờ 35% tổng trước VAT và tỷ lệ Tiền giờ ≤ 2 lần tiền hàng ở phiếu nhỏ (30 phút chiếm 37-51%), nên sao kê 486.200đ từng ra đúng 1 phút hát. Nay trần và tỷ lệ được nới vừa đủ để chứa sàn; phiếu từ khoảng 396.000đ trở lên đạt đủ 30 phút.
- **Phương án "Sẵn sàng" lập bằng công thức cũ nay cũng bị hủy khi nạp lại phiên.** Vòng hủy phương án cũ chỉ xét trạng thái `planned`/`batch_ready` vì đó là hai trạng thái nằm trong sao kê; phương án "Sẵn sàng" chỉ nằm trong phiên UI nên không có gì đụng tới và sống sót qua mọi lần đổi công thức. Ca thật 21/07/2026: phiếu 500.500đ vẫn hiện "3 phút · theo giờ 30.000đ" và 517.000đ hiện "6 phút · 60.000đ" sau khi sàn đã nâng lên 30 phút — công thức hiện tại cho cả hai đều 30 phút. Nay `hydrateBatchPlans` kiểm mốc công thức và bỏ những dòng đã lỗi thời.
- **Tăng mốc công thức lên `website-inclusive-vat-3` để phương án cũ được tính lại.** `buildBatchReview` dùng lại nguyên vẹn phương án đã Accept khi mốc công thức trong phương án trùng `CALCULATION_VERSION` (nhánh `batch_ready` trả thẳng `batchApprovedPlan` rồi `continue`). Các đợt đổi luật vừa qua không tăng mốc, nên phiếu đã Accept giữ nguyên số cũ và bấm **Tính toán lại** cũng không đổi gì — sao kê 547.800đ vẫn hiện 8 phút / 78.000đ theo sàn 30 phút cũ, trong khi công thức mới cho 17 phút / 168.000đ. Nay mọi phương án lập trước bản này tự bị hủy và tính lại; giao dịch đã Accept sẽ quay về **Chờ xử lý** kèm ghi chú "Phương án cũ dùng công thức trước phiên bản hiện tại; cần tính lại".
- **Vượt tỷ lệ Tiền giờ/tiền hàng vài trăm đồng không còn loại phiếu.** Tiền hàng đi theo lưới giá mặt hàng (bước 5.000đ) nên hiếm khi rơi đúng mức tối thiểu mà ràng buộc "Tiền giờ ≤ 2 lần tiền hàng" đòi hỏi. Cả dải sao kê 495.100đ–498.000đ có tiền hàng 150.000đ và Tiền giờ 300.091đ — vượt trần đúng 91đ nên bị loại với lý do "vượt 2 lần tiền hàng", trong khi 494.900đ ngay dưới đó vẫn lập được với tỷ lệ 2,10. Nay phần vượt nhỏ hơn một bước giá tiền hàng được bỏ qua; vượt thật do tổ hợp vẫn bị chặn như cũ.
- **Số phút ghi lên form nay luôn khớp Tiền giờ website tự tính.** Website tính Tiền giờ TỪ giờ vào/ra và làm tròn 0,01 giờ nên không phải số tiền nào cũng biểu diễn được, trong khi solver lại làm tròn LÊN theo bước giá. Sao kê 1.001.000đ chốt 504.000đ nhưng giờ ra 50 phút = 0,83 giờ = 498.000đ, phiếu lưu xong ra 998.800đ — lệch 2.200đ mà cổng kiểm tra vẫn cho qua. Nay `hourFromTime` được tính lại từ ĐÚNG số phút sẽ ghi lên form.
- **Nhánh phiếu nhỏ chọn số phút bằng mốc gần nhất biểu diễn được.** Trước đây làm tròn thẳng `hour / rate`, nên sao kê 132.000đ (Tiền giờ 95.000đ) ra 10 phút = 102.000đ, lệch 7.000đ — vượt một bước giá 6.000đ.
- **Sàn phút chỉ còn MỘT nguồn (`minimumSingingMinutes`).** Mốc từng bị chép tay ở ba nơi (`hourPlanningBounds`, `calculateNewInvoiceBatchPlan`, `newInvoicePlanValidationError`); lệch nhau khiến phương án vừa lập xong lại bị chính khâu sau loại. Có test chặn việc chép lại.
- **Nâng trần Tiền giờ từ 35% lên 45% tổng trước VAT; Paris Nhơn giữ sàn 30 phút** (kế toán chốt 23/09/2026). Với trần 35%, sao kê 547.800đ (trước VAT 498.000đ) chỉ được tối đa 174.300đ Tiền giờ = 17 phút ở phòng 600k, nên sàn 30 phút bị kẹp xuống và mọi lần "Tính toán lại" đều ra cùng số phút. Ở trần 45% sàn 30 phút mới thực sự đạt được: 547.800đ nay ra 32 phút. Sao kê trên 1 triệu vẫn giữ mốc 50 phút.
- **Ngưỡng "phiếu quá nhỏ" suy theo đơn giá phòng** thay vì cố định 300.000đ: sàn 30 phút ở phòng 400k là 200.000đ nhưng ở phòng 800k là 400.000đ, nên một mốc cứng sẽ hoặc chặn oan phòng rẻ hoặc bỏ lọt phòng đắt. Ngưỡng thực tế: 400k → 275.000đ, 600k → 385.000đ, 800k → 495.000đ.
- **`newInvoicePlanValidationError` lấy sàn phút từ cùng nguồn với lúc lập phương án.** Nó vẫn tự tính `grand > 1000000 ? 50 : 30`, nên khi sàn của Nhơn đổi thì phương án vừa tính xong lại bị chính hàm này loại lúc mở form ("Tiền giờ thấp hơn mức tối thiểu"). Nay cả hai dùng chung `minimumSingingMinutes`.
- **Phiếu không đủ tiền cho sàn thì chỉ 1 bia, còn lại là giờ hát.**
- **Chọn món của phiếu nhỏ nay phải chừa đủ tiền cho sàn thời lượng.** Mốc cũ là hằng số 30.000đ (3 phút của luật cũ), nên sao kê chọn nhầm món đắt và Tiền giờ rơi xuống dưới sàn.
- **Chọn phòng cho phiếu mới ưu tiên ĐẠT SÀN trước.** Ở nhánh phiếu nhỏ, Tiền giờ đã cố định bằng phần trước VAT trừ một món nên phòng càng rẻ càng ra nhiều phút. Thứ tự cũ xếp theo phần bù (bằng 0 ở mọi mức) rồi "gần 90 phút nhất", nên nó kéo về phòng ĐẮT: sao kê 143.000đ từng chọn phòng 800k và ra 8 phút, trong khi phòng 400k cho 16 phút. Khi KHÔNG mức nào đạt sàn thì lấy mức cho nhiều phút nhất, tức phòng rẻ nhất.
- **Sửa lỗi lưu xong giờ vào/ra KHÔNG đổi.** Phần tính toán giờ ra đã đúng từ trước (phương án luôn suy giờ ra từ Tiền giờ), nhưng phần GHI xuống form vẫn bị khóa: `applyInvoicePlan` trong `bridge.js` chỉ ghi giờ khi `sessionRebased`, mà phiếu đã tồn tại luôn có cờ đó là false. Ca thật Nhơn 01/07/2026, phiếu HD0126070003: phương án 16 phút / 108.000đ nhưng form giữ nguyên 18:06 → 19:33 (87 phút). Website tính Tiền giờ TỪ giờ vào/ra nên phiếu lưu xong lệch tổng. Nay giờ ra được ghi mỗi khi khác giờ đang có trên form; phiếu đã tồn tại vẫn giữ nguyên giờ vào (dữ liệu thật của khách), chỉ phiếu rebase mới được đặt cả hai.
- **Bước đối soát sau lưu không còn tự che sai lệch giờ.** Hai chỗ cùng lấy giờ từ form thay vì từ phương án nên luôn so giờ cũ với chính nó và báo khớp: `pendingPlanFromApproved` lấy `checkOut` từ snapshot, và `applyInvoicePlan` echo lại chính `detail.checkOut` vừa nhận thay vì đọc giờ thật trên form. Nay giờ ra để đối soát lấy từ phương án, còn kết quả trả về đọc lại từ form, nên phiếu còn giữ giờ cũ sẽ bị chặn với lý do "Sai giờ ra" thay vì lọt ra "Đã xử lý".
- **Panel thủ công gửi đúng giờ ra của phương án.** Nó gửi chính giờ cũ của form cho `applyInvoicePlan` nên bridge luôn thấy "không đổi", trong khi nhánh ghi bù đã bị vô hiệu hóa bằng `false &&` từ trước.
- **Paris Nhơn: phiếu dưới 500.000đ chỉ cần 1 bia + 1 khăn ướt.** Mức bắt buộc 3 bia + 2 khăn ở kho Nhơn rẻ nhất đã ~410.000đ. Với sao kê 486.200đ (trước VAT 442.000đ) nó ăn gần hết phần trước VAT: chỉ còn 32.000đ cho Tiền giờ nên sàn 30 phút bị hạ xuống **3 phút** — phiếu 3 phút hát mà uống 3 bia thì không qua được kế toán. Kế toán chốt 18/09/2026 hạ mức bắt buộc cho phiếu nhỏ ở Nhơn, nhờ đó sàn 30 phút trở lại khả thi. Kim Giang và Linh Đàm giữ nguyên 3 bia + 2 khăn.
- **Nới rule luân phiên nay so theo trần tiền hàng, không phải tổng trước VAT.** Mốc cũ chỉ bắt được trường hợp cực đoan "tổ hợp ăn sạch phần trước VAT"; tổ hợp vượt trần tiền hàng nhưng chưa ăn hết vẫn phá sàn Tiền giờ mà nhánh nới không chạy. Lộ rõ khi món bắt buộc ở Nhơn hạ xuống: trần tiền hàng của sao kê 440.000đ siết từ 160.000đ xuống 100.000đ và đĩa hoa quả 250.000đ đẩy tiền hàng lên 305.000đ — vượt trần, chưa vượt 400.000đ.
- **Phiếu quá nhỏ lấy tối đa có thể thay vì bị chặn.** Phiếu không đủ tiền cho 30 phút (ví dụ 143.000đ) chừa đúng một món rẻ rồi dồn hết phần còn lại vào Tiền giờ. Sàn cũng không ép tiền hàng xuống dưới giá món bắt buộc, để phương án không bị loại vì thiếu bia/khăn.
- **Phiếu có sẵn: giờ vào/ra nay luôn khớp Tiền giờ của phương án.** Nhánh thường chỉ tính lại giờ ra khi phiên bị rebase, nên phiếu giữ giờ cũ trong khi Tiền giờ đã đổi: Batch Review hiện "19:40 → 21:02, 0 phút · theo giờ 140.000đ" (82 phút ở phòng 600k phải là 820.000đ). Website tính Tiền giờ TỪ giờ vào/ra nên khi lưu sẽ lệch tổng. Nay giờ ra luôn suy từ Tiền giờ, và thời lượng được trả về để không còn hiển thị "0 phút".
- **Rule ưu tiên luân phiên nay được nới khi nó ăn hết phần trước VAT.** Ca thật ở Nhơn: rule ép một đĩa hoa quả 250.000đ cho mọi phiếu trên 400.000đ; với sao kê 440.000đ (trước VAT 400.000đ), đĩa hoa quả cộng món bắt buộc 160.000đ thành 410.000đ nên không còn chỗ cho Tiền giờ. Cơ chế nới rule cũ chỉ chạy khi solver KHÔNG tìm được tổ hợp, mà ở đây solver vẫn trả về tổ hợp vượt mức, nên phiếu bị loại oan. Nay nới cả khi tổ hợp ăn hết phần trước VAT, và chỉ nhận kết quả nới nếu nó thực sự chừa được Tiền giờ.
- **Không để lọt phương án thiếu món bắt buộc.** Solver xếp món bắt buộc ưu tiên cao nhất nhưng khi không tổ hợp nào đủ thì phương án tốt nhất vẫn thiếu, và trước đây lọt ra "Sẵn sàng" với 2 bia thay vì 3. Solver nay trả về số món còn thiếu và Batch Review chặn lại kèm số liệu.
- **Thông báo "không có Tiền giờ" tự chẩn đoán:** nêu thẳng tổng trước VAT, tiền hàng, và giá món bắt buộc rẻ nhất, thay vì đổ chung cho tồn kho/rule.
- **Đơn giá giờ của phiếu có sẵn luôn quy về một mức trong bảng giá.** Phép chia Tiền giờ cho thời lượng của phiếu cũ cho ra những con số không tồn tại (21.000đ/giờ ở ca thật: phiếu 300 phút, Tiền giờ 105.000đ), kéo theo bước giá lẻ làm phiếu bị loại hoặc sinh thời lượng phi lý.
- **Giờ ra đề xuất là thời lượng ĐÚNG với Tiền giờ.** Nhiều mốc phút cho cùng một số tiền do website làm tròn 0,01 giờ; trước đây khi hòa thì lấy mốc gần thời lượng cũ nhất, nên phiếu cũ 300 phút giữ nguyên 300 phút và hiển thị "300 phút · theo giờ 105.000đ". Nay lấy mốc ngắn nhất, và chỉ dò quanh thời lượng đúng thay vì cả ngày.
- **Luật phiếu nhỏ đổi theo chốt của kế toán 17/09/2026:** ngưỡng hạ từ 500.000đ xuống **300.000đ**, và thay "2 chai bia" bằng **một món bia/nước giá tối đa 50.000đ**, toàn bộ phần trước VAT còn lại vào Tiền giờ. Món được luân phiên giữa các mã đủ điều kiện. Phiếu 300.000đ–500.000đ nay đi nhánh thường với nhiều dòng hàng.
- **Giờ vào/ra của phiếu nhỏ phải khớp Tiền giờ.** Nhánh này trước đây giữ nguyên giờ của phiếu cũ nhưng vẫn đặt Tiền giờ bằng phần còn lại, nên Batch Review hiện "18:06 → 19:33, 0 phút · theo giờ 30.000đ" (87 phút ở phòng 600k phải là 870.000đ). Nay giờ ra luôn được đề xuất lại theo đúng Tiền giờ và thời lượng được trả về để hiển thị đúng.
- **Nâng giới hạn lô từ 50 lên 500 giao dịch**, đủ chạy cả tháng (file số tiền của Nhơn có 435 dòng). Lô dài không làm website quá tải nhờ cơ chế tự tải lại trang sau mỗi 15 phiếu.
- **Sửa lỗi "Phương án không có Tiền giờ" ở phiếu có sẵn.** Đơn giá giờ của phiếu đang mở được suy bằng phép chia Tiền giờ cho thời lượng, cho ra số lẻ khi phiếu cũ có phần bù hoặc thời lượng không tròn (700.000đ / 3 giờ = 233.000đ/giờ → bước giá 2.330đ). Bước đó không phải bội của bước giá hàng 5.000đ nên không tổ hợp nào để lại Tiền giờ hợp lệ, và phiếu bị loại dù phiếu nhỏ hơn vẫn lập được (ca thật: sao kê 577.500đ ở Nhơn ngày 01/07/2026, trong khi 143.000đ vẫn Sẵn sàng). Nay đơn giá được làm tròn về mức gần nhất trong bảng giá của cơ sở (chênh tối đa 15%), chỉ giữ số suy ra khi lệch quá xa mọi mức đã biết.
- **Thêm Hoàn kho theo khoảng ngày** ở màn Kho vật lý, để chạy lại một lô đã đối soát sai. Trả số lượng đã trừ về kho riêng và kho dùng chung theo đúng sổ đối soát (không suy từ phương án hiện tại, vì phương án có thể đã bị tính lại), đưa giao dịch về Chưa xử lý và xóa phương án đã Accept. Hộp thoại xác nhận liệt kê số lượng sẽ hoàn theo từng mặt hàng và danh sách số phiếu đã lưu trên website. Hóa đơn trên website **không** bị xóa, kế toán tự xử lý; xem `docs/RESTOCK.md`.
- **Tiền giờ Paris Nhơn tính theo đơn giá của từng phòng, không còn mặc định 600.000đ.** Khảo sát 17/09/2026: phòng đuôi 3 là 800.000đ/giờ, đuôi 6 là 400.000đ/giờ, còn lại 600.000đ/giờ (xem `docs/ROOM_HOURLY_RATES.md`). Đơn giá quyết định bước giá Tiền giờ (1% đơn giá: 4.000/6.000/8.000đ), sàn theo phút và thời lượng gợi ý, nên phương án phải biết trước hạng phòng: extension thử cả ba mức rồi chọn mức cho phương án đẹp nhất (phần bù nhỏ nhất, thời lượng gần 90 phút, ưu tiên phòng rẻ), ghi lại `hourlyRate`, và khi mở form chỉ chọn phòng đúng đơn giá đó. Kim Giang và Linh Đàm chưa khảo sát nên giữ nguyên 600.000đ.
- **Bỏ sàn Tiền giờ khi sàn chạm trần.** Phiếu khoảng 500.000đ - 860.000đ có mốc phút 30/50 bị kẹp xuống đúng bằng trần 35% tổng trước VAT, nên Tiền giờ chỉ còn MỘT giá trị hợp lệ và tiền hàng phải khớp chính xác giá trị đó theo bước giá — hầu như không ghép được (541.200đ: sàn = trần = 172.200đ, tổ hợp gần nhất lệch 200đ). Nay ở đúng trường hợp đó bỏ hẳn sàn, giữ trần, phần dư dồn vào Tiền giờ như phiếu nhỏ dưới 500.000đ.
- Sửa phương án phiếu mới "Sẵn sàng" nhưng bị chặn lúc mở tab worker với "Tiền giờ thấp hơn mức tối thiểu": solver so sàn Tiền giờ bằng mức đã làm tròn lên bước 6.000đ nên phương án vỡ sàn vài trăm đồng vẫn thắng. Nay so bằng Tiền giờ chốt chính xác; phiếu mới không đạt sàn bị chặn ngay trong Batch Review với lý do rõ; Lưu API dừng vì phương án bị hủy thì nêu đúng lý do thay vì "Khong mo duoc tab worker".
- Phiếu nhiều dòng hơn, giống đơn thật hơn: số dòng "đẹp" tính theo 250.000đ tiền hàng một dòng (trước 350.000đ), tối đa 7; trần số dòng nới theo; phạt tập trung nhẹ để 6 lon bia tự rải sang 2 loại thay vì dồn một mã. Phiếu ~1 triệu nay 4-6 dòng thay vì 3.
- Luân phiên mã trong lô: hình phạt "đã dùng" tăng theo bình phương số lần dùng thay vì tuyến tính, vì cộng tuyến tính theo dòng khiến tổ hợp ít dòng lặp lại mã cũ vẫn rẻ hơn tổ hợp nhiều dòng toàn mã mới và cả lô quay về cùng một bộ (Tiger + Bưởi nhỏ + khăn). Phiếu dưới 500.000đ luân phiên trong số bia mà hai chai vẫn để lại ít nhất 30.000đ Tiền giờ, chỉ rơi về bia rẻ nhất khi không bia nào vừa.
- Hóa đơn rất lớn ở cơ sở toàn mã giá thấp: khi 20 mã ở trần số lượng/HĐ mặc định không đạt tiền hàng tối thiểu do trần 35% Tiền giờ (Nhơn 14.000.000đ cần ≥ 8.272.728đ, sức chứa chỉ ~6,8 triệu), extension nâng trần theo bội số vừa đủ (dư 10%, tối đa 5 lần) rồi mới giải; phiếu thường giữ trần mặc định. Mã bán theo suất (đĩa hoa quả) và mã có trần cứng riêng không được nhân. Phương án ghi `quantityScale` để kế toán biết trần đã dùng.
- Bridge gọi thẳng endpoint sơ đồ phòng đã xác nhận từ Network (`POST /<cơ sở>/Khuvuccontrol/LayDanhSachBan?is_ajax=1`, body `{"DKHUVUCID":"_ALL_","UITHIETKE":0,"MODE":0}`) khi cần bản mới nhất; bắt thụ động chỉ còn là dự phòng. Mất phiên (HTML login) được nhận diện, không coi là sơ đồ.

## 1.27.4 (2026-09-16)

- Paris Nhơn: tự chuyển sơ đồ sang khu `TẤT CẢ` trước khi tìm phòng, vì website mặc định chỉ render khu `BÁN LẺ` (một thẻ `BAN LE`). Loại trừ cả `BÁN LẺ` và `BAN LE` khỏi lựa chọn phòng có tiền giờ; thông báo lỗi cho biết đã chọn được toàn bộ khu hay chưa.
- Nút `TẤT CẢ` được tìm theo id `_ALL_` và dự phòng theo chữ trên nút; quyết định bấm theo kết quả quét (chưa có thẻ phòng nào ngoài BÁN LẺ) thay vì theo class của nút, và chờ thẻ phòng render xong trước khi quét lại.
- Lưu ý dữ liệu: phiếu 01000000260 (Nhơn, sao kê 01/07/2026, 393.800đ) đã được tạo trên `BAN LE` trước khi có bản sửa này; kế toán cần kiểm tra và chuyển phòng hoặc hủy phiếu trên website.

## 1.27.3 (2026-09-15)

- Paris Nhơn: khi giao diện phòng không đặt tên vào `img alt`, extension lấy tên từ thuộc tính dữ liệu hoặc nội dung thẻ phòng (VIP 21–55), chọn được phòng riêng thay vì báo chỉ có BÁN LẺ. Thông báo lỗi mở form bổ sung số thẻ phòng, thẻ rảnh và phòng không trùng giờ; thao tác làm lại xoá đặt phòng tạm cũ.

## 1.27.2 (2026-09-15)

- Sau khi API tạo phiếu thành công, bước đối soát đọc lại đúng số phiếu với danh sách mới tải; không dùng cache cũ và có thể quét các trang Kendo phân trang để tìm phiếu vừa cấp số. Không gọi lại API tạo nếu đọc lại chưa thấy.

## 1.27.1 (2026-09-15)

- Sửa solver coi `constraintGroupMax = null` (giá trị kho thật ghi cho mọi mã không có trần nhóm) là trần nhóm = 0, khiến bia và khăn ướt không bao giờ được đưa vào phương án dù là món hàng bắt buộc. Hóa đơn thường lặng lẽ thiếu bia/khăn; ở Paris Nhơn, hóa đơn lớn (ví dụ 7.457.000đ) mất luôn sức chứa của 3 mã bia và báo "Không tìm được tổ hợp hàng đạt tối thiểu … Kho có sức chứa lý thuyết khoảng … nhưng không ghép được tổ hợp hợp lệ" dù kho đủ hàng.
- Thêm test hồi quy: `constraintGroupMax = null` phải ra ≥3 bia + ≥2 khăn, trần nhóm dương vẫn có hiệu lực, và ca thật Nhơn 7.457.000đ ghép được trong 16 dòng.
- Đối soát sau khi tạo phiếu mới qua API: dò danh sách Bán hàng lần lượt theo ngày sao kê rồi ngày máy chủ (Linh Đàm giữ thứ tự ngược lại) thay vì khóa cứng một ngày. Paris Nhơn chạy cùng phần mềm với Linh Đàm nên phiếu API mới có thể nằm ở ngày máy chủ; lần tạo đầu tiên (01000000260, sao kê 01/07/2026) API trả `code = 1` nhưng bước đọc lại báo không thấy phiếu và giao diện trông như chưa tạo. Khớp ngày cho phiếu API mới chấp nhận ngày danh sách hoặc ngày nghiệp vụ đã lưu trong chi tiết phiếu.
- Thông báo không tìm thấy phiếu sau khi tạo qua API nay nêu rõ website đã cấp số và ID, các ngày đã dò, và cảnh báo không chạy lại API để tránh tạo phiếu trùng.
- Thêm ô **Tự tải file log sau mỗi lần tạo phiếu** trên thanh Batch API để tắt việc tải file JSON (và hộp thoại hỏi nơi lưu của Chrome); log vẫn được lưu vào storage và xuất lại được bằng nút Xuất log API gần nhất.
- Lỗi tải file log (hủy hộp thoại lưu, Chrome chặn) không còn làm hỏng luồng tạo phiếu: trước đây API đã tạo phiếu xong nhưng lỗi tải log làm giao dịch không được ghi số phiếu, trông như chưa tạo.
- Content script mồ côi sau khi Reload extension (lỗi `Cannot read properties of undefined (reading 'local')`) nay được nhận diện và hiển thị hướng dẫn F5; luồng tạo phiếu bị chặn trước khi gửi API để không sinh phiếu mà extension không ghi nhận được.

## 1.27.0 (2026-09-15)

- Riêng Paris Nhơn: nhập danh sách số tiền CK/TM từ `inputInvoice.xlsx` theo kỳ tháng/năm.
- Khi tạo/lưu phiếu, gửi `PHUONGTHUCTT` đúng `CK` hoặc `TM`; các cơ sở khác giữ `TM/CK`.
- Chuẩn hóa sai số thập phân do Excel, để 434/435 dòng vào luồng ngay và chỉ giữ dòng `241.950,5đ` ở trạng thái cần xác nhận.
- Đưa nút nhập danh sách số tiền ra thẳng màn Giao dịch ngân hàng để tránh chọn nhầm nút nhập sao kê.
- Khi đã có sao kê đang chờ xử lý, hỏi xác nhận và thay thế phần đang chờ bằng danh sách số tiền; các phiếu đã lưu/đối soát vẫn giữ.
- Phiếu nhỏ dưới 500.000đ ưu tiên mã bia có giá thấp nhất để còn được Tiền giờ (không bị chọn nhầm bia đắt làm Tiền giờ = 0).
- Batch Review không gán lại phiếu khi website timeout/lỗi đọc; phiếu ứng viên đã thử được chặn trong batch để tránh nhiều giao dịch cùng báo một số phiếu.
- Paris Nhơn: phiếu mới từ 5.000.000đ áp sàn Tiền giờ 1.500.000đ để giảm số dòng hàng giá thấp; các cơ sở và phiếu đã có giữ nguyên sàn cũ.
- Rule hàng luân phiên không còn làm hỏng cả phương án khi vướng giới hạn tồn kho/số lượng mỗi hóa đơn; solver sẽ thử lại không có rule luân phiên nhưng vẫn giữ rule bắt buộc.

## 1.26.0 (2026-09-11)

- Đặt `Giá bán kho` và `Giá bán web` cạnh nhau trong sheet `Ánh xạ` để đối chiếu nhanh.

## 1.25.2 (2026-09-11)

- Sửa thứ tự `calcPr` trong `workbook.xml` theo schema Excel để file ánh xạ mở trực tiếp mà không yêu cầu phục hồi nội dung.

## 1.25.1 (2026-09-11)

- Hiển thị lỗi xuất ánh xạ ngay trên giao diện và khôi phục nút sau khi tải thất bại.

## 1.25.0 (2026-09-11)

### Xuất/nhập ánh xạ bằng Excel cho kế toán

- Xuất hồ sơ ánh xạ hiện tại thành workbook hai sheet: `Ánh xạ` và `Mặt hàng web`.
- Cột `Mã web (chỉnh)` có thể sửa; tên, đơn vị và giá web được tra bằng công thức VLOOKUP.
- Nhập lại workbook Excel (đồng thời vẫn hỗ trợ JSON cũ), chỉ cập nhật ánh xạ theo mã kho và giữ nguyên số tồn.

## 1.22.0 (2026-08-24)

### Phát hành hóa đơn tuần tự, số hóa đơn liên tục hai cơ sở

- Số hóa đơn điện tử do máy chủ cấp theo đúng thứ tự lời gọi phát hành, nên cả lô nay chạy **một luồng**. Bỏ chạy song song 2 luồng và bỏ việc tách lô làm hai giai đoạn theo nguồn mặt hàng — cả hai đều làm thứ tự cấp số trở nên tùy tiện. **Lô toàn phiếu đã có mặt hàng trong sổ đối soát sẽ chậm khoảng gấp đôi**; đây là cái giá bắt buộc để số hóa đơn liên tục.
- Lô phát hành sắp theo ngày rồi tới **giờ giao dịch trong sao kê**, không theo số phiếu. Phiếu tạo mới luôn nhận số cuối dải nên số phiếu lộn xộn, nhưng giờ giao dịch thì không.
- Hộp thoại xác nhận liệt kê đúng thứ tự sẽ phát hành, để kiểm trước khi chạy.
- Thêm ô chọn **cơ sở phát hành trước** ở bước 5 (mặc định Linh Đàm). Thiết lập này dùng chung cho cả hai tab.
- Import sao kê nay trích thêm bảng tóm tắt để tab cơ sở kia biết **trước** ngày đó bên này có bao nhiêu giao dịch, thay vì chỉ biết sau khi đã phát hành xong.
- Cảnh báo chéo cơ sở trước khi phát hành: cơ sở kia còn việc chưa chạy, đang chạy dở, đã vượt sang ngày sau, hoặc chưa import sao kê. Tất cả là chặn mềm — nêu rõ rồi để người dùng quyết định.
- Lô phát hành nay **khóa theo đúng một ngày**: ô Đến ngày tự bám theo Ngày phát hành và chuyển sang chỉ đọc, thêm nút ‹ Ngày trước / Ngày sau › để đi từng ngày. Lô trộn nhiều ngày bị chặn cứng thay vì chỉ cảnh báo — nó sẽ chiếm luôn phần số mà cơ sở kia cần cho ngày sớm hơn, và phát hành rồi thì không hoàn tác được.
- Sau mỗi lô: kiểm tra số hóa đơn trong ngày có liên tục không, và nhắc chuyển sang cơ sở còn lại kèm số giao dịch cụ thể.

### Món hàng bắt buộc

- Mỗi hóa đơn phải có ít nhất **3 bia** và **2 khăn ướt**, tính theo tổng của cả nhóm chứ không theo từng mã — 2 Tiger + 1 Hà Nội là hợp lệ.
- Thiếu tồn thì báo rõ nhóm nào thiếu và còn bao nhiêu. Kiểm tra chạy trên tồn đã trừ đặt chỗ của các giao dịch trước trong cùng lô, nên không sinh phương án âm kho khi tồn cạn dần giữa lô.
- Hóa đơn dưới 500.000đ **giữ nguyên** luật riêng đúng 2 chai bia.

### Phát hiện mất phiên đăng nhập

- Hai cơ sở dùng chung một domain nên cookie phiên ghi đè nhau: **đăng nhập cơ sở này sẽ đá cơ sở kia ra màn hình login**. Quy trình thực tế là đăng nhập luân phiên, không phải mở hai tab song song. Điều này không ảnh hưởng điều phối vì cờ thứ tự, sao kê đối chiếu và chốt tiến độ đều lưu ở `chrome.storage.local`, không phụ thuộc phiên đăng nhập.
- Mất phiên thường trả HTTP 200 kèm HTML trang login chứ không phải 401/403. Trước đây `JSON.parse` thất bại lặng lẽ và lô phát hành **chạy tiếp như không có gì xảy ra**. Nay cả luồng phát hành lẫn luồng lưu phiếu đều nhận diện và dừng hẳn, báo rõ cần đăng nhập lại.
- Chốt còn kẹt ở trạng thái "đang chạy" nay được hiểu đúng là **lô trước bị đứt giữa chừng** (đóng tab, mất mạng, hết phiên) và cảnh báo rằng một phần hóa đơn có thể đã được cấp số mà chưa vào sổ.

### Khác

- Batch Review sắp giao dịch theo ngày rồi giờ giao dịch trước khi cắt theo giới hạn, nên lô N giao dịch đầu là N giao dịch sớm nhất chứ không phải N dòng đầu trong file.

## 1.21.0 (2026-08-16)

- Thêm kiểm tra sẵn sàng chốt kỳ với 6 điều kiện: danh mục web, tồn kho vật lý, ánh xạ, sao kê trong kỳ, giao dịch tồn đọng và hóa đơn điện tử chưa phát hành.
- Hiển thị từng điều kiện đạt/chưa đạt và cho phép đi thẳng tới màn hình xử lý tương ứng.
- Thêm xuất Excel đối soát theo kỳ gồm 3 sheet: tổng quan, giao dịch và tồn đọng; dữ liệu được tạo trực tiếp trong extension, không cần backend.
- Báo cáo vẫn có thể xuất khi kỳ chưa sẵn sàng để kế toán kiểm tra ngoại lệ, nhưng trạng thái chưa đủ điều kiện được thể hiện rõ trên giao diện.

## 1.20.0 (2026-08-16)

- Bổ sung dashboard kế toán ngay tại màn hình quy trình, có bộ lọc từ ngày/đến ngày và hiển thị rõ cơ sở đang thao tác.
- Thêm KPI tổng tiền sao kê, đã đối soát, chưa hoàn tất, số việc cần xử lý và tỷ lệ hóa đơn điện tử đã phát hành.
- Thêm hàng đợi ngoại lệ tổng hợp lỗi dữ liệu, tồn kho, ánh xạ và giao dịch; mỗi dòng có nút đưa kế toán thẳng tới màn hình xử lý phù hợp.
- Bộ lọc kỳ chỉ thay đổi phần tổng quan, không sửa trạng thái sao kê, tồn kho hay kết quả Batch Review hiện có.

## 1.19.41 (2026-08-15)

- Sửa đối chiếu ngày riêng cho Kim Giang: dùng `Ngày giao dịch/Transaction date` làm ngày hóa đơn, không còn dùng nhầm `Ngày KH thực hiện/Requesting date`.
- Giữ nguyên quy tắc sao kê Linh Đàm dùng `Ngày hiệu lực` làm ngày chứng từ; bổ sung test chống ảnh hưởng chéo giữa hai cơ sở.

## 1.19.40 (2026-08-14)

- Cho phép phát hành phiếu khớp ngày và mã giao dịch nhưng lệch tối đa 1 đồng so với sao kê do làm tròn; UI hiển thị rõ phần chênh lệch.
- Vẫn khóa phát hành nếu sai ngày hoặc lệch tổng tiền từ 2 đồng trở lên.

## 1.19.39 (2026-08-14)

- Danh sách phát hành hiển thị giao dịch sao kê liên kết của từng phiếu và kiểm tra đồng thời mã phiếu, ngày giao dịch, tổng tiền.
- Phiếu sai ngày hoặc sai tổng tiền được tô cảnh báo, không thể chọn và bị chặn lần nữa ngay trước khi gọi API phát hành.

## 1.18.1 (2026-08-11)

- Bổ sung “Đồng bộ từ website” tại bước chuẩn bị dữ liệu; gọi trực tiếp `DataGrid/GetGridData` bằng phiên đăng nhập hiện tại để lấy tối đa 1.000 mặt hàng mới nhất của đúng cơ sở.
- Chỉ lưu dữ liệu danh mục cần thiết, không lưu cookie/token; dữ liệu cũ được giữ nguyên nếu API lỗi hoặc trả về danh mục rỗng.
- Sau khi đồng bộ, tự cập nhật tên/đơn vị/giá trong ánh xạ và đưa mã không còn trên web về trạng thái cần kiểm tra.
- Bước 1 chỉ báo hoàn tất khi đã có tồn kho và danh mục đã được đồng bộ từ website.

## 1.18.0 (2026-08-11)

- Thiết kế lại trang đầu theo quy trình 4 bước dành cho kế toán: dữ liệu cơ sở, đối chiếu mặt hàng, sao kê ngân hàng và lập/duyệt hóa đơn.
- Mỗi bước có mô tả bằng ngôn ngữ nghiệp vụ, trạng thái lấy từ dữ liệu thực và một nút hành động chính; thanh tiến độ cho biết bước nào đã sẵn sàng.
- Tách “Điều chỉnh một phiếu” khỏi xử lý hàng loạt; các màn hình chi tiết có tiêu đề, hướng dẫn ngắn và nút “Về quy trình” nhất quán.
- Gom nhập nhanh file và thuật ngữ kỹ thuật vào khu vực mở rộng để màn hình chính gọn hơn cho người dùng không chuyên kỹ thuật.
- Giữ nguyên ID nút và luồng API hiện có để thay đổi giao diện không làm ảnh hưởng quy trình lưu/đối soát.

## 1.17.1 (2026-08-11)

- Thiết kế lại màn hình ánh xạ thành trang quản lý gọn: tiêu đề, KPI tổng/cần xử lý/đã xác nhận/bỏ qua, tìm kiếm và bộ lọc trạng thái.
- Mỗi dòng chỉ hiển thị thông tin kho, ô tìm sản phẩm, trạng thái tiếng Việt và các hành động chính; bỏ trạng thái kỹ thuật `review/0.0` khỏi giao diện.
- Form tạo mặt hàng mới chỉ mở tại dòng được chọn, có nhãn rõ cho mã, tên, đơn vị, giá và nhóm hàng.
- Thêm chọn tất cả dòng đang hiển thị, đếm số dòng đã chọn và thanh tạo API hàng loạt cố định; hỗ trợ mở lại ánh xạ đã xác nhận hoặc đã bỏ qua.

## 1.17.0 (2026-08-11)

- Thêm luồng tạo mặt hàng web trực tiếp bằng API chính thức `AddEdit/DoSave`; không còn phải mở và nhập form mặt hàng trên giao diện website.
- Mẫu tạo mặt hàng được đọc động theo cơ sở đang mở để lấy đúng ID đơn vị tính, nhóm hàng và loại hàng của từng cơ sở.
- Màn hình ánh xạ kho → web cho phép sửa mã, tên, đơn vị, giá và nhóm trước khi tạo; hỗ trợ tạo một dòng hoặc chọn nhiều dòng để chạy tuần tự.
- Chỉ ghi mặt hàng vào danh mục cục bộ và xác nhận ánh xạ sau khi API trả về ID hợp lệ. Lô dừng ngay ở dòng lỗi nên không đánh dấu nhầm các dòng chưa tạo.
- Chặn mã web trùng và tên trùng với danh mục hiện tại trước khi gửi API; thời gian chờ riêng cho thao tác tạo là 30 giây.
- Thêm kiểm thử bảo đảm API chạy trước bước ghi ánh xạ và batch tạo mặt hàng không chạy song song.

## 1.16.1 (2026-08-11)

- Chuyển extension sang hồ sơ nhiều cơ sở: tồn kho, metadata/backup kho và API template được tách theo `pariskimgiang` / `parislinhdam`; xuất hàng ở một cơ sở không còn làm giảm tồn của cơ sở kia.
- Giữ nguyên khóa cũ của Kim Giang để không mất dữ liệu đang vận hành; Linh Đàm dùng các khóa có hậu tố `__parislinhdam` và cần nhập file kho riêng.
- File trạng thái tồn mới mang `tenant`; extension chặn file thuộc cơ sở khác. File định dạng cũ thiếu cơ sở chỉ được phép khôi phục có cảnh báo tại Kim Giang.
- Màn hình hiển thị rõ cơ sở hiện tại và tên file xuất tồn/xuất kho có tên cơ sở.
- Bổ sung xuất/nhập hồ sơ ánh xạ JSON. Khi nhập lại, extension chỉ cập nhật quan hệ mã kho → mã web, không ghi đè số tồn vừa nhập.
- Cập nhật kiểm thử đa cơ sở; xác nhận Kim Giang và Linh Đàm có thể có cùng `stockCode` nhưng số tồn độc lập.

## 1.16.0 (2026-08-07)

- **Xuất kho đã phát hành nay ra file Excel** thay cho JSON, để kế toán mở và quản lý trực tiếp. Cột: `Mã phiếu`, `Ngày`, `Số hóa đơn`, `Mã hàng`, `Tên hàng`, `Tên hàng kho`, `Số lượng`, `Giá tiền`, `Thành tiền` — mỗi dòng hàng một dòng Excel.
- Thêm `xlsx-writer.js`: ghi `.xlsx` thật (không phải CSV đổi đuôi) mà **không cần thư viện ngoài** — CSP của extension chặn CDN. XLSX là ZIP chứa XML; dùng phương thức `stored` nên chỉ cần CRC32, không cần bộ nén. `Số lượng`/`Giá tiền`/`Thành tiền` ghi dưới dạng ô số nên Excel tự tính tổng; dòng tiêu đề được cố định và bật sẵn AutoFilter.
- Cột `Tên hàng kho` lấy từ ánh xạ kho ↔ web (chỉ ánh xạ `confirmed`). Mã web nhận tồn từ **nhiều dòng kho** (ví dụ `1000010` gom từ `DECUOI70`, `DECUOI60`, `HATDECUOIRM`) được ghép tất cả tên kho vào một ô và **giữ nguyên số lượng** — extension không biết hóa đơn thực tế trừ từ dòng kho nào, nên không chia nhỏ số lượng theo phỏng đoán; tổng luôn khớp hóa đơn và kế toán tự quyết định trừ ở đâu.
- Hóa đơn chưa có mặt hàng không sinh dòng nào trong file, nhưng được đếm và cảnh báo sau khi xuất. Nếu *tất cả* hóa đơn đều thiếu mặt hàng thì báo lỗi thay vì tạo file rỗng.
- Thêm kênh `invoiceTarget.downloadBinary` cho file nhị phân (thông điệp tới background chỉ chuyển được JSON thuần nên nội dung đi qua base64). Kênh này có allowlist tên file riêng và kiểm tra chuỗi base64 hợp lệ; tên file lạ hay dữ liệu sai định dạng đều bị chặn.
- Bỏ `XuatKho_PhatHanh_*.json` khỏi allowlist của kênh JSON vì luồng đó không còn dùng.
- Thêm `test-xlsx-writer.js` (gồm kiểm tra CRC32 theo vector chuẩn, ZIP hợp lệ, XML cân bằng thẻ và escape đúng).

## 1.15.3 (2026-08-07)

- **Sửa lỗi nút "Xuất kho đã phát hành" luôn báo `Không xuất được file hạch toán: Tên file trạng thái tồn không hợp lệ.`** dù sổ phát hành đã có dữ liệu. Lỗi có từ 1.15.0, tức là nút này chưa từng chạy được.
- Nguyên nhân: `background.js` chỉ cho tải xuống tên file khớp `TonKho_ParisKimGiang_*.json` hoặc `invoice-api-trace-*.json`. Khi thêm tính năng xuất file hạch toán ở 1.15.0, `content.js` gửi tên `XuatKho_PhatHanh_<ngày>_<giờ>.json` nhưng allowlist không được mở rộng theo, nên service worker chặn mọi lần xuất. Bản thân sổ phát hành và payload đều đúng — chỉ bước tải xuống bị chặn.
- Thêm `XuatKho_PhatHanh_[0-9_-]+\.json` vào allowlist. Allowlist vẫn giữ nguyên vai trò chặn path traversal (`../bad.json`) và tên file tùy ý.
- Thông báo lỗi nêu luôn tên file bị từ chối, thay vì chỉ nói "tên file trạng thái tồn" — vốn gây hiểu nhầm vì kênh tải xuống này nay dùng chung cho ba loại file.
- `test-background.js` thêm ca kiểm tra tên file `XuatKho_PhatHanh_*` qua được allowlist.

## 1.15.2 (2026-08-06)

- `AddEdit/DoSave` nay gui kem `PHUONGTHUCTT: "TM/CK"` thay cho `"TM"`: phiếu do extension lập đều bắt nguồn từ giao dịch chuyển khoản trong sao kê.
- Áp dụng cho **cả hai** luồng lưu: sửa phiếu có sẵn (`buildCurrentSavePayload` trước đây không đặt trường này nên giữ nguyên giá trị cũ của form) và tạo phiếu mới (`createAndPayFreshInvoiceViaApi`).
- `validateSavePayload` chặn payload sai phương thức, nhưng chỉ với payload do extension dựng (`expectsPaymentMethod`). Payload bắt được từ nút **Lưu** của website là do website tạo và vẫn mang `"TM"`, không bị chặn nhầm.
- Thêm `test-payment-method.js`.

## 1.15.1 (2026-08-06)

- **Sửa lỗi treo ở "đang phát hành"**: hóa đơn phát hành thành công trên website nhưng extension không nhận được phản hồi và không cập nhật gì. Bridge chạy ở MAIN world còn content script ở isolated world, nên `detail` của `CustomEvent` bị structured-clone khi đi qua ranh giới; giá trị không clone được (dòng lưới Kendo còn giữ hàm) làm `dispatchEvent` **ném lỗi ngay trong khối `try`** của handler — không phản hồi nào được gửi và `await request(...)` treo cho tới khi hết thời gian chờ.
- Thêm `respond()`: làm sạch payload bằng `plainClone()` trước khi gửi, và có nhánh dự phòng gửi lỗi mô tả được nếu vẫn không gửi được. Không request nào còn có thể không có phản hồi.
- Mất phản hồi **không** còn bị coi là chưa phát hành: sau mỗi hóa đơn lỗi, extension đọc lại danh sách để lấy trạng thái thật; nếu server đã phát hành thì ghi sổ và báo rõ, tránh người dùng bấm phát hành lại một hóa đơn đã có.
- Thông báo hết thời gian chờ nêu rõ thao tác và số giây thay vì `Trang không phản hồi.`
- Thêm nút **Đồng bộ hóa đơn đã phát hành**: ghi bổ sung vào sổ hạch toán các hóa đơn đã phát hành trên website nhưng chưa có trong sổ (phát hành tay, hoặc do lần phát hành trước mất phản hồi).
- Danh sách phát hành **chỉ hiện hóa đơn thuộc danh sách giao dịch** (đã gắn với một dòng sao kê qua `invoiceNo`, `pendingPlan` hoặc `batchApprovedPlan`). Phiếu ngoài giao dịch thuộc nghiệp vụ khác nên bị ẩn mặc định; muốn xem phải tích ô `Hiện N phiếu ngoài giao dịch`, và khi chọn chúng thì hộp thoại xác nhận nêu rõ số phiếu ngoài giao dịch trước khi phát hành.
- Chỉ chọn được các dòng đang hiện, tránh phát hành nhầm dòng đã bị ẩn khỏi bộ lọc.

## 1.15.0 (2026-08-06)

- Thêm sub-tab **Phát hành hóa đơn** ngay trong tab **Giao dịch ngân hàng**: tải danh sách hóa đơn điện tử theo khoảng ngày, tích chọn nhiều dòng và phát hành hàng loạt sau **một** hộp thoại xác nhận cho cả lô, thay cho thao tác bấm `PHÁT HÀNH` + 2 hộp thoại cho từng dòng trên website.
- Mặt hàng để hạch toán lấy từ **sổ đối soát sau lưu** — số liệu này đã được kiểm tra lại với phiếu trên website trước khi trừ tồn, nên không cần mở lại phiếu, không phụ thuộc màn hình đang mở và chạy tức thì. Chỉ hóa đơn không có trong sổ mới phải mở lại phiếu để đọc, và khi đó mới cần màn hình danh sách Bán hàng.
- Bảng phát hành hiển thị sẵn mặt hàng lấy từ sổ đối soát trước khi phát hành, kèm nhãn nguồn (`sổ đối soát` / `đã ghi sổ`), để thấy ngay hóa đơn nào sẽ thiếu số liệu hạch toán.
- Thiếu màn hình danh sách Bán hàng không còn chặn cả lô: chỉ cảnh báo trong hộp thoại xác nhận số hóa đơn sẽ không có mặt hàng.
- Bridge gọi thẳng API website theo đúng thứ tự: `HoaDonDienTu/LayDuLieu` → `kiemTraThongTin?is_ajax=1` → `phatHanhHoaDon?is_ajax=1`.
- Hai API phát hành trả HTTP 200 cả khi nghiệp vụ từ chối, nên kết quả được đọc theo `code`/`message` trong body giống `DoSave`; body thành công nhưng thiếu Số HĐ sẽ được xác nhận lại bằng cách đọc lại danh sách thay vì báo thành công mơ hồ.
- `kiemTraThongTin` cùng dạng `code/message`, `Tag` là HTML xem trước thông tin người mua. Với khách lẻ toàn bộ trường để trống nhưng vẫn `code: 1` — đây là hợp lệ và không được chặn, nếu không mọi hóa đơn khách lẻ đều không phát hành được. Bước kiểm tra chỉ chặn khi `code != 1`.
- `phatHanhHoaDon` trả `Tag` là **chuỗi HTML** để đổ thẳng vào hộp thoại của website (`"Số HĐ: 2036</br>Mã CQT: …</br>Ký hiệu: …</br>Mã tra cứu: …</br>Link tra cứu: …"`), không phải object. `parseIssuedInvoiceTagHtml()` tách theo nhãn (bỏ dấu) nên không phụ thuộc thứ tự dòng, và lấy lại nguyên URL vì nhãn `Link tra cứu:` bị cắt ở dấu `:` đầu tiên. Vẫn chấp nhận `Tag` dạng object phòng khi website đổi kiểu trả về.
- Mặt hàng + số lượng của hóa đơn được đọc **trước** khi phát hành: nếu bước đọc hỏng thì chưa có gì thay đổi trên hệ thống, và số liệu hạch toán không phụ thuộc vào phiếu đã bị khóa sau phát hành.
- Khi phải đọc lại từ phiếu, dùng đúng đường extension đã mở phiếu từ trước: nhấp đúp dòng trên danh sách Bán hàng → `scan()` đọc lưới Kendo đang mở → đóng form. Không fetch HTML trang `AddEdit` vì trang đó được dựng bằng script client nên HTML thô không chứa sẵn dòng hàng.
- Tách `openInvoiceRowForReading()` khỏi `openInvoiceCandidate()`: luồng chỉ-đọc dùng lại phần thao tác mở phiếu mà **không** nới lỏng ràng buộc "Chưa xuất hóa đơn" vốn để bảo vệ luồng lập/sửa phương án.
- Phiếu mở ra để đọc luôn được đóng lại trong `finally`, kể cả khi đọc lỗi; nếu website mở nhầm số phiếu khác thì dừng ngay thay vì ghi nhầm số liệu.
- `hasInvoiceList` chỉ được gọi khi thực sự có hóa đơn thiếu trong sổ đối soát, nên luồng thường gặp (hóa đơn do extension lập) không cần màn hình nào khác.
- Mỗi hóa đơn phát hành xong được ghi sổ ngay (`invoiceTargetIssuedInvoices`), nên lô dừng giữa chừng vẫn giữ đủ số liệu phần đã chạy. Sổ khóa theo `invoiceId`: phát hành lại hoặc chạy lại lô chỉ ghi đè, không cộng dồn số lượng.
- Hóa đơn đã có Số HĐ hoặc đã hủy không thể được chọn để phát hành lại.
- Tab Kho có nút **Xuất kho đã phát hành**: xuất JSON gồm tổng số lượng theo mã hàng và chi tiết từng hóa đơn để kế toán hạch toán. File không chứa sao kê, ánh xạ hay danh mục web.
- Nút **Thử đọc mặt hàng** cho phép kiểm tra riêng bước đọc chi tiết trước khi phát hành thật; hóa đơn chưa đọc được mặt hàng được cảnh báo cả khi phát hành lẫn khi xuất file.
- Gom logic chuyển màn hình của panel vào `applyPanelScreen()`; trước đó mỗi màn hình tự ẩn/hiện các màn hình còn lại nên thêm màn hình mới phải sửa ở 4 chỗ.
- Thêm `issued-invoices.js` + `test-issued-invoices.js`.

## 1.14.6 (2026-08-03)

- Sửa lỗi sau khi `Lưu API ... phiếu đã Accept` tạo phiếu mới xong thì không tự mở danh sách hóa đơn để đối soát: phiếu mới được tạo từ **sơ đồ phòng**, còn bước đọc lại từ server cần grid **danh sách Bán hàng** — hai màn hình khác nhau và không có bước chuyển giữa chúng.
- Thêm `ensureInvoiceListScreen()` tự điều hướng về màn hình danh sách rồi chờ grid dựng xong trước khi đối soát; nếu không tới được thì báo rõ thay vì ném `Hãy mở màn hình danh sách Bán hàng trước.`
- Áp dụng cho cả luồng đối soát tự động sau lưu API lẫn nút `Đối soát sau lưu` thủ công.
- Bridge nhận thêm action `hasInvoiceList` để content script kiểm tra trạng thái màn hình hiện tại.

## 1.14.5 (2026-08-03)

- Sửa lỗi Batch API dừng với `Không tìm thấy phiếu chưa xuất <số phiếu>` dù phiếu vẫn nằm trên grid: danh sách số phiếu "đã dùng" chỉ loại theo `transaction.id`, trong khi số phiếu Batch Review vừa gán mới chỉ nằm ở `plan.invoiceNo` (chỉ được ghi vào `transaction.invoiceNo` SAU khi lưu thành công), nên dòng đang xử lý tự chặn chính nó.
- Gom số phiếu của các dòng khác từ đủ ba nguồn `invoiceNo`, `pendingPlan.invoiceNo` và `batchApprovedPlan.invoiceNo`, đồng thời luôn loại số phiếu của chính dòng đang xử lý.
- Áp dụng chung cho cả ba luồng mở lại phiếu: đối soát sau lưu, `Mở và áp dụng phương án`, và `Lưu API & đối soát`.
- Sàn Tiền giờ danh nghĩa 30/50 phút trong `newInvoicePlanValidationError` cũng bị kẹp theo trần 35%; trước đó phương án vừa tính hợp lệ lại bị chính hàm kiểm tra loại và giao dịch quay về `Lỗi`.

## 1.14.4 (2026-08-03)

- Sửa lỗi hóa đơn từ 500.000đ đến ~942.000đ và sao kê từ 1.000.001đ đến ~1.571.000đ luôn báo `Phương án không có Tiền giờ`: sàn phút (30/50 phút) và trần 35% tổng trước VAT mâu thuẫn nhau trong các dải này nên không còn giá trị Tiền giờ nào hợp lệ.
- Nền Tiền giờ nay bị kẹp theo trần 35% thay vì cố định theo mốc phút; trần cơ cấu được giữ nguyên vì đây là ràng buộc hình dạng hóa đơn.
- Áp cùng phép kẹp cho **phiếu đã có sẵn**: nền lấy từ Tiền giờ trên form (ví dụ 600.000đ cho hóa đơn 560.000đ, 900.000đ cho hóa đơn 1.180.000đ) thuộc hóa đơn cũ nên thường vượt trần ngay từ đầu, khiến mọi tổ hợp đều vỡ cả hai điều kiện của cổng kiểm tra cuối.
- Sàn mềm `maxGoodsAmount` (tỷ lệ tự nhiên 0,8) phải nhường trần 35% khi hai mốc loại trừ nhau, tránh làm rỗng cửa sổ tiền hàng.
- Sàn phút của khoảng giờ vào/ra đi theo nền đã kẹp, không còn loại oan phiếu chỉ cần ~23 phút.
- Sửa lỗi solver: tổ hợp có tiền hàng vượt tổng trước VAT (Tiền giờ âm) từng được chấm `hourRangeViolation = 0` và thắng mọi phương án hợp lệ.
- Phương án trả thêm `hourBaseClamped` và `hourMinuteBase` để đối soát biết vì sao số phút thấp hơn mốc danh nghĩa.
- Không đổi `CALCULATION_VERSION`; các phương án đã Accept không bị hủy.

## 1.14.3 (2026-08-03)

- Giao dịch có tổng nhỏ hơn 500.000đ dùng quy tắc riêng: đúng 2 chai bia, phần trước VAT còn lại là Tiền giờ.
- Ưu tiên mã bia đã cấu hình trong rule; nếu chưa có thì tự chọn mã bia đủ tồn và đủ giới hạn 2 chai/hóa đơn.
- Không áp sàn 30 phút hoặc tỷ lệ Tiền giờ/Tiền hàng thông thường cho nhánh hóa đơn nhỏ; mốc đúng 500.000đ vẫn dùng công thức chung.
- Không chọn nhầm phụ kiện có chữ bia như `BÌNH RÓT BIA`.

## 1.14.1 (2026-08-02)

- Nâng giới hạn bù Tiền giờ thông thường từ 10% lên 20% so với Tiền giờ nền.
- Khi phần bù vượt 20%, vẫn chấp nhận phương án nếu Tiền giờ cuối không vượt 35% tổng trước VAT.
- Đồng bộ rule mới vào solver Batch Review, kiểm tra cuối và màn hình duyệt một phiếu; các phương án theo công thức cũ phải được tính lại.

## 1.14.0 (2026-08-02)

- Nút lưu Batch API xử lý tuần tự cả phiếu hiện có và phiếu cần tạo mới.
- Phiếu mới chạy trong một tab worker do background mở, không phụ thuộc popup của trang.
- Tab Batch Review chính chờ giao dịch chuyển `Đã xử lý` rồi mới chạy phiếu kế tiếp, bảo toàn thứ tự reservation tồn kho.
- Tab worker tự đóng sau khi lưu, đọc lại hóa đơn, đối soát và cập nhật kho thành công.
- Nếu worker lỗi hoặc quá 90 giây, batch dừng và giữ tab lỗi để người dùng kiểm tra; các phiếu sau chưa được gửi.

## 1.13.1 (2026-08-02)

- Sau khi API hai bước lưu thành công, tự đóng form, mở lại đúng số phiếu từ danh sách và đối soát.
- Chỉ khi tổng tiền, giờ, VAT và chi tiết hàng khớp mới chuyển giao dịch sang `Đã xử lý` và trừ tồn kho extension.
- Nếu hậu kiểm thất bại, giữ `Chờ lưu/đối soát`, không trừ kho và cảnh báo không chạy lại API.
- Bổ sung nút `Đối soát sau lưu & cập nhật kho` cho cả phiếu mới đã lưu ở phiên bản trước.

## 1.13.0 (2026-08-02)

- Tích hợp flow API đã trace: `DoSave mode=0` tạo phiên, sau đó `DoSave mode=2` thanh toán và đóng bill.
- Truyền tiếp chính xác `Tag.ID`, `Tag.NAME`, `Tag.LASTSAVEID` và ánh xạ ID từng dòng hàng từ phản hồi bước 1 sang bước 2.
- Đọc danh mục hàng qua API website và chặn khi thiếu ID/đơn vị/giá hoặc tổng chi tiết không khớp phương án.
- Tiền mặt, khách đưa và tiền thanh toán bằng tổng cộng; trả lại bằng 0; không giảm giá; không phát hành HĐĐT.
- Ưu tiên `window.formData` ID rỗng của form mới hơn GUID cũ còn trong script trang cha.
- Chỉ trừ tồn kho và đánh dấu sao kê sau khi đọc lại hóa đơn từ server khớp hoàn toàn.

## 1.10.9 (2026-08-02)

- Sửa công thức VAT theo website: tổng sao kê là giá đã gồm VAT; tổng trước VAT được suy ngược từ `sao kê / 1,1`, VAT bằng `round((tiền hàng + tiền giờ) × 10%)`.
- Solver chỉ lập phương án khi `tiền hàng + tiền giờ + VAT` khớp tuyệt đối sao kê; tổng không thể biểu diễn do làm tròn được chặn và đưa ra mức gần nhất.
- Vô hiệu hóa toàn bộ phương án đã Accept theo công thức VAT cũ để bắt buộc tính lại.

## 1.10.8 (2026-08-02)

- Sau khi website tính giờ/mặt hàng xong, đồng bộ lớp hiển thị Tiền giờ, VAT và Tổng cộng theo đúng payload Batch API mà không phát lại change/blur gây website ghi đè.
- Form phiếu mới vì vậy hiển thị đúng công thức kế toán trước khi gửi: `Tiền hàng + Tiền giờ + VAT 10% sao kê = Tổng sao kê`.

## 1.10.7 (2026-08-02)

- Sửa phiếu mới báo `ID phiếu trong request không hợp lệ`: ưu tiên `window.formData` đang hoạt động và xếp hạng các khối dữ liệu theo RecordID/LASTSAVEID hợp lệ thay vì lấy nhầm formData cũ của trang cha.
- Không tự sinh GUID giả; nếu website thực sự chưa cấp ID phiếu tạm, extension dừng trước API và hiển thị nguồn ứng viên để trace chính xác.

## 1.10.6 (2026-08-02)

- Phiếu mới chọn khoảng phút mà website thực sự biểu diễn được theo bước 0,01 giờ (6.000đ), thay vì suy giờ ra bằng phép chia có thể rơi vào mức tiền không đạt được trên form.
- Batch Review hiển thị rõ giờ vào, giờ ra, tổng phút, tiền sinh từ thời gian và phần bù trực tiếp để người dùng kiểm tra trước khi Accept.
- Tăng phiên bản công thức để các phương án phiếu mới đã Accept bằng cách tính cũ phải được tính lại trước khi lưu.
- Sửa trạng thái treo khi API lưu phiếu mới thất bại: chỉ đánh dấu đã áp dụng sau khi website trả `code = 1`; lỗi vẫn hiện rõ và phiên có thể thử lại.

## 1.10.5 (2026-08-02)

- Khi tạo phiếu cho giao dịch quá khứ, Batch API đồng bộ ngày hóa đơn, giờ vào, giờ ra và ngày thực hiện trên toàn bộ dòng hàng thay vì giữ ngày hiện tại của form mới.
- Chỉ dùng `ID` và `LASTSAVEID` lấy từ đúng phiếu nháp vừa mở; chặn payload cũ hoặc thiếu token trước khi gửi để tránh lỗi "HÓA ĐƠN ĐÃ THAY ĐỔI".
- Giữ `GioClient` là thời điểm gửi request thực tế và bổ sung kiểm tra ngày/giờ bắt buộc trước khi gọi API.

## 1.10.4 (2026-08-02)

- Phiếu mới được phép dùng phần bù tiền giờ nhỏ không quá một bước 6.000đ; giờ vào/ra vẫn phải sinh ra mốc tiền giờ hợp lệ của website.
- Sau khi người dùng Accept và chọn tạo phiếu mới, extension tự áp dụng mặt hàng rồi gọi API `AddEdit/DoSave` với tổng, VAT và tiền mặt chính xác.
- API xác nhận thành công thì form được tự đóng; giao dịch giữ trạng thái chờ đối soát để chỉ ghi tồn kho sau khi tìm lại phiếu đã lưu.

## 1.10.3 (2026-08-02)

- Hủy tự động phương án phiếu mới cũ khi tiền giờ không khớp số tiền suy ra từ giờ vào/ra hoặc không theo bước 6.000đ của website.
- Chặn lại ở ba điểm: khôi phục phiên, dựng Batch Review và trước khi mở tab Bán hàng, nên phương án lỗi không thể tiếp tục áp dụng vào form.
- Tăng phiên bản công thức để toàn bộ phương án phiếu mới đã Accept trước đây được tính lại thay vì tái sử dụng dữ liệu không khả thi.

## 1.10.2 (2026-08-01)

- Batch Review cho phiếu mới chỉ Accept phương án có tiền giờ khớp đúng bước 6.000đ mà website có thể biểu diễn từ giờ vào/ra.
- Ngăn trường hợp phương án khớp trong extension nhưng website làm tròn tiền giờ (ví dụ 596.100đ thành 600.000đ) khiến form mới lệch tổng.
- Giữ mức tối thiểu 50 phút cho sao kê trên 1.000.000đ và 30 phút cho các giao dịch còn lại.

## 1.10.1 (2026-08-01)

- Phiếu mới có tổng sao kê trên 1.000.000đ dùng tiền hát nền tối thiểu 50 phút; tổng từ 1.000.000đ trở xuống giữ mốc 30 phút.
- Tăng phiên bản công thức để các phương án Batch Review cũ chưa lưu được tự động tính lại theo rule mới.

## 1.10.0 (2026-08-01)

- Đổi công thức kế toán: VAT cố định bằng 10% tổng tiền sao kê; tiền hàng và tiền hát chia phần còn lại của tổng.
- Giữ tiền hát nền của phiếu hiện có; phiếu mới dùng mốc tối thiểu 30 phút (300.000đ với đơn giá 600.000đ/giờ).
- Solver ưu tiên tổ hợp hàng khiến tiền hát gần mốc nền nhất và chỉ cho bù tối đa 10% tiền hát nền (không thấp hơn một bước giờ); vượt giới hạn phải tính tổ hợp khác.
- Xóa luồng lỗi làm tròn VAT 1 đồng/đề xuất đổi tổng sao kê vì không còn phù hợp với VAT cố định theo sao kê.
- Batch API kiểm tra thêm chính xác trường VAT trước khi gửi request, bên cạnh tiền hàng, tiền hát, tổng và tiền mặt.

## 1.9.12 (2026-08-01)

- Sửa tra cứu mã hàng trong Kendo catalog: đối chiếu mọi trường mã hợp lệ và dùng `data-uid` của dòng DOM làm fallback khi schema model không đầy đủ.
- Tăng thời gian chờ mỗi trang danh mục từ 1,5 lên 2,5 giây và bổ sung tổng số hàng/trang vào thông báo nếu mã thực sự không tồn tại.
- Xác nhận thực tế mã `1100019` có ở trang 5/8 của danh mục; Batch API vẫn dừng trước request lưu nếu không dựng được đầy đủ mặt hàng.

## 1.9.11 (2026-08-01)

- Sửa lỗi `Cannot set properties of null (setting 'innerHTML')` khi tạo Batch Review trước khi người dùng từng mở màn hình Giao dịch ngân hàng.
- Việc đồng bộ trạng thái giao dịch giờ là no-op an toàn khi bảng sao kê chưa được render; phương án Batch Review không còn bị báo đỏ sau khi đã tính xong.
- Ghi stack trace có nhãn vào console nếu Batch Review gặp lỗi khác để lần kiểm tra sau xác định đúng nguồn ngay lập tức.

## 1.9.10 (2026-08-01)

- Chặn đúng cảnh báo Kendo bất đồng bộ `kendoDropDownList before it is initialized` trong suốt vòng đời trang, thay vì chỉ chặn trong lúc đổi bộ lọc.
- Chuyển cảnh báo kỹ thuật này thành trạng thái nội tuyến trong extension để Batch Review không bị treo; mọi alert nghiệp vụ khác của website vẫn được giữ nguyên.
- Bổ sung kiểm thử nhận diện đúng lỗi Kendo và bảo đảm alert hợp lệ không bị chặn.

## 1.9.0 (2026-07-30)

- Thêm `Lưu API & đối soát` cho từng phương án đã Accept và nút chạy toàn bộ hàng đợi đã Accept.
- Dựng payload từ đúng `RecordID`, 93 trường mapper và Kendo detail của phiếu đang mở; không tái sử dụng ID/cookie từ cURL mẫu.
- Ép `Tiền mặt = Khách đưa = Tiền thanh toán = Tổng cộng`, `Trả lại = 0`, VAT 10% và toàn bộ giảm giá bằng 0 trước khi gửi.
- Gọi endpoint chính thức `AddEdit/DoSave?is_ajax=1` bằng phiên đăng nhập hiện tại của website.
- Chạy tuần tự một phiếu mỗi lần và dừng ngay ở lỗi đầu tiên.
- Sau HTTP thành công, đóng form, mở lại phiếu từ danh sách và đối soát hàng/giờ/VAT/tổng; chỉ khi khớp mới cập nhật sao kê và tồn kho.
- Không tự phát hành hóa đơn điện tử.

## 1.8.0 (2026-07-30)

- Tự bắt request `Lưu HĐ` thật từ `AddEdit_JsClient` sau khi hộp thanh toán xuất hiện; hỗ trợ XHR và Fetch.
- Lưu cục bộ method, endpoint, payload, response và header không nhạy cảm để xây Batch API từ dữ liệu thật.
- Không lưu `Authorization`, `Cookie` hoặc `Proxy-Authorization`; phiên đăng nhập tiếp tục do website quản lý.
- Hiển thị trạng thái sẵn sàng của mẫu API ngay trong Batch Review.
- Chưa chạy hàng loạt và chưa ghi tồn/sao kê cho tới khi payload được kiểm tra và đọc lại server thành công.

## 1.7.4 (2026-07-30)

- Đồng bộ bắt buộc `Tiền mặt = Khách đưa = Tiền thanh toán = Tổng tiền` và `Trả lại = 0` khi website mở hộp Lưu hóa đơn.
- Kiểm tra lại ở capture phase trước nút `Lưu in`/`Lưu thoát`; chặn lệnh lưu nếu các giá trị thanh toán vẫn chưa khớp.
- Bổ sung bridge action `normalizePaymentDialog` để flow batch API và flow UI dùng chung một quy tắc thanh toán.

## 1.7.3 (2026-07-30)

- Khi áp dụng Batch Review, extension không còn nhấn nút tìm kiếm F3 của website làm mở/chồng nhiều bàn phím chọn hàng.
- Mặt hàng được tra cứu tuần tự qua các trang của Kendo DataSource trước khi thay thế nguyên tử toàn bộ dòng hóa đơn.
- Thêm kiểm thử hồi quy để chặn việc gọi lại handler `btnSearch_Click` trong luồng áp dụng phương án.

## 1.7.2 (2026-07-30)

- Sau khi `Đối soát sau lưu` thành công từ Batch Review, extension tự gọi nút `Thoát` của website để trở về màn hình danh sách phiếu.
- Chỉ tự thoát khi giao dịch đã được ghi nhận `Đã xử lý`; nếu đối soát sai dữ liệu, giữ nguyên form hóa đơn để người dùng kiểm tra.
- Nếu website không đóng được form, hiển thị cảnh báo rõ ràng nhưng không hoàn tác kết quả đối soát đã ghi thành công.

## 1.7.1 (2026-07-30)

- Khi tạo Batch Review, trừ trước tồn đang được giữ bởi mọi phương án `Đã Accept` hoặc `Chờ lưu/đối soát`, kể cả giao dịch nằm ngoài khoảng ngày hoặc giới hạn số dòng đang xem.
- Sửa bảng chi tiết phương án: cột `Tồn trước` hiển thị tồn thực tế trước khi cấp cho dòng hiện tại; cột `Giới hạn/HĐ` hiển thị giới hạn cuối cùng sau định mức và rule.
- Ngăn nhiều Batch Review khác nhau cùng phân bổ lại phần tồn đã được một phương án chưa đối soát giữ trước đó.

## 1.7.0 (2026-07-30)

- Thêm màn hình `Quản lý tồn kho` riêng, có tìm kiếm và lọc các mã đang giữ, sắp hết, đã hết hoặc quản lý theo định mức mỗi hóa đơn.
- Hiển thị riêng `Tồn ghi nhận`, `Đang giữ` bởi các phương án Batch chưa đối soát và `Có thể phân bổ` cho hóa đơn tiếp theo.
- Chuyển các nút `Nhập KhoT5.xlsx`, `Nhập trạng thái tồn` và `Xuất trạng thái tồn` vào màn hình quản lý tồn kho.
- Giữ `Nhập data.xlsx` ở thanh công cụ chính vì đây là danh mục mặt hàng web, không phải dữ liệu tồn kho.

## 1.6.7 (2026-07-30)

- Cho phép `Tính toán lại` cả phương án đang `Chờ lưu/đối soát`; nếu đúng phiếu đang mở, extension đóng form chưa lưu trước khi lập phương án mới.
- Giữ reservation tồn kho cho cả phương án đã áp dụng nhưng chưa đối soát.
- Thu gọn cột `Giao dịch` trong Batch Review; diễn giải dài hiển thị một dòng có dấu `…` và xem đầy đủ bằng tooltip.

## 1.6.6 (2026-07-30)

- Thêm nút `Tính toán lại` cho từng phương án đã Accept nhưng chưa áp dụng.
- Khi tính lại, hoàn reservation tồn kho của phương án cũ trước khi chạy solver.
- Đổi seed và tăng điểm phạt các mã vừa bị từ chối để ưu tiên sinh tổ hợp khác; vẫn cho phép dùng lại nếu không có phương án khớp hợp lệ nào khác.

## 1.6.5 (2026-07-30)

- Đóng toàn bộ các hộp chọn/nhập số lượng bị website xếp chồng sau khi áp dụng phương án, thay vì chỉ đóng hộp trên cùng.
- Ưu tiên đóng đúng Kendo dialog sở hữu hộp nhập để không gọi nhầm CodeRunner của một hộp khác.

## 1.6.4 (2026-07-30)

- Tìm mã hàng qua toàn bộ các trang danh mục khi handler tìm kiếm F3 không khả dụng do website đang mở bàn phím số.
- Không còn báo thiếu nhầm mã hợp lệ chỉ vì mã đó nằm ngoài trang đầu danh mục.
- Luôn đóng hộp chọn sản phẩm/số lượng nếu áp dụng phương án lỗi giữa chừng.

## 1.6.3 (2026-07-30)

- Không còn dựa vào `aria-hidden` vì website gắn thuộc tính này cả lên bàn phím số đang hiển thị.
- Đóng bàn phím hiện tại bằng handler `ButtonJs/CodeRunner` của website, dự phòng bằng Kendo widget chính thức.
- Nhận đúng Kendo widget tại `.k-content[data-role="dialog"]` và chỉ đóng dialog có `z-index` cao nhất một lần.

## 1.6.2 (2026-07-30)

- Sửa đóng nhầm bàn phím số cũ do Kendo giữ nhiều dialog đã ẩn trong DOM với cùng kích thước.
- Chỉ nhận dialog đang hoạt động, ưu tiên dialog có `z-index` cao nhất và nút `Hủy bỏ` thực sự hiển thị.
- Bổ sung đóng dự phòng qua cả `kendoDialog` và `kendoWindow`.

## 1.6.1 (2026-07-30)

- Thêm nút `Đối soát sau lưu` ngay tại từng dòng `Chờ lưu/đối soát` trong Batch Review.
- Nút luôn mở lại đúng phiếu từ danh sách website trước khi ghi sổ, tránh đối soát nhầm dữ liệu chỉ đang thay đổi tạm trên form.
- Chỉ khi hàng hóa, tiền giờ, VAT và tổng cộng khớp phương án đã Accept thì sao kê mới thành `Đã xử lý` và tồn kho mới bị trừ.

## 1.6.0 (2026-07-30)

- Nâng rule mặt hàng thành hai loại: `Luân phiên` và `Bắt buộc`.
- Cho phép cấu hình số lượng tối thiểu/tối đa của từng mặt hàng trên một phiếu.
- Batch Review áp dụng đồng thời mọi rule bắt buộc và một rule luân phiên có ưu tiên cao nhất.
- Báo lỗi rõ ràng nếu mặt hàng bắt buộc không đủ tồn, không âm thầm tạo phương án thiếu hàng.
- Rule cũ được tự chuẩn hóa thành `Luân phiên`, số lượng 1–1 nên không mất cấu hình hiện có.
- Có thể cấu hình bia `Bắt buộc`, số lượng 1–4 để tổ hợp hóa đơn thực tế hơn.

## 1.5.3 (2026-07-30)

- Cho phép mở và áp dụng lại phương án với phiếu ở trạng thái `Chờ lưu/đối soát`.
- Khắc phục trường hợp reload làm mất thay đổi tạm trên form nhưng Batch Review không còn nút mở lại.
- Ưu tiên khôi phục phương án đang chờ lưu, dự phòng bằng phương án Batch đã Accept.

## 1.5.2 (2026-07-30)

- Tự nhận diện và đóng hộp chọn số lượng mặt hàng sau khi áp dụng phương án.
- Hỗ trợ cả nút HTML thường và `input` của bàn phím số trên website.
- Chờ hộp nhập xuất hiện trễ hoặc render lại; chỉ đóng đúng hộp có bàn phím số, `Hủy bỏ` và `Chấp nhận`.
- Giữ nguyên form hóa đơn phía sau để người dùng kiểm tra và bấm `Lưu HĐ`.

## 1.5.1 (2026-07-30)

- Thêm nút `Mở và áp dụng phương án` cho phiếu đã tồn tại ở trạng thái `Đã Accept`.
- Tự mở đúng phiếu đã gắn, áp dụng chính xác phương án đã khóa và kiểm tra lại hàng, giờ, VAT, tổng tiền.
- Sau khi áp dụng thành công, tự thu gọn extension để người dùng kiểm tra form và chỉ bấm `Lưu HĐ`.
- Chưa trừ tồn kho khi áp dụng; tồn chỉ được ghi sau bước `Đối soát sau lưu`.

## 1.5.0 (2026-07-30)

- Đa dạng hóa mặt hàng trong Batch Review bằng thứ tự xoay vòng ổn định theo từng giao dịch.
- Phạt nhẹ các mã đã xuất hiện ở phương án trước trong cùng batch để hạn chế lặp lại một bộ sản phẩm.
- Giữ nguyên các ràng buộc ưu tiên, số lượng thực tế, tồn kho, VAT và tổng tiền khớp tuyệt đối.
- Chạy lại cùng dữ liệu vẫn cho kết quả ổn định để người dùng có thể kiểm tra và đối soát.

## 1.4.9 (2026-07-30)

- Thêm bộ lọc `Từ ngày` và `Đến ngày` cho Batch Review; khoảng ngày được giữ khi tải lại hoặc chuyển tab.
- Hiển thị cả giao dịch đã xử lý trong Batch Review để trạng thái khớp với màn hình Giao dịch ngân hàng.
- Giao dịch đã xử lý chỉ được đọc để hiển thị, không dò lại hóa đơn và không trừ tồn kho lần nữa.

## 1.4.5 (2026-07-29)

- Batch Review tự chọn phiếu chưa xuất có tổng hiện tại gần tiền sao kê nhất khi cùng ngày có nhiều phiếu.
- Mỗi phiếu chỉ được giữ chỗ cho một giao dịch trong cùng lượt lập kế hoạch.
- Khi chênh lệch bằng nhau, số phiếu thấp hơn được chọn để kết quả ổn định.

## 1.4.4 (2026-07-29)

- Tái đối soát một hóa đơn đã ghi sổ sẽ hoàn số lượng của phương án cũ trước khi trừ phương án mới.
- Cập nhật ledger theo cùng `transactionId` thay vì bỏ qua vì đã tồn tại; lưu số lần điều chỉnh bằng `revision`.
- Hoàn kho và trừ kho được commit cùng sao kê/ledger, tránh trạng thái nửa chừng.
- Accept vẫn chỉ sửa form; tồn kho chỉ thay đổi sau khi Lưu HĐ và Đối soát sau lưu thành công.

## 1.4.3 (2026-07-29)

- Thêm trần số lượng thực tế theo nhóm hàng; riêng Mắc Ca tối đa 2 hộp trên một hóa đơn.
- Rượu vang và hoa quả tối đa 1, thuốc lá tối đa 2, đồ khô 2–4, nước 6 và bia 12 trên mỗi mã.
- Đổi điểm tối ưu để ưu tiên 3–6 mã hàng đa dạng và phạt phương án dồn nhiều đơn vị vào cùng một sản phẩm.
- Bảng duyệt phương án tách rõ tồn kho và trần số lượng trên mỗi hóa đơn.

## 1.4.2 (2026-07-29)

- Thu hẹp file bàn giao thành inventory-only; không còn chứa sao kê, danh mục web, rule, ánh xạ hoặc sổ đối soát.
- Import chỉ cập nhật `availableQty` của mã kho đang tồn tại, giữ nguyên toàn bộ dữ liệu khác.
- Cảnh báo mã mới chưa có ánh xạ và mã hiện tại bị thiếu trong file.

## 1.4.1 (2026-07-29)

- Chuyển tải file trạng thái tồn sang `chrome.downloads` qua service worker để bảo đảm Chrome thực sự tạo file JSON.

## 1.4.0 (2026-07-29)

- Thêm xuất/nhập gói trạng thái tồn JSON để bàn giao giữa ca hoặc máy mà không cần backend.
- Gói dữ liệu mang theo tồn khả dụng, ánh xạ, danh mục web, rule, sổ đối soát và phần `batch_ready` đang giữ tồn.
- Thêm màn hình xem trước chênh lệch và cảnh báo file cũ/trùng/khác nhánh trước khi nhập.
- Tự sao lưu trạng thái hiện tại trước khi áp dụng file nhập.
- Đồng bộ ngoại lệ TCTO theo giá web 400.000.

## 1.3.10 (2026-07-29)

- Sửa mở nhầm URL khi thanh menu website thu gọn: dùng liên kết `Bán hàng` kể cả khi liên kết không hiển thị.
- Chặn vòng lặp mở lại phòng sau khi người dùng bấm `Thoát` hoặc tải lại trang bằng dấu `formAutoOpenedAt`.
- Mỗi lượt bấm `needs_new_invoice` tạo phiên mở form mới; vẫn có thể thử lại chủ động từ Batch Review.

## 1.3.9 (2026-07-29)

- Thay `BÁN LẺ` bằng phòng không hoạt động đầu tiên theo thứ tự hiển thị của website khi xử lý `needs_new_invoice`.
- Loại phòng có thêm thời lượng/trạng thái khỏi danh sách rảnh và luôn loại `BÁN LẺ`.
- Hiển thị, lưu và khôi phục tên phòng đã chọn trong thẻ giao dịch đang tạo phiếu.
- Nếu không còn phòng rảnh, dừng an toàn và yêu cầu xử lý thủ công.
- Kiểm tra trực tiếp với VIP 8888: mở form không làm phòng chuyển sang hoạt động ở tab quan sát; thoát không lưu trả lại màn hình phòng và không để lại trạng thái.

## 1.3.8 (2026-07-29)

- Hoàn thiện `needs_new_invoice`: sau khi mở tab Bán hàng mới, tự chọn `BÁN LẺ` và mở thẳng form tạo phiếu.
- Chỉ chạy thao tác tự mở form trên đúng màn hình Bán hàng; không tác động tab danh sách hóa đơn điện tử.
- Xác nhận form bằng nút `Lưu HĐ` hiển thị và dừng tại đó; extension không tự lưu hoặc phát hành.

## 1.3.7 (2026-07-29)

- Sửa khôi phục phiên ở tab Bán hàng mới: tự mở panel extension thay vì chỉ bật chế độ Batch Review ở bên trong panel đang thu gọn.
- Sau khi bấm dòng `needs_new_invoice`, người dùng thấy ngay ngày hóa đơn, tổng mục tiêu và diễn giải mà không phải bấm lại `Σ`.

## 1.3.6 (2026-07-29)

- Dòng `needs_new_invoice` mở màn hình Bán hàng trong tab mới; tab danh sách và Batch Review gốc không bị thay thế.
- Lưu phiên trước khi điều hướng tab mới để tránh tab đích khởi động khi dữ liệu giao dịch chưa sẵn sàng.
- Tab mới tự khôi phục Batch Review và hiển thị ngày hóa đơn, tổng mục tiêu cùng diễn giải sao kê của giao dịch đang tạo phiếu.
- Báo rõ khi Chrome chặn pop-up; không điều hướng tab hiện tại trong trường hợp này.

## 1.3.5 (2026-07-29)

- Lưu và tự khôi phục Batch Review khi điều hướng sang màn hình Bán hàng để người dùng tạo phiếu.
- Giữ lại giao dịch đang tạo phiếu, các kết quả batch, giới hạn số dòng và trạng thái panel.
- Dữ liệu phiên hết hạn sau 7 ngày; `Quay lại tính toán` chủ động xóa phiên.
- Sửa thông báo trường hợp không có mặt hàng: không còn hiển thị gây hiểu nhầm “lệch 0”.

## 1.3.4 (2026-07-29)

- Khi không còn phiếu chưa xuất, dò hóa đơn đã xuất cùng ngày và khớp chính xác tổng sao kê.
- Có một kết quả: yêu cầu người dùng xác nhận trước khi đánh dấu giao dịch hoàn tất.
- Có nhiều kết quả: hiển thị danh sách để người dùng chọn, không tự gắn.
- Lỗi dò hóa đơn dùng trạng thái `lookup_error`; không gợi ý tạo phiếu mới để tránh hóa đơn trùng.
- Dòng có nhiều phiếu chưa xuất cho phép chọn một phiếu rồi tính lại toàn batch để giữ tồn đúng thứ tự.
- Bù phần lẻ do bước thời gian trực tiếp vào Tiền giờ; giảm giá luôn bằng 0 và VAT không bị dùng làm khoản bù.
- Đồng bộ `TCTO` theo giá web hiện hành 400.000.

## 1.3.3 (2026-07-27)

### Bug Fixes

**[BUG-1] Va chạm tiền tố khi tìm input (bridge.js)**
- Fix: `suffixInput()` now matches exact id patterns `^<prefix>\d+$` instead of loose prefix matching
- Issue: "numTILEGIAMGIA" was matching "numTILEGIAMGIAGIO", causing incorrect field access
- Impact: Prevents reading/writing to wrong discount fields on invoice form

**[BUG-2] Ghi numTIENHANG khi ô readOnly (bridge.js)**
- Fix: `setNumericAmount()` now saves and restores `readOnly` state
- Issue: numTIENHANG and numTIENGIO are readOnly; attempting to write without temporarily disabling failed silently
- Impact: Total goods and hour amounts are now written correctly even on protected fields

**[BUG-3] Thiếu rollback trong replaceInvoiceItems (bridge.js)**
- Fix: `replaceInvoiceItems()` now captures initial row snapshot and rolls back on any error
- Issue: If `filterProduct()` or `createDetailFromProduct()` threw mid-operation, grid was left in inconsistent state (mixed old+new rows)
- Impact: Grid integrity guaranteed; form never left in partial modification state

**[BUG-4] Kiểm tra numTONGCONG một lần gây dương tính giả (bridge.js)**
- Fix: `applyInvoicePlan()` now polls for total field presence (200ms × ~10 attempts) instead of single check
- Issue: During Kendo grid rebind, total field temporarily disappears; single check after 400ms caused false "reset" errors
- Impact: Eliminates spurious failures during form repaint cycles

**[BUG-5] Dead code trong addProductThroughWebsite (bridge.js)**
- Fix: Removed unreachable fallback code (lines after early `return`)
- Issue: ~20 lines of dialog-based quantity entry were unreachable due to `return` at line 467
- Verification: `addProductThroughWebsite()` is never called; direct grid manipulation via `replaceInvoiceItems()` handles all product additions
- Impact: Cleaner, simpler code path

### Logic Changes

**[ITEM-6] Đảm bảo giảm giá LUÔN = 0 (solver.js + content.js)**
- Change: `hourDiscount` field now always set to 0 in solver output
- Rationale: Fractional remainders (e.g., 91đ) are no longer handled via discount; instead absorbed into VAT recalculation on website
- Implementation: 
  - `solver.js`: Removed discount calculation; scoring now focuses on `preTaxDifference` and `hourDeviation` only
  - `content.js`: Simplified `finalHourAmount = hourTarget` (removed `hourTarget - hourDiscount`)
- Compliance: Invoice forms now always send `numTIENGIAMGIA=0` and `numTIENGIAMGIAGIO=0`, matching business rule "discount = 0"

**[ITEM-7] Chốt grid hóa đơn bằng field bắt buộc (bridge.js)**
- Status: Already compliant; `invoiceGrid()` requires `fields.qty` (SLXUATCHUAQUYDOI) presence for grid selection
- No change needed; existing logic is sound and resilient

### Test Updates

- `test-solver.js`: Updated assertions for new discount=0 logic; now verifies `hourDiscount = 0` and captures `preTaxDifference` for VAT adjustment
- `test-bug-1-prefix-collision.js`: New test suite for BUG-1, simulates DOM with colliding prefixes to verify exact matching

### Verification

- All syntax checks (node --check): PASS
- All unit tests PASS:
  - mapping-engine: OK
  - solver: OK
  - bank statement parser: OK
  - post-save verification: OK
  - batch review stock reservation: OK
  - control workbook validation: OK
- No breaking changes to public APIs or batch queue behavior
# 1.4.7

- Tự đóng các bàn phím/form nhập số lượng tạm do website mở trong quá trình extension thêm lại mặt hàng.
- Chỉ đóng sau khi danh sách hàng và tổng tiền đã được cập nhật thành công; không đóng form hóa đơn hoặc hộp lưu hóa đơn.

# 1.4.8

- Batch Review precomputes products, quantities, room charge, VAT, and check-in/out times for a transaction that needs a new invoice.
- Accept freezes the reviewed plan; the new Sales tab reuses that exact plan instead of recalculating it.
- The new invoice form receives the approved date/time, products, quantities, and target total. The extension still does not click Save Invoice.
- A blank new invoice is seeded through the website's product UI before the remaining approved rows are applied to its Kendo model.

# 1.4.6

- Đồng bộ ngay trạng thái giao dịch đã đối soát sang Batch Review.
- Khi extension được tải lại, trạng thái Batch Review được đối chiếu lại với trạng thái sao kê để không hiển thị sai `Đã Accept` cho giao dịch đã hoàn tất.
- Bổ sung kiểm thử hồi quy cho luồng `Đã Accept` → `Đã xử lý`.
# 1.14.2

- Luồng **Lưu API** cho phiếu đã Accept không còn thay mặt hàng hoặc tiền giờ qua Kendo UI trước khi lưu.
- Mở phiếu chỉ để lấy đúng ID/LASTSAVEID; danh mục sản phẩm được đọc trực tiếp qua API và toàn bộ `detail` được dựng trong bộ nhớ trước khi gọi `DoSave`.
- Nếu dựng payload hoặc gọi API thất bại, form được đóng và trạng thái quay lại **Đã Accept**; không trừ kho, không đánh dấu sao kê đã xử lý.
- Chỉ chuyển sang **Chờ lưu/đối soát** sau khi website xác nhận lưu API thành công.
## 1.24.3

- Tách kho vật lý riêng cho Paris Nhơn khỏi kho dùng chung Kim Giang/Linh Đàm.
- Xác nhận parser sao kê Techcombank `Txn enquiry` của Paris Nhơn dùng `Transaction date` làm ngày nghiệp vụ và `Requesting date` làm thời gian thực.
- Thêm cảnh báo kho riêng Paris Nhơn trên màn hình quản trị tồn.
- Hiển thị rõ đơn vị tính của sản phẩm web trong ô chọn ánh xạ.
