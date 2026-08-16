# Khớp tổng tiền hóa đơn — stock-first MVP

## Quy tắc ghép phiếu trong Batch Review

Khi một ngày có nhiều phiếu chưa xuất, extension tự chọn phiếu có `Tổng cộng` hiện tại gần số tiền sao kê nhất. Một phiếu chỉ được gán cho một giao dịch trong cùng lượt Batch Review. Kết quả tự chọn và mức chênh lệch được hiển thị để người dùng kiểm tra trước khi Accept.

## Bàn giao trạng thái tồn không cần backend

Phiên bản 1.4.2 có hai nút `Nhập trạng thái tồn` và `Xuất trạng thái tồn`.

- Cuối ca, bấm `Xuất trạng thái tồn` để tải file JSON chỉ chứa mã kho, thông tin nhận diện và số lượng khả dụng.
- Đầu ca hoặc trên máy khác, bấm `Nhập trạng thái tồn`, xem bảng so sánh rồi mới xác nhận.
- Import chỉ merge `availableQty` theo đúng `stockCode`; không ghi đè danh mục web, ánh xạ, sao kê, rule ưu tiên, sổ đối soát hoặc phiên Batch Review.
- Mã mới trong file chưa có ánh xạ sẽ được đưa vào màn hình duyệt. Người dùng có thể chọn nhóm, kiểm tra mã/tên/đơn vị/giá rồi tạo trực tiếp trên web bằng API; chỉ khi server trả ID thành công extension mới xác nhận ánh xạ. Mã hiện tại bị thiếu trong file vẫn được giữ nguyên.
- Extension cảnh báo file cũ, file trùng hoặc file thuộc nhánh bàn giao khác.
- Ngay trước khi nhập, trạng thái hiện tại được sao lưu trong `chrome.storage.local`.

Mô hình này phù hợp khi một người xử lý tuần tự. Chưa dùng cùng một file cho nhiều người/máy làm song song; trường hợp đó cần backend/DB để khóa và đồng bộ tồn.

Extension chỉ dành cho `banhang.thuanvietsoft.com`. Mã nguồn được phát triển trực tiếp trong thư mục này; không tạo thư mục phiên bản mới.

## Dữ liệu đang có

Cập nhật 29/07/2026 từ `data (1).xlsx` + `KhoT5.xlsx`:

- `web-catalog.js`: 156 sản phẩm, gồm mã, tên, đơn vị, giá, loại và nhóm web.
- `inventory-data.js`: 53 dòng từ `KhoT5.xlsx`, toàn bộ ở trạng thái `confirmed`.
- Ánh xạ kho ↔ web được đối chiếu thủ công theo tên hàng (mã kho và mã web thuộc hai hệ khác nhau); kết quả lưu tại `DoiChieu_Kho_Web_FINAL.xlsx`.
- Bộ giải nhận 49 mã web (53 dòng kho, trong đó 3 mã web nhận tồn từ nhiều dòng).
- Nguyên tắc giá: mặt hàng đã có trên web giữ nguyên giá web để không ảnh hưởng dữ liệu và hóa đơn cũ.
- Dữ liệu người dùng xác nhận được lưu bằng `chrome.storage.local` và ghi đè dữ liệu nhúng khi extension khởi động. Sau khi thay dữ liệu nhúng, cần xóa key `invoiceTargetMappingDataset` và `invoiceTargetWebCatalog` để bản mới có hiệu lực.

### Mã web nhận tồn từ nhiều dòng kho

| Mã web | Tên | Dòng kho gộp | Tồn cộng dồn |
| --- | --- | --- | --- |
| 1000010 | HẠT DẺ | `DECUOI70`, `DECUOI60`, `HATDECUOIRM` | 319 |
| 1000025 | Bánh quy que | `QUYTRAXANH`, `QUYVIETQUAT` | 216 |
| 1000034 | Bánh xốp classic 45g | `BANHPEANUT45G`, `BANH XOP` | 1.097 |

`buildInventory` chỉ cộng dồn khi giá web trùng nhau; ba nhóm trên đều cùng giá.

## Luồng sử dụng

