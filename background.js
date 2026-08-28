"use strict";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "invoiceTarget.openBatchWorkerTab") {
    const url = String(message.url || "");
    if (!/^https?:\/\/banhang\.thuanvietsoft\.com\//i.test(url)) {
      sendResponse({ ok: false, error: "URL tab Bán hàng không hợp lệ." });
      return false;
    }
    chrome.tabs.create({ url, active: true }, tab => {
      const error = chrome.runtime.lastError;
      if (error) sendResponse({ ok: false, error: error.message });
      else sendResponse({ ok: true, tabId: tab?.id });
    });
    return true;
  }

  if (message?.type === "invoiceTarget.closeCurrentBatchWorkerTab") {
    const tabId = Number(_sender?.tab?.id);
    if (!Number.isInteger(tabId)) {
      sendResponse({ ok: false, error: "Không xác định được tab Batch worker." });
      return false;
    }
    chrome.tabs.remove(tabId, () => {
      const error = chrome.runtime.lastError;
      if (error) sendResponse({ ok: false, error: error.message });
      else sendResponse({ ok: true, tabId });
    });
    return true;
  }

  if (message?.type === "invoiceTarget.downloadBinary") {
    const filename = String(message.filename || "");
    const base64 = String(message.base64 || "");
    const mimeType = String(message.mimeType || "application/octet-stream");
    if (!/^XuatKho_(ParisKimGiang|ParisLinhDam|ParisNhon)_PhatHanh_[0-9_-]+\.xlsx$/.test(filename)) {
      sendResponse({ ok: false, error: `Tên file tải xuống không hợp lệ: ${filename}` });
      return false;
    }
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length > 20 * 1024 * 1024) {
      sendResponse({ ok: false, error: "Nội dung file xuất trống, sai định dạng hoặc quá lớn." });
      return false;
    }
    chrome.downloads.download({
      url: `data:${mimeType};base64,${base64}`,
      filename,
      conflictAction: "uniquify",
      saveAs: false
    }, downloadId => {
      const error = chrome.runtime.lastError;
      if (error) sendResponse({ ok: false, error: error.message });
      else sendResponse({ ok: true, downloadId });
    });
    return true;
  }

  if (message?.type !== "invoiceTarget.downloadStockState") return false;
  const filename = String(message.filename || "");
  const content = String(message.content || "");
  const allowedFilename = /^TonKho_(ParisKimGiang|ParisLinhDam|ParisNhon)_[0-9_-]+\.json$/.test(filename) ||
    /^invoice-api-trace-[0-9TZ_-]+\.json$/.test(filename) ||
    /^invoice-api-debug-(pariskimgiang|parislinhdam|parisnhon)-[A-Za-z0-9TZ_-]+\.json$/.test(filename);
  if (!allowedFilename) {
    sendResponse({ ok: false, error: `Tên file tải xuống không hợp lệ: ${filename}` });
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
