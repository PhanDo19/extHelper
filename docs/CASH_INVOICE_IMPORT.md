# Lập phiếu theo danh sách số tiền có sẵn (CK + TM)

Kế toán có sẵn danh sách số tiền phải xuất hóa đơn, tách theo hình thức thanh
toán. Tài liệu này chốt cách đọc file, cách lập phiếu, và các giới hạn đã quyết.

## Nguồn dữ liệu

File `inputInvoice.xlsx` — 435 dòng có số tiền trong 31 ngày, cộng 1 dòng 0đ,
trung bình 14 phiếu/ngày,
nhiều nhất 17 phiếu một ngày.

| Cột | Nghĩa | Tổng |
|---|---|---|
| A | Số TT | |
| B | Ngày (chỉ ngày trong tháng, không có tháng/năm) | |
| C | Hình thức TT — **CK** | 153.224.400 |
| D | Hình thức TT — **TM** | 214.365.750,5 |
| E | Chia lại DT — CK | 139.294.909 |
| F | Chia lại DT — TM | 194.877.955 |

### Dùng cột Hình thức TT (C/D), không dùng Chia lại DT (E/F)

Hai nhóm cột không phải hai phương án khác nhau mà là **cùng một số tiền ở hai
thời điểm**: `Hình thức TT = Chia lại DT × 1,1`. Quan hệ này đúng ở **436/436
dòng**, trong đó có một dòng 0đ không tạo phiếu.

Chọn C/D vì ba lý do:

1. **Khớp với thứ hệ thống đang nhận.** Toàn bộ luồng hiện tại lấy `targetGrand`
   là tổng đã gồm VAT (giống `credit` của sao kê) rồi `deriveInvoiceTargets` tự
   chia ngược ra trước thuế. Đưa E/F vào sẽ phải nhân 1,1 rồi hệ thống lại chia
   1,1 — thừa một vòng và thêm chỗ sai số.
2. **Giảm sai số làm tròn.** E/F là số thập phân vô hạn tuần hoàn
   (`6779090.9090909082`); C/D là số tiền mục tiêu. Có một dòng C/D là
   `241.950,5đ`, parser phải đánh dấu để kế toán xác nhận làm tròn.
3. **Mang thêm phương thức thanh toán.** Cột nào có số thì phiếu đó là CK hay TM.

**CK và TM loại trừ nhau**: 40 phiếu CK, 395 phiếu TM, không dòng nào có cả hai.
Phương thức thanh toán là thuộc tính đơn của phiếu, không phải chia tách.

## Giới hạn đã chốt

| # | Quyết định |
|---|---|
| 1 | Phiếu dưới **300.000đ**: đúng **một món** bia/nước giá tối đa **50.000đ**, phần còn lại vào Tiền giờ. KHÔNG áp luật ≥3 bia + ≥2 khăn ướt. Từ 300.000đ trở lên đi nhánh thường (chốt 17/09/2026) |
| 1b | **Paris Nhơn**, phiếu dưới **500.000đ**: món bắt buộc hạ xuống **≥1 bia + ≥1 khăn ướt** (chốt 18/09/2026). Mức đầy đủ 3 bia + 2 khăn ở kho Nhơn rẻ nhất đã ~410.000đ, ăn gần hết phần trước VAT nên sàn 30 phút bị kẹp xuống còn 3 phút. Kim Giang và Linh Đàm giữ nguyên mức đầy đủ |
| 2 | Phiếu quá nhỏ → **chỉ hát** (không dòng hàng, toàn bộ là tiền giờ) |
| 3 | Tổng không biểu diễn được theo VAT 10% → **không tự tạo**, đưa vào danh sách cần xác nhận |
| 4 | Phiếu TM **có** áp luật tiền giờ, nhưng **linh động dưới 200.000đ** |
| 5 | Chống nhập lại theo **file + dòng nguồn**; hai dòng giống tiền vẫn là hai phiếu |
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

### Mười một dòng không biểu diễn được theo VAT 10%

`2.987.000` · `2.700.000` (2 dòng) · `2.810.000` · `2.008.000` ·
`1.666.000` · `18.353.000` · `5.825.000` · `1.975.000` · `3.350.000` · `5.220.000`

