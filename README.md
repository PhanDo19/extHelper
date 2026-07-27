# Khớp tổng tiền hóa đơn — stock-first MVP

Extension chỉ dành cho `banhang.thuanvietsoft.com`. Mã nguồn được phát triển trực tiếp trong thư mục này; không tạo thư mục phiên bản mới.

## Dữ liệu đang có

- `web-catalog.js`: 143 sản phẩm từ `data.xlsx`, gồm mã, tên, đơn vị, giá, loại và nhóm web.
- `inventory-data.js`: 53 dòng từ `KhoT5.xlsx`, gồm tồn quy đổi và kết quả ánh xạ ban đầu.
- Trạng thái ban đầu: 24 `confirmed`, 23 `review`, 6 `unmatched`; một dòng confirmed có tồn bằng 0 nên không vào bộ giải.
- Dữ liệu người dùng xác nhận được lưu bằng `chrome.storage.local` và ghi đè dữ liệu nhúng khi extension khởi động.

## Luồng sử dụng

1. Tải lại extension tại `chrome://extensions` và tải lại trang bán hàng.
2. Bấm nút **Σ**.
3. Bấm **Nhập data.xlsx** nếu danh mục web có thay đổi.
4. Bấm **Nhập KhoT5.xlsx** nếu có file kho mới.
5. Bấm **Nhập sao kê.xlsx**, sau đó mở **Batch Review** để lập trước tối đa 50 phương án.
6. Kiểm tra tổng tiền, phiếu, tiền hàng, tiền giờ, VAT và chi tiết mã hàng; chỉ **Accept** các dòng hợp lệ.
7. Các phương án đã Accept đi vào hàng đợi `batch_ready` và được giữ nguyên, chưa sửa hoặc lưu hóa đơn.
8. Xử lý tuần tự từng dòng đã Accept: extension mở đúng phiếu, áp dụng phương án; người dùng kiểm tra rồi bấm **Lưu HĐ**.
9. Mở lại phiếu và đối soát sau lưu để trừ tồn kho chính thức.

## Quy tắc dữ liệu

- Kho là nguồn duy nhất quyết định mặt hàng được phép bán và số lượng tối đa.
- Danh mục web chỉ cung cấp định danh và giá dùng để tạo dòng hóa đơn.
- Chỉ `confirmed` + tồn dương + mã/giá web hợp lệ được đưa vào bộ giải.
- Khi nhập snapshot mới, ánh xạ confirmed được giữ theo `stockCode`; ánh xạ mới chỉ được đề xuất ở trạng thái review.
- Khi nhập danh mục web mới, tên/đơn vị/giá được cập nhật theo `webCode`; mã đã biến mất chuyển về review.
- Bộ giải bắt đầu mọi số lượng từ 0; hàng cũ trên hóa đơn không phải nguồn tồn.

## Cấu trúc mã

- `xlsx-reader.js`: đọc trực tiếp XLSX trong Chrome, không cần backend.
- `mapping-store.js`: lưu snapshot và ánh xạ đã duyệt.
- `mapping-engine.js`: chuẩn hóa, đề xuất, kiểm tra và tổng hợp tồn theo mã web.
- `solver.js`: tìm tổ hợp số lượng trong giới hạn tồn.
- `bridge.js`: đọc dữ liệu phiếu từ trang/Kendo Grid.
- `content.js`: giao diện nhập kho, duyệt ánh xạ và tính phương án.
- `PROJECT_SPEC.md`: yêu cầu nghiệp vụ bắt buộc cho các bước phát triển tiếp theo.

## Kiểm thử

```powershell
node --check content.js
node --check xlsx-reader.js
node --check mapping-store.js
node --check mapping-engine.js
node test-mapping.js
node test-solver.js
node test-bank-statement.js
node test-post-save.js
node test-batch-review.js
```

Chi tiết Batch Review xem tại `BATCH_REVIEW.md`.

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
- Hiển thị tiền giờ mới và giờ ra đề xuất; người dùng có thể bấm **Áp dụng giờ ra đề xuất** để website tính lại tiền giờ. Extension vẫn không tự bấm Lưu HĐ.
- Tiền giờ được mô hình hóa theo website: làm tròn thời lượng đến `0,01 giờ`, sau đó nhân đơn giá giờ suy ra từ phiếu. Với phiếu đã kiểm tra, đơn giá là 600.000/giờ và bước tiền là 6.000.
