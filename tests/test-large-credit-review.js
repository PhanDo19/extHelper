"use strict";

// Sao kê trộn doanh thu với các khoản KHÔNG phải doanh thu — nạp tiền vào tài
// khoản, lãi ngân hàng, chuyển nội bộ — và những khoản đó thường là số lớn.
// Quan sát thật trên sao kê Techcombank tháng 7: "nop tien tk" 150 triệu,
// "Nap tien vao tai khoan" 60 triệu, đều lọt vào pending như giao dịch thường.
//
// Lập hóa đơn cho chúng là sai bản chất, mà phát hành rồi thì không hoàn tác
// được. Vì vậy giao dịch từ ngưỡng trở lên phải được người rà bằng mắt NGAY SAU
// KHI IMPORT, trước khi vào luồng lập phiếu.

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const content = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");

// --- Ngưỡng ----------------------------------------------------------------

const thresholdMatch = /const MANUAL_REVIEW_CREDIT_THRESHOLD = (\d+);/.exec(content);
assert(thresholdMatch, "Thiếu ngưỡng rà tay cho giao dịch lớn");
const threshold = Number(thresholdMatch[1]);
assert.strictEqual(threshold, 20000000, "Ngưỡng rà tay phải là 20 triệu");

// --- Đánh dấu lúc import ---------------------------------------------------

const importFlow = content.slice(
  content.indexOf("async function importStatementFile(event)"),
  content.indexOf("function stockReservationByCode(")
);
assert(importFlow.includes("MANUAL_REVIEW_CREDIT_THRESHOLD"),
  "Import sao kê phải áp ngưỡng rà tay");
assert(/item\.status = "review"/.test(importFlow),
  "Giao dịch lớn phải bị đưa về review, không được vào thẳng pending");

// Việc đánh dấu phải xảy ra TRƯỚC khi lưu, nếu không lần mở lại sẽ mất.
assert(importFlow.indexOf("MANUAL_REVIEW_CREDIT_THRESHOLD") < importFlow.indexOf("saveStatement"),
  "Phải đánh dấu trước khi lưu sao kê");

// Chỉ đụng giao dịch CHƯA xử lý: dòng đã planned/done là việc đã rà và đã chạy,
// đẩy ngược về review sẽ xoá công sức và gây hoang mang.
assert(/if \(item\.status !== "pending"\) continue;/.test(importFlow),
  "Chỉ được đổi trạng thái của giao dịch đang pending");

// Nhập lại sao kê không được bắt duyệt lại từ đầu.
assert(/if \(item\.largeCreditReviewedAt\) continue;/.test(importFlow),
  "Giao dịch đã duyệt rồi thì lần import sau không bị đẩy về review nữa");
assert(/largeCreditReviewedAt: old\.largeCreditReviewedAt/.test(importFlow),
  "Dấu đã duyệt phải được giữ lại khi import lại sao kê");

// --- Thông báo bắt buộc sau import ----------------------------------------

assert(importFlow.includes("manualReviewCount"), "Phải đếm số giao dịch cần rà");
assert(/action: "review-large"/.test(importFlow),
  "Thông báo sau import phải có lối đi thẳng tới danh sách cần rà");
assert(/KHÔNG được lập phiếu/.test(importFlow),
  "Thông báo phải nói rõ các giao dịch này chưa được lập phiếu");

const dispatcher = content.slice(
  content.indexOf("function openAccountingDashboardAction(event)"),
  content.indexOf("function refreshAccountingDashboard(")
);
assert(/action === "review-large"/.test(dispatcher),
  "Action review-large phải có nhánh xử lý, nếu không nút bấm sẽ im lặng");
assert(dispatcher.includes('filter.value = "review"'),
  "Phải lọc sẵn về đúng nhóm cần rà thay vì thả người dùng vào danh sách đầy đủ");

// --- Duyệt và loại -------------------------------------------------------

assert(content.includes("async function confirmRevenueTransaction(event)"),
  "Thiếu nút xác nhận giao dịch là doanh thu");
const confirmFn = content.slice(
  content.indexOf("async function confirmRevenueTransaction(event)"),
  content.indexOf("async function skipBankTransaction(event)")
);
assert(/item\.status = "pending"/.test(confirmFn),
  "Duyệt xong phải đưa giao dịch về pending để Batch Review lập phiếu");
assert(/item\.largeCreditReviewedAt = /.test(confirmFn),
  "Duyệt xong phải ghi dấu để lần import sau không hỏi lại");
assert(confirmFn.includes("saveStatement"), "Duyệt xong phải lưu xuống storage");

// Nút chỉ hiện ở dòng đang chờ rà.
assert(/item\.status === "review"[\s\S]{0,120}it-confirm-revenue/.test(content),
  "Nút xác nhận doanh thu chỉ được hiện ở dòng đang ở trạng thái review");
assert(content.includes('body.querySelectorAll(".it-confirm-revenue")'),
  "Nút xác nhận doanh thu phải được gắn sự kiện");

// --- Bất biến quan trọng nhất ---------------------------------------------
// review KHÔNG được nằm trong danh sách trạng thái mà Batch Review tự lấy để
// lập phương án — nếu lọt vào, toàn bộ việc chặn ở trên trở nên vô nghĩa.
const batchSelect = content.slice(
  content.indexOf("function selectBatchReviewTransactions(transactions, options)"),
  content.indexOf("async function buildBatchReview(")
);
const allowed = /allowedStatuses = new Set\(\[([^\]]+)\]\)/.exec(batchSelect);
assert(allowed, "Không đọc được danh sách trạng thái của Batch Review");
assert(!/"review"/.test(allowed[1]),
  "Batch Review không được tự lập phương án cho giao dịch đang chờ rà tay");

console.log("Large credit review tests passed");