Đã kiểm: đổi sang cột "Chia lại DT" **không** giải quyết được. Làm tròn số thập
phân vô hạn tuần hoàn rồi cộng VAT lại thì lệch đúng **1đ** ở cả 6 phiếu — vì
bản thân con số gốc không biểu diễn được, không phải do chọn sai cột.

Extension không tự lấy số gần nhất. Các dòng này được đưa sang trạng thái cần xác
nhận; sau khi kế toán chọn số làm tròn mới được phép Accept và gửi API.

## Khác biệt so với luồng sao kê ngân hàng

| | Sao kê ngân hàng | File số tiền có sẵn |
|---|---|---|
| Nguồn ngày | `Transaction date` đầy đủ | Chỉ ngày trong tháng (cột B) |
| Chống trùng | `Số bút toán` | file + dòng nguồn (giữ được hai dòng trùng tiền) |
| Phương thức TT | Luôn `TM/CK` | Theo cột có số: CK hoặc TM |
| Món hàng bắt buộc | ≥3 bia + ≥2 khăn (Nhơn dưới 500.000đ: ≥1 bia + ≥1 khăn) | Một món ≤ 50.000đ |
| Rà tay >20 triệu | Có | Không áp dụng |
| Điều phối phát hành | Có | Không |

**Tháng/năm không có trong file** — phải hỏi người dùng khi import, hoặc suy từ
tên file. Không được đoán theo ngày hiện tại: import file tháng 7 vào tháng 9 sẽ
sinh toàn bộ phiếu sai ngày.

## Các bước triển khai

1. **Đọc file** — thêm `parseInvoiceAmountWorkbook` vào `xlsx-reader.js`. Nhận
   tháng/năm từ tham số, ghép với cột B thành `dateKey`. Bỏ dòng tổng (dòng 1),
   dòng tiêu đề (2-3), dòng 0đ. Trả về `{dateKey, grandTotal, paymentMethod, rowNumber}`.

2. **Chống nhập lại** — khóa gồm `dateKey|grandTotal|paymentMethod|row` của
   file nguồn. Import lại cùng file không nhân đôi, nhưng hai dòng khác nhau
   có cùng số tiền vẫn được giữ thành hai phiếu.

3. **Lập phiếu** — dùng lại `calculateNewInvoiceBatchPlan` đã có. Truyền cờ
   `cashInvoiceMode` để `calculateBatchPlan` biết: chỉ áp 2 bia, bỏ luật nhóm
   bắt buộc, linh động tiền giờ dưới 200k.

4. **Phương thức thanh toán** — riêng Paris Nhơn, lúc tạo/lưu phiếu
   `PHUONGTHUCTT` đặt theo cột có số (`CK` hoặc `TM`). Khi phát hành hóa đơn
   điện tử dùng `TM/CK`. Luồng sao kê cũ của các cơ sở khác giữ `TM/CK` khi tạo.

5. **Slot giờ/phòng** — một ngày có tới 17 phiếu. `newInvoiceCheckInMinutes` và
   `roomBookingsOnDate` hiện cấp slot theo thứ tự lập; phải kiểm sức chứa (12
   phòng) trước khi chạy lô lớn.

6. **Kiểm chứng** — chạy thử 435 phiếu hợp lệ, đối chiếu tổng nguồn
   (`367.590.150,5đ`) và xử lý riêng dòng 0đ cùng các dòng cần xác nhận.

## Điểm rủi ro cần chú ý khi làm

- **17 phiếu một ngày với 12 phòng.** `roomIsFreeForRange` cho tái dùng phòng khi
  giờ rời nhau, nhưng phải kiểm tra thật chứ không giả định là đủ.
- **Cờ `cashInvoiceMode` chạm vào `calculateBatchPlan`** — hàm dùng chung với
  luồng sao kê. Mọi nhánh mới phải có test giữ nguyên hành vi luồng cũ.
- **Tổng đối chiếu.** 436 phiếu × sai số nhỏ vẫn ra lệch lớn; phải đối chiếu tổng
  sau khi lập xong, không chỉ kiểm từng phiếu.
