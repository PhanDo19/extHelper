# Khớp tổng tiền hóa đơn — stock-first MVP

## Quy tắc ghép phiếu trong Batch Review

Khi một ngày có nhiều phiếu chưa xuất, extension mở thử tối đa 3 phiếu gần số tiền sao kê nhất và **ưu tiên phiếu có giờ vào/ra rơi đúng ngày sao kê**; chỉ khi không phiếu nào khớp ngày mới dời ca của một phiếu sang ngày sao kê. Một phiếu chỉ được gán cho một giao dịch trong cùng lượt Batch Review. Không còn phiếu chưa xuất thì extension dò hóa đơn đã xuất khớp số tiền; không có nữa thì lập phương án **phiếu mới**.

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
5. Bấm **Nhập sao kê** (hoặc **Nhập danh sách số tiền CK/TM**), chọn khoảng ngày rồi **Tạo Batch Review** để lập trước tối đa 500 phương án. Chưa có hóa đơn nào bị sửa hoặc lưu ở bước này.
6. Kiểm tra tổng tiền, phiếu, tiền hàng, tiền giờ, VAT và chi tiết mã hàng; chỉ **Accept** các dòng hợp lệ. Accept chỉ đưa phương án vào hàng đợi `batch_ready`.
7. Bấm **Lưu API N phiếu đã Accept**. Extension xử lý tuần tự, dừng ở lỗi đầu tiên:
   - Phiếu có sẵn: mở đúng phiếu, lưu bằng API chính thức của website.
   - Phiếu mới: tự chọn phòng hát trống đúng đơn giá (không bao giờ chọn quầy BÁN LẺ), đọc form phòng bằng API rồi tạo và thanh toán phiếu bằng hai request API ngay trên tab danh sách. Không đọc được form phòng thì tự quay về cách mở tab Bán hàng phụ.
   - Sau mỗi phiếu, extension mở lại phiếu từ server và **đối soát sau lưu**; chỉ khi khớp tuyệt đối mới đánh dấu giao dịch đã xử lý và trừ tồn kho.
8. Nếu một lần tạo phiếu mới báo lỗi mà chưa rõ website đã cấp số hay chưa, extension chặn tạo lại. Kiểm tra danh sách Bán hàng ngày đó rồi bấm **Đặt lại** giao dịch trước khi chạy tiếp.
9. Vào tab **Giao dịch ngân hàng** → sub-tab **Phát hành hóa đơn**, chọn ngày, tích các hóa đơn cần phát hành rồi bấm **Phát hành N hóa đơn · X đ** (chỉ hỏi xác nhận khi lô có cảnh báo).
10. Sang tab Kho bấm **Xuất kho đã phát hành (Excel)** để lấy file `.xlsx` hạch toán gửi kế toán.

## Dashboard kế toán

Màn hình đầu hiển thị tổng quan theo kỳ cho đúng cơ sở đang mở: tổng sao kê, số tiền đã đối soát, số tiền chưa hoàn tất, số ngoại lệ và số hóa đơn điện tử đã phát hành. Khu vực **Việc cần xử lý** gom các lỗi dữ liệu, tồn kho, ánh xạ và giao dịch, đồng thời đưa người dùng tới đúng bước cần sửa.

Dashboard chỉ đọc trạng thái hiện có. Việc đổi khoảng ngày không tự động sửa sao kê, trừ tồn kho, lưu hoặc phát hành hóa đơn.

## Phát hành hóa đơn điện tử

Sub-tab **Phát hành hóa đơn** nằm trong tab **Giao dịch ngân hàng**, thay cho thao tác thủ công trên website (bấm `PHÁT HÀNH` rồi xác nhận hai hộp thoại cho từng dòng).

