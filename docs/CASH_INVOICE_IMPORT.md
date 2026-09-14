# Lập phiếu theo danh sách số tiền có sẵn (CK + TM)

Kế toán có sẵn danh sách số tiền phải xuất hóa đơn, tách theo hình thức thanh
toán. Tài liệu này chốt cách đọc file, cách lập phiếu, và các giới hạn đã quyết.

## Nguồn dữ liệu

File `inputInvoice.xlsx` — 436 phiếu trong 31 ngày, trung bình 14 phiếu/ngày,
nhiều nhất 17 phiếu một ngày.

| Cột | Nghĩa | Tổng |
|---|---|---|
| A | Số TT | |
| B | Ngày (chỉ ngày trong tháng, không có tháng/năm) | |
| C | Hình thức TT — **CK** | 153.224.400 |
| D | Hình thức TT — **TM** | 214.365.750 |
| E | Chia lại DT — CK | 139.294.909 |
| F | Chia lại DT — TM | 194.877.955 |

### Dùng cột Hình thức TT (C/D), không dùng Chia lại DT (E/F)

Hai nhóm cột không phải hai phương án khác nhau mà là **cùng một số tiền ở hai
thời điểm**: `Hình thức TT = Chia lại DT × 1,1`. Quan hệ này đúng ở **436/436
dòng**, không một ngoại lệ.

Chọn C/D vì ba lý do:

1. **Khớp với thứ hệ thống đang nhận.** Toàn bộ luồng hiện tại lấy `targetGrand`
   là tổng đã gồm VAT (giống `credit` của sao kê) rồi `deriveInvoiceTargets` tự
   chia ngược ra trước thuế. Đưa E/F vào sẽ phải nhân 1,1 rồi hệ thống lại chia
   1,1 — thừa một vòng và thêm chỗ sai số.
2. **Tránh sai số làm tròn.** E/F là số thập phân vô hạn tuần hoàn
   (`6779090.9090909082`); C/D là số nguyên sạch.
3. **Mang thêm phương thức thanh toán.** Cột nào có số thì phiếu đó là CK hay TM.

**CK và TM loại trừ nhau**: 40 phiếu CK, 395 phiếu TM, không dòng nào có cả hai.
Phương thức thanh toán là thuộc tính đơn của phiếu, không phải chia tách.

## Giới hạn đã chốt

| # | Quyết định |
|---|---|
| 1 | Chỉ áp luật **2 chai bia**. KHÔNG áp luật ≥3 bia + ≥2 khăn ướt |
| 2 | Phiếu quá nhỏ → **chỉ hát** (không dòng hàng, toàn bộ là tiền giờ) |
| 3 | Tổng không biểu diễn được theo VAT 10% → **tự lấy số gần nhất**, ghi rõ trong ghi chú |
| 4 | Phiếu TM **có** áp luật tiền giờ, nhưng **linh động dưới 200.000đ** |
| 5 | Chống trùng theo **ngày + số tiền + hình thức** |
| 6 | Phiếu từ nguồn này **KHÔNG** vào điều phối phát hành ba cơ sở |
| 7 | Phiếu **0đ** bỏ qua hẳn (file có 1 dòng) |

### Vì sao "chỉ hát" chỉ là lưới an toàn

Kiểm trên dữ liệu thật: chỉ **6 phiếu dưới 300.000đ**, và **tất cả đều đủ chỗ
cho 2 chai bia**.

| Tổng | Trước VAT | 2 bia Tiger (100k) | Tiền giờ còn lại |
|---|---|---|---|
| 143.000 | 130.000 | vừa | 30.000 |
| 225.500 | 205.000 | vừa | 105.000 |
| 275.000 | 250.000 | vừa | 150.000 |

Nên "chỉ hát" **không cần ngưỡng cố định**. Điều kiện tự quyết: dùng khi 2 chai
bia rẻ nhất không vừa vào phần trước VAT (khoảng dưới 110.000đ với giá bia của
Nhơn), hoặc khi tồn bia đã cạn.

### Chỗ thật sự cần linh động: bước giá tiền giờ

Vấn đề của phiếu nhỏ không nằm ở tiền hàng mà ở **bước 6.000đ** của tiền giờ
(600.000đ/giờ = 10.000đ/phút, bước 0,6 phút). Không phiếu nhỏ nào chia hết:

