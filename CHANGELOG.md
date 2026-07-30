# Changelog

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