- Danh sách **chỉ hiện hóa đơn thuộc danh sách giao dịch** (đã gắn với một dòng sao kê). Phiếu ngoài giao dịch là của nghiệp vụ khác nên bị ẩn; muốn xem thì tích ô `Hiện N phiếu ngoài giao dịch`, và nếu chọn chúng thì hộp thoại xác nhận sẽ nêu rõ.
- Mỗi hóa đơn chạy đúng thứ tự website dùng: lấy mặt hàng → `kiemTraThongTin` → `phatHanhHoaDon`.
- Mặt hàng lấy từ **sổ đối soát sau lưu** (bước 10). Số liệu này đã được kiểm tra lại với phiếu trên website trước khi trừ tồn, nên không cần mở lại phiếu và không phụ thuộc màn hình đang mở. Bảng hiển thị sẵn mặt hàng kèm nhãn nguồn để bạn kiểm tra trước khi phát hành.
- Hóa đơn **không có trong sổ đối soát** (không do extension lập) được đọc mặt hàng từ website bằng API của màn hình Hóa đơn điện tử, không cần mở phiếu hay chuyển màn hình. Có thể phát hành ngay tại màn hình Hóa đơn điện tử của website.
- Nút **Thử đọc mặt hàng** kiểm tra riêng bước lấy mặt hàng, không phát hành gì.
- Sổ đối soát có thể lệch phiếu thật nếu phiếu bị sửa ngoài extension (chuyển phòng, đổi số lượng). Khi tải danh sách và khi phát hành, extension tự so tiền hàng trên web với sổ (chỉ đọc). Phiếu lệch được đánh dấu ⚠; khi phát hành, mặt hàng được đọc lại từ phiếu rồi sổ và tồn kho được cập nhật theo phiếu thật. Nút **Đối soát lại mặt hàng từ website** cập nhật ngay mà không cần phát hành. Xem `docs/RESTOCK.md`.
- Nút **Đồng bộ hóa đơn đã phát hành** ghi bổ sung vào sổ hạch toán những hóa đơn đã phát hành trên website nhưng chưa có trong sổ (phát hành tay, hoặc lần phát hành trước bị mất phản hồi).
- Nếu một hóa đơn báo lỗi, extension đọc lại danh sách để xác nhận: server đã phát hành thì vẫn ghi sổ và báo rõ, nên **đừng bấm phát hành lại** khi thấy báo lỗi — hãy xem dòng chi tiết bên dưới trước.
- Chỉ hóa đơn chưa có Số HĐ và chưa hủy mới chọn được. Hóa đơn đã phát hành không thể phát hành lại từ extension, và extension không tự hủy hóa đơn.
- Lô chạy tuần tự; hóa đơn lỗi được liệt kê riêng và không chặn các hóa đơn còn lại.
- Mỗi hóa đơn thành công được ghi sổ ngay, nên dừng giữa chừng vẫn giữ đủ số liệu phần đã chạy.
- Sổ phát hành khóa theo ID hóa đơn: chạy lại lô chỉ ghi đè, không cộng dồn số lượng.
- Kim Giang và Linh Đàm dùng chung dải số: phát hành xong một cơ sở, extension tự chuyển sang màn Hóa đơn điện tử của cơ sở kế tiếp sau 8 giây (có nút **Ở lại trang này**), và sau khi đăng nhập lại thì mở sẵn bước Phát hành với **đúng ngày** cơ sở trước vừa làm, tích sẵn các hóa đơn thuộc giao dịch sao kê. Lô có lỗi/cảnh báo thì không tự chuyển, chỉ có nút **Chuyển sang …**. Ở luồng tay, cơ sở đích không tự phát hành. Xem `docs/SEQUENTIAL_ISSUE_FLOW.md`.
- **Tự động phát hành** (hàng riêng ở màn Phát hành): chọn Từ ngày – Đến ngày, bấm và xác nhận một lần; extension tự phát hành từng ngày, luân phiên Kim Giang/Linh Đàm theo thứ tự phát hành (Nhơn: lần lượt các ngày), tự chuyển cơ sở và đăng nhập, đếm ngược 5 giây kèm nút **Dừng** trước mỗi bước. Dừng hẳn khi có giao dịch chưa xử lý xong, phiếu lệch sao kê, cảnh báo chéo cơ sở, phiếu ngoài giao dịch hoặc lô có lỗi/cảnh báo; bấm **Chạy tiếp** sau khi xử lý.

