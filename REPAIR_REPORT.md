# Báo cáo sửa lỗi Chrome Extension Invoice-Target-MVP (v1.3.2 → v1.3.3)

## Tóm tắt
Đã sửa **5 bugs bắt buộc** (P0-P1) và **2 review items** (P2). Toàn bộ test đều pass (BEFORE = AFTER).

---

## A. BUGS SỬA CHỮ (5 items)

### BUG-1: Va chạm tiền tố khi tìm input (bridge.js, dòng 13-16)
**File:** bridge.js  
**Triệu chứng:** `suffixInput("numTILEGIAMGIA")` khớp "numTILEGIAMGIAGIO" vì dùng `id^="prefix"`  
**Sửa:** Dùng regex `^${prefix}\d+$` để khớp chính xác  
**Acceptance:** test-bug-1-prefix-collision.js ✓

### BUG-2: Ghi numTIENHANG khi ô readOnly (bridge.js, dòng 117-130)
**File:** bridge.js  
**Triệu chứng:** setNumericAmount() không xử lý readOnly, giá trị bị website revert  
**Sửa:** Save wasReadOnly, set false, ghi, restore (như applyHourAmount)  
**Acceptance:** applyInvoiceTotals() ghi numTIENHANG thành công ✓

### BUG-3: Thiếu rollback trong replaceInvoiceItems (bridge.js, dòng 495-601)
**File:** bridge.js  
**Triệu chứng:** Lỗi ở giữa → grid lẫn dòng cũ+mới  
**Sửa:** Snapshot trước, try-catch, rollback từ snapshot nếu lỗi  
**Acceptance:** Mock lỗi ở dòng thứ 2 → dataSource phục hồi ✓

### BUG-4: Kiểm tra numTONGCONG một lần gây dương tính giả (bridge.js, dòng 200-222)
**File:** bridge.js  
**Triệu chứng:** wait(400) + check 1 lần → false error khi Kendo rebind  
**Sửa:** Poll 200ms × ~10 lần (deadline 2s)  
**Acceptance:** Ô tổng vắng 1-2 nhịp → không ném lỗi ✓

### BUG-5: Dead code trong addProductThroughWebsite (bridge.js, dòng 451-477)
**File:** bridge.js  
**Triệu chứng:** `return;` ở giữa → 20 dòng dialog unreachable  
**Sửa:** Xóa dead code (grep: hàm không được gọi)  
**Acceptance:** node --check bridge.js ✓

---

## B. REVIEW ITEMS (2 items)

### ITEM-6: Đảm bảo giảm giá LUÔN = 0
**Files:** solver.js + content.js  
**Sửa:** Loại bỏ `hourDiscount` khỏi scoring; set luôn = 0  
**Impact:** Discount = 0 luôn; phần lẻ xử lý qua VAT recalculation website  
**Test:** test-solver.js cập nhật assertion ✓

### ITEM-7: Chốt grid hóa đơn bằng field bắt buộc
**File:** bridge.js  
**Status:** Đã đúng (dòng 313: bắt buộc fields.qty)  
**No change needed.**

---

## C. TEST RESULTS

### BEFORE (v1.3.2)
- node --check: content.js ✓, bridge.js ✓, solver.js ✓
- test-mapping.js: OK
- test-solver.js: OK
- test-bank-statement.js: OK
- test-post-save.js: OK
- test-batch-review.js: OK
- validate_control_workbook.py: OK

### AFTER (v1.3.3)
- node --check: content.js ✓, bridge.js ✓, solver.js ✓
- test-mapping.js: OK
- test-solver.js: OK
- test-bank-statement.js: OK
- test-post-save.js: OK
- test-batch-review.js: OK
- validate_control_workbook.py: OK

**Kết luận:** Không có regression.

---

## D. FILES ĐÃ SỬA

1. **bridge.js**
   - suffixInput() [prefix collision]
   - setNumericAmount() [readOnly handling]
   - applyInvoicePlan() [total field polling]
   - replaceInvoiceItems() [rollback on error]
   - addProductThroughWebsite() [dead code removal]

2. **solver.js**
   - solveQuantities() [hourDiscount=0 logic]

3. **content.js**
   - calculatePlan() [gỡ hourDiscount]
   - showReview() [gỡ hourDiscount]

4. **test-solver.js**
   - residualBalanced assertions [cập nhật]

5. **manifest.json**
   - version: 1.3.2 → 1.3.3

6. **NEW FILES**
   - test-bug-1-prefix-collision.js
   - CHANGELOG.md
   - REPAIR_REPORT.md

---

## E. SELF-CHECK CONTENT.JS (mục D)

✓ Batch queue tuần tự: mở phiếu → áp phương án → user bấm Lưu → đối soát → phiếu tiếp  
✓ Dòng needs_choice: cho chọn 1 phiếu, tính lại riêng  
✓ Reservation tồn kho cộng dồn giữa các dòng Batch Review  
✓ Commit atomic: chỉ trừ kho + chuyển done SAU khi đối soát khớp  
✓ Ngành per_invoice (TC/TCTO) không trừ tồn dùng chung  
✓ Không tự Lưu/Phát hành/xóa hóa đơn  

**Kết luận:** content.js logic đúng, không cần sửa.

---

## F. KHUYẾN NGHỊ

### Kiểm tra live
1. Form với ca HD lệch 91đ: xác nhận VAT recalculate đúng cách
2. Tiền giờ khoảng 600k-650k: kiểm tra applyHourAmount() không bị revert
3. Grid khi có lỗi mạng: rollback logic có phục hồi đúng không

### Tương lai
- Upgrade version 1.4.0 nếu thêm feature major
- Monitor `preTaxDifference` field khi nhập ca lệch lớn
- Cân nhắc lưu log chi tiết cho debug khi batch review fail

---

*Report: 2026-07-27*  
*Extension: invoice-target-mvp v1.3.3*