1. Tải lại extension tại `chrome://extensions` và tải lại trang bán hàng.
2. Bấm nút **Σ**.
3. Bấm **Nhập data.xlsx** nếu danh mục web có thay đổi.
4. Bấm **Nhập KhoT5.xlsx** nếu có file kho mới.
5. Bấm **Nhập sao kê.xlsx**, sau đó mở **Batch Review** để lập trước tối đa 50 phương án.
6. Kiểm tra tổng tiền, phiếu, tiền hàng, tiền giờ, VAT và chi tiết mã hàng; chỉ **Accept** các dòng hợp lệ.
7. Các phương án đã Accept đi vào hàng đợi `batch_ready` và được giữ nguyên, chưa sửa hoặc lưu hóa đơn.
8. Với dòng `needs_new_invoice`, bấm **Mở tab Bán hàng mới để tạo phiếu**. Tab danh sách được giữ nguyên; tab mới tự khôi phục ngày, tổng mục tiêu, diễn giải giao dịch và Batch Review.
9. Xử lý tuần tự từng dòng đã Accept: extension mở đúng phiếu, áp dụng phương án; người dùng kiểm tra rồi bấm **Lưu HĐ**.
10. Mở lại phiếu và đối soát sau lưu để trừ tồn kho chính thức.
11. Vào tab **Giao dịch ngân hàng** → sub-tab **Phát hành hóa đơn**, chọn khoảng ngày, tích các hóa đơn cần phát hành rồi xác nhận một lần cho cả lô.
12. Sang tab Kho bấm **Xuất kho đã phát hành** để lấy file JSON hạch toán gửi kế toán.

## Dashboard kế toán

Màn hình đầu hiển thị tổng quan theo kỳ cho đúng cơ sở đang mở: tổng sao kê, số tiền đã đối soát, số tiền chưa hoàn tất, số ngoại lệ và số hóa đơn điện tử đã phát hành. Khu vực **Việc cần xử lý** gom các lỗi dữ liệu, tồn kho, ánh xạ và giao dịch, đồng thời đưa người dùng tới đúng bước cần sửa.

Dashboard chỉ đọc trạng thái hiện có. Việc đổi khoảng ngày không tự động sửa sao kê, trừ tồn kho, lưu hoặc phát hành hóa đơn.

## Phát hành hóa đơn điện tử

Sub-tab **Phát hành hóa đơn** nằm trong tab **Giao dịch ngân hàng**, thay cho thao tác thủ công trên website (bấm `PHÁT HÀNH` rồi xác nhận hai hộp thoại cho từng dòng).

- Danh sách **chỉ hiện hóa đơn thuộc danh sách giao dịch** (đã gắn với một dòng sao kê). Phiếu ngoài giao dịch là của nghiệp vụ khác nên bị ẩn; muốn xem thì tích ô `Hiện N phiếu ngoài giao dịch`, và nếu chọn chúng thì hộp thoại xác nhận sẽ nêu rõ.
- Mỗi hóa đơn chạy đúng thứ tự website dùng: lấy mặt hàng → `kiemTraThongTin` → `phatHanhHoaDon`.
- Mặt hàng lấy từ **sổ đối soát sau lưu** (bước 10). Số liệu này đã được kiểm tra lại với phiếu trên website trước khi trừ tồn, nên không cần mở lại phiếu và không phụ thuộc màn hình đang mở. Bảng hiển thị sẵn mặt hàng kèm nhãn nguồn để bạn kiểm tra trước khi phát hành.
- Hóa đơn **không có trong sổ đối soát** (không do extension lập) sẽ được mở lại để đọc mặt hàng — bước này cần màn hình danh sách Bán hàng đúng ngày. Nếu chưa mở, extension vẫn phát hành nhưng cảnh báo trước rằng các hóa đơn đó sẽ thiếu số liệu hạch toán.
- Nút **Thử đọc mặt hàng** kiểm tra riêng bước lấy mặt hàng, không phát hành gì.
- Nút **Đồng bộ hóa đơn đã phát hành** ghi bổ sung vào sổ hạch toán những hóa đơn đã phát hành trên website nhưng chưa có trong sổ (phát hành tay, hoặc lần phát hành trước bị mất phản hồi).
- Nếu một hóa đơn báo lỗi, extension đọc lại danh sách để xác nhận: server đã phát hành thì vẫn ghi sổ và báo rõ, nên **đừng bấm phát hành lại** khi thấy báo lỗi — hãy xem dòng chi tiết bên dưới trước.
- Chỉ hóa đơn chưa có Số HĐ và chưa hủy mới chọn được. Hóa đơn đã phát hành không thể phát hành lại từ extension, và extension không tự hủy hóa đơn.
- Lô chạy tuần tự; hóa đơn lỗi được liệt kê riêng và không chặn các hóa đơn còn lại.
- Mỗi hóa đơn thành công được ghi sổ ngay, nên dừng giữa chừng vẫn giữ đủ số liệu phần đã chạy.
- Sổ phát hành khóa theo ID hóa đơn: chạy lại lô chỉ ghi đè, không cộng dồn số lượng.

