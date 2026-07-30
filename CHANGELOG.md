# Changelog

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
