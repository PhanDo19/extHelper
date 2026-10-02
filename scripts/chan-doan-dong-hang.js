// CHẨN ĐOÁN (chỉ đọc, không lưu gì): website lấy DÒNG HÀNG của phiếu bằng request nào?
// Dùng để cập nhật người mua/TM-CK hoàn toàn bằng API, không phải mở phiếu trên giao diện.
//
// Cách dùng:
//   1. Ở danh sách Bán hàng, F12 -> Console -> dán toàn bộ file -> Enter.
//   2. Trong 30 giây: nhấp đúp mở MỘT phiếu bất kỳ (có dòng hàng), chờ form hiện đủ rồi Thoát (không lưu).
//   3. Hết 30 giây Console in kết quả. Chụp/chép toàn bộ phần kết quả gửi lại.
(() => {
  const MARKERS = ["SLXUATCHUAQUYDOI", "DMATHANGID", "THANHTIEN"];
  const records = [];
  const sameOrigin = url => { try { return new URL(url, location.href).origin === location.origin; } catch (_) { return false; } };
  const note = (transport, method, url, body, status, text) => {
    if (!sameOrigin(url)) return;
    const response = String(text || "");
    records.push({
      transport, method, url: new URL(url, location.href).pathname + new URL(url, location.href).search,
      body: typeof body === "string" ? body.slice(0, 600) : body ? "[không phải chuỗi]" : "",
      status, length: response.length,
      dongHang: MARKERS.every(marker => response.includes(marker)),
      mau: (() => { const i = response.indexOf("SLXUATCHUAQUYDOI"); return i >= 0 ? response.slice(Math.max(0, i - 700), i + 300) : ""; })()
    });
  };

  const nativeFetch = window.fetch;
  window.fetch = async function (input, init) {
    const response = await nativeFetch.apply(this, arguments);
    try {
      const url = typeof input === "string" ? input : input?.url;
      note("fetch", init?.method || "GET", url, init?.body, response.status, await response.clone().text());
    } catch (_) {}
    return response;
  };
  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__chanDoan = { method, url };
    return nativeOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    const meta = this.__chanDoan;
    if (meta) {
      this.addEventListener("loadend", () => {
        let text = "";
        try { text = this.responseType === "" || this.responseType === "text" ? this.responseText : ""; } catch (_) {}
        note("xhr", meta.method, meta.url, body, this.status, text);
      }, { once: true });
    }
    return nativeSend.apply(this, arguments);
  };

  console.log("%cĐang ghi request trong 30 giây — hãy nhấp đúp MỞ MỘT PHIẾU rồi Thoát (không lưu).", "color:#b45309;font-weight:bold");
  setTimeout(() => {
    window.fetch = nativeFetch;
    XMLHttpRequest.prototype.open = nativeOpen;
    XMLHttpRequest.prototype.send = nativeSend;
    console.log("%c===== KẾT QUẢ CHẨN ĐOÁN =====", "font-weight:bold");
    console.table(records.map(({ transport, method, url, status, length, dongHang }) => ({ transport, method, url: url.slice(0, 120), status, length, dongHang })));
    const hits = records.filter(item => item.dongHang);
    if (!hits.length) {
      console.warn("Không request nào trả về dòng hàng. Có thể dòng hàng nằm sẵn trong HTML lúc mở form — gửi bảng trên để kiểm tra tiếp.");
    }
    for (const hit of hits) {
      console.log("REQUEST CÓ DÒNG HÀNG:", JSON.stringify({ method: hit.method, url: hit.url, body: hit.body, length: hit.length }));
      console.log("MẪU DỮ LIỆU:", hit.mau);
    }
    console.log("%c===== HẾT — chép toàn bộ phần kết quả gửi lại =====", "font-weight:bold");
  }, 30000);
})();