## File hạch toán (Excel)

Hàng **File hạch toán** ở màn Phát hành (chọn Từ ngày – Đến ngày, mặc định cả tháng; tự động phát hành xong thì mặc định đúng khoảng vừa chạy) hoặc nút **Xuất kho đã phát hành (Excel)** ở tab Kho tạo file `.xlsx` gồm hai sheet. File chỉ gồm hóa đơn phát hành ở cơ sở đang mở.

**Sheet `TheoPhieu`** (mở ra là thấy) — để kế toán kiểm soát từng phiếu:

| Phiếu | Ngày | Số HĐ | Mã hàng web | Tên hàng web | ĐVT | Số lượng | Đơn giá | Thành tiền | Mã hàng kho | Tên hàng kho |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

- Mỗi phiếu là một dòng nhóm in đậm, tô nền (số phiếu, ngày, số HĐ, số mặt hàng, tổng số lượng, tổng tiền hàng); các dòng hàng nằm ngay dưới, **thu gọn/mở được bằng nút +/−** của Excel, và chỉ gồm thông tin hàng web cùng ánh xạ của nó dưới kho.
- Mã web chưa có ánh xạ kho ghi `⚠ chưa ánh xạ kho`; phiếu chưa đọc được mặt hàng vẫn có dòng phiếu kèm cảnh báo. Cuối sheet có dòng **TỔNG CỘNG**.

**Sheet `ChiTiet`** — bảng phẳng để lọc/pivot, mỗi dòng hàng một dòng:

| Mã phiếu | Ngày | Số hóa đơn | Mã hàng | Tên hàng | Tên hàng kho | Số lượng | Giá tiền | Thành tiền |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

- `Số lượng`, `Giá tiền`, `Thành tiền` là ô số (tiền có phân cách hàng nghìn) nên Excel tự tính tổng; dòng tiêu đề được cố định và có sẵn AutoFilter.
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
- Accept và Lưu API đều chưa thay đổi tồn; tồn chỉ bị trừ ở bước Đối soát sau lưu. Nếu sửa lại phiếu đã ghi sổ, lần Đối soát sau lưu kế tiếp sẽ hoàn phương án cũ rồi trừ phương án mới trong cùng một giao dịch lưu.

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

## Giới hạn hiện tại

- Tạo phiếu mới không cần tab phụ dựa trên việc HTML của `GET AddEdit` chứa dữ liệu form (`new DataTransferJs(...)`). Điều này đã được suy ra từ cách form mở trên giao diện nhưng chưa được kiểm chứng trên website thật; bấm **Kiểm tra tạo phiếu không cần tab phụ** trước khi chạy lô. Nếu không đọc được, extension tự quay về tab phụ.
- Sao kê có kiểm tra phiên bản giữa các tab: tab nào ghi dựa trên dữ liệu cũ sẽ bị từ chối và được nhắc tải lại trang (F5). Ánh xạ mặt hàng và các màn hình quản trị khác chưa có kiểm tra này, nên vẫn chỉ nên mở một tab cho mỗi cơ sở. Trên trang `http://` (không có Web Locks) hai lần ghi đúng cùng thời điểm vẫn có thể lọt kiểm tra.
- Extension chỉ phát hành hóa đơn điện tử khi người dùng bấm nút Phát hành hoặc đã bật Tự động phát hành cho đúng khoảng ngày đó, và không tự hủy hóa đơn.
# Mới trong MVP 0.4

- Chọn giao dịch ngân hàng sẽ tự tìm phiếu chưa xuất đúng ngày giao dịch.
- Các số phiếu đã gắn với giao dịch khác bị loại; nếu chỉ còn một phiếu thì tự mở, nếu có nhiều phiếu thì người dùng chọn.
- Liên kết `giao dịch ngân hàng → số phiếu` được lưu để tránh chọn trùng.
- Khi tìm phiếu, extension luôn lấy danh sách với trạng thái **Chưa phát hành** (từ 1.29.15 lấy bằng API của màn hình Hóa đơn điện tử và mở phiếu theo ID, không cần mở màn hình danh sách).

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