## File hạch toán (Excel)

Nút **Xuất kho đã phát hành (Excel)** ở tab Kho tạo file `.xlsx`, mỗi dòng hàng một dòng:

| Mã phiếu | Ngày | Số hóa đơn | Mã hàng | Tên hàng | Tên hàng kho | Số lượng | Giá tiền | Thành tiền |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

- `Số lượng`, `Giá tiền`, `Thành tiền` là ô số nên Excel tự tính tổng; dòng tiêu đề được cố định và có sẵn AutoFilter.
- `Tên hàng kho` lấy từ ánh xạ kho ↔ web đã xác nhận. Mã web nhận tồn từ nhiều dòng kho sẽ ghép tất cả tên kho vào một ô và **giữ nguyên số lượng** — extension không biết hóa đơn thực tế trừ từ dòng kho nào, nên tổng luôn khớp hóa đơn và kế toán tự quyết định trừ ở đâu.
- Hóa đơn chưa có mặt hàng không xuất ra dòng nào nhưng được cảnh báo sau khi xuất.
- File chỉ chứa số liệu hạch toán: không có sao kê, ánh xạ hay danh mục web.

## Quy tắc dữ liệu

- Kho là nguồn duy nhất quyết định mặt hàng được phép bán và số lượng tối đa.
- Danh mục web chỉ cung cấp định danh và giá dùng để tạo dòng hóa đơn.
- Chỉ `confirmed` + tồn dương + mã/giá web hợp lệ được đưa vào bộ giải.
- Khi nhập snapshot mới, ánh xạ confirmed được giữ theo `stockCode`; ánh xạ mới chỉ được đề xuất ở trạng thái review.
- Khi nhập danh mục web mới, tên/đơn vị/giá được cập nhật theo `webCode`; mã đã biến mất chuyển về review.
- Bộ giải bắt đầu mọi số lượng từ 0; hàng cũ trên hóa đơn không phải nguồn tồn.
- Bộ giải ưu tiên 3–6 mã hàng khác nhau, phạt lặp nhiều cùng một sản phẩm và luôn lấy giới hạn thấp hơn giữa tồn kho với trần thực tế/phiếu.
- Trần mặc định: hoa quả 1, rượu vang 1, thuốc lá 2, đồ khô 2–4, nước 6, bia 12; riêng Mắc Ca tối đa 2 hộp.
- Accept chỉ cập nhật form website, chưa thay đổi tồn. Nếu sửa lại phiếu đã ghi sổ, lần Đối soát sau lưu kế tiếp sẽ hoàn phương án cũ rồi trừ phương án mới trong cùng một giao dịch lưu.

## Cấu trúc thư mục

Toàn bộ file nguồn của extension nằm ở thư mục gốc, đúng như `manifest.json`
tham chiếu. Các thư mục con chỉ chứa thứ không được đóng gói vào extension:

```
.                 file nguồn extension (manifest.json, content.js, bridge.js, ...)
tests/            test chạy bằng node; `node tests/run-all.js` chạy tất cả
docs/             tài liệu luồng nghiệp vụ và báo cáo
fixtures/         dữ liệu mẫu đã ẩn danh dùng cho test
scripts/          tiện ích Python dựng/kiểm tra workbook đối chiếu
data/             dữ liệu thật (sao kê, tồn kho, trace API) — không commit
.archive/         bản backup và log cũ — không commit
```

`data/` và `.archive/` được liệt kê trong `.gitignore` vì chứa dữ liệu khách hàng.

## Cấu trúc mã