- 143.000đ → tiền giờ 30.000đ = 5 phút ✓
- 225.500đ → tiền giờ 105.000đ = 17,5 phút ✗
- 241.951đ → tiền giờ 119.955đ ✗

Dưới **200.000đ**: bỏ sàn/trần tiền giờ và bỏ ràng buộc bước 6.000đ. Tiền giờ
là phần còn lại sau tiền hàng, phần lẻ bù bằng `hourAdjustment` — đúng cơ chế
`calculateSmallInvoiceBeerPlan` đang dùng cho hóa đơn dưới 500k.

Từ 200.000đ trở lên: giữ luật tiền giờ bình thường.

### Sáu phiếu không biểu diễn được theo VAT 10%

`2.987.000` · `2.008.000` · `5.825.000` · `1.975.000` · `3.350.000` · `5.220.000`

Đã kiểm: đổi sang cột "Chia lại DT" **không** giải quyết được. Làm tròn số thập
phân vô hạn tuần hoàn rồi cộng VAT lại thì lệch đúng **1đ** ở cả 6 phiếu — vì
bản thân con số gốc không biểu diễn được, không phải do chọn sai cột.

Extension tự lấy số gần nhất và ghi rõ độ lệch vào ghi chú phiếu.

## Khác biệt so với luồng sao kê ngân hàng

| | Sao kê ngân hàng | File số tiền có sẵn |
|---|---|---|
| Nguồn ngày | `Transaction date` đầy đủ | Chỉ ngày trong tháng (cột B) |
| Chống trùng | `Số bút toán` | ngày + số tiền + hình thức |
| Phương thức TT | Luôn `TM/CK` | Theo cột có số: CK hoặc TM |
| Món hàng bắt buộc | ≥3 bia + ≥2 khăn | Chỉ 2 bia |
| Rà tay >20 triệu | Có | Không áp dụng |
| Điều phối phát hành | Có | Không |

**Tháng/năm không có trong file** — phải hỏi người dùng khi import, hoặc suy từ
tên file. Không được đoán theo ngày hiện tại: import file tháng 7 vào tháng 9 sẽ
sinh toàn bộ phiếu sai ngày.

## Các bước triển khai

1. **Đọc file** — thêm `parseInvoiceAmountWorkbook` vào `xlsx-reader.js`. Nhận
   tháng/năm từ tham số, ghép với cột B thành `dateKey`. Bỏ dòng tổng (dòng 1),
   dòng tiêu đề (2-3), dòng 0đ. Trả về `{dateKey, grandTotal, paymentMethod, rowNumber}`.

2. **Chống trùng** — khóa `dateKey|grandTotal|paymentMethod`. Import lại cùng
   file không được nhân đôi; import file khác cùng tháng phải cộng thêm.

3. **Lập phiếu** — dùng lại `calculateNewInvoiceBatchPlan` đã có. Truyền cờ
   `cashInvoiceMode` để `calculateBatchPlan` biết: chỉ áp 2 bia, bỏ luật nhóm
   bắt buộc, linh động tiền giờ dưới 200k.

4. **Phương thức thanh toán** — `PHUONGTHUCTT` đặt theo cột có số (`CK` hoặc
   `TM`), thay vì ép `TM/CK` như luồng sao kê. Đây là ngoại lệ có chủ đích so
   với `PROJECT_SPEC.md`, phải ghi rõ trong spec.

5. **Slot giờ/phòng** — một ngày có tới 17 phiếu. `newInvoiceCheckInMinutes` và
   `roomBookingsOnDate` hiện cấp slot theo thứ tự lập; phải kiểm sức chứa (12
   phòng) trước khi chạy lô lớn.

6. **Kiểm chứng** — chạy thử toàn bộ 436 phiếu, đối chiếu tổng tiền với dòng tổng
   của file (`367.590.150`).

## Điểm rủi ro cần chú ý khi làm

- **17 phiếu một ngày với 12 phòng.** `roomIsFreeForRange` cho tái dùng phòng khi
  giờ rời nhau, nhưng phải kiểm tra thật chứ không giả định là đủ.
- **Cờ `cashInvoiceMode` chạm vào `calculateBatchPlan`** — hàm dùng chung với
  luồng sao kê. Mọi nhánh mới phải có test giữ nguyên hành vi luồng cũ.
- **Tổng đối chiếu.** 436 phiếu × sai số nhỏ vẫn ra lệch lớn; phải đối chiếu tổng
  sau khi lập xong, không chỉ kiểm từng phiếu.
