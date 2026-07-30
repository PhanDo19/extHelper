"use strict";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "invoiceTarget.downloadStockState") return false;
  const filename = String(message.filename || "");
  const content = String(message.content || "");
  if (!/^TonKho_ParisKimGiang_[0-9_-]+\.json$/.test(filename)) {
    sendResponse({ ok: false, error: "Tên file trạng thái tồn không hợp lệ." });
    return false;
  }
  if (!content || content.length > 10 * 1024 * 1024) {
    sendResponse({ ok: false, error: "Nội dung file trạng thái tồn trống hoặc quá lớn." });
    return false;
  }
  const url = `data:application/json;charset=utf-8,${encodeURIComponent(content)}`;
  chrome.downloads.download({
    url,
    filename,
    conflictAction: "uniquify",
    saveAs: false
  }, downloadId => {
    const error = chrome.runtime.lastError;
    if (error) sendResponse({ ok: false, error: error.message });
    else sendResponse({ ok: true, downloadId });
  });
  return true;
});