- `xlsx-reader.js`: đọc trực tiếp XLSX trong Chrome, không cần backend.
- `mapping-store.js`: lưu snapshot và ánh xạ đã duyệt.
- `mapping-engine.js`: chuẩn hóa, đề xuất, kiểm tra và tổng hợp tồn theo mã web.
- `solver.js`: tìm tổ hợp số lượng trong giới hạn tồn.
- `bridge.js`: đọc dữ liệu phiếu từ trang/Kendo Grid và gọi API phát hành hóa đơn điện tử.
- `issued-invoices.js`: sổ hóa đơn đã phát hành và tổng hợp mặt hàng cho file hạch toán.
- `xlsx-writer.js`: ghi file `.xlsx` trực tiếp trong Chrome, không cần thư viện ngoài.
- `content.js`: giao diện nhập kho, duyệt ánh xạ và tính phương án.
- `PROJECT_SPEC.md`: yêu cầu nghiệp vụ bắt buộc cho các bước phát triển tiếp theo.

## Kiểm thử

Chạy toàn bộ test:

```powershell
node tests/run-all.js
```

Chạy riêng một test (chạy được từ thư mục bất kỳ):

```powershell
node tests/test-solver.js
```

Kiểm tra cú pháp các file nguồn:

```powershell
node --check content.js
node --check xlsx-reader.js
node --check mapping-store.js
node --check mapping-engine.js
```

Chi tiết Batch Review xem tại `docs/BATCH_REVIEW.md`.

## Bước tiếp theo

Triển khai thao tác an toàn trên Kendo Grid: tạo bản sao trạng thái, xóa/đặt 0 hàng cũ, thêm mã web theo phương án, đọc lại tổng và cung cấp nút hoàn tác. Tuyệt đối chưa tự bấm Lưu HĐ hoặc Phát hành.
# Mới trong MVP 0.4

- Chọn giao dịch ngân hàng sẽ tự lọc danh sách Bán hàng theo đúng ngày giao dịch.
- Các số phiếu đã gắn với giao dịch khác bị loại; nếu chỉ còn một phiếu thì tự mở, nếu có nhiều phiếu thì người dùng chọn.
- Liên kết `giao dịch ngân hàng → số phiếu` được lưu để tránh chọn trùng.
- Khi tìm phiếu, extension luôn chọn trạng thái **Chưa xuất hóa đơn** trước khi Refresh.

# Mới trong MVP 0.5

- Rule mặt hàng ưu tiên có ngưỡng tổng tiền, thứ tự và trạng thái sử dụng.
- Mặc định: `TCTO` trên 1.000.000 đồng ở ưu tiên 1; `RUOUVANGDO` trên 1.000.000 đồng ở ưu tiên 2.
- Chỉ rule có thứ tự cao nhất được tự tích; các rule còn lại vẫn hiện để người dùng thay đổi.
- Checkbox chỉ hiển thị mã ngắn. Mặt hàng được tích bắt buộc xuất hiện tối thiểu 1 đơn vị trong phương án.
- Người dùng có thể thêm, sửa, xóa, bật/tắt và đổi thứ tự rule ngay trong extension.
- Trình quản lý rule tìm sản phẩm web theo mã, tên hoặc giá và tự điền mã ngắn từ ánh xạ kho khi có.

# Mới trong MVP 0.6

- Tách tiền sao kê thành tổng trước VAT và VAT theo công thức website: `trước VAT = tổng / 1,1`.
- Tiền hàng mục tiêu ban đầu bằng tổng trước VAT trừ tiền giờ hiện tại.
- Nếu tổ hợp hàng không khớp hoàn toàn, phần chênh được chuyển sang tiền giờ để tổng sau VAT vẫn khớp sao kê.
- Phần tiền giờ suy ra từ thời gian vẫn làm tròn theo bước `0,01 giờ`; chênh lệch lẻ còn lại (ví dụ 91 đồng) được ghi trực tiếp vào Tiền giờ, không dùng giảm giá và không bẻ VAT.
- Hiển thị tiền giờ mới và giờ ra đề xuất; người dùng có thể bấm **Áp dụng giờ ra đề xuất** để website tính lại tiền giờ. Extension vẫn không tự bấm Lưu HĐ.
- Tiền giờ được mô hình hóa theo website: làm tròn thời lượng đến `0,01 giờ`, sau đó nhân đơn giá giờ suy ra từ phiếu. Với phiếu đã kiểm tra, đơn giá là 600.000/giờ và bước tiền là 6.000.
- Giá ưu tiên hiện hành: `TC` 350.000 và `TCTO` 400.000 theo danh mục web.
