// Đơn giá giờ theo TỪNG phòng đọc từ website (1.29.8). Kim Giang đổi sang giá
// theo phòng (02/10/2026) thay vì mặc định 600.000đ, nên phương án phiếu mới
// tính 600.000đ bị bridge chặn ("đơn giá giờ trên website khác phương án") và
// phiếu có sẵn bị suy sai đơn giá. Extension đọc DONGIA trên form từng phòng
// (GET AddEdit + DBANID, chỉ đọc) rồi dùng bảng đó trước mọi bảng cứng.
process.env.TZ = "Asia/Ho_Chi_Minh";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const bridgeSource = fs.readFileSync(path.join(__dirname, "..", "bridge.js"), "utf8").replace(/\r\n/g, "\n");
const contentSource = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8").replace(/\r\n/g, "\n");

// Hàm top-level (thụt 2 dấu cách) kết thúc ở dòng "  }" đầu tiên.
function fn(source, name) {
  let start = source.indexOf(`\n  async function ${name}(`);
  if (start < 0) start = source.indexOf(`\n  function ${name}(`);
  if (start < 0) throw new Error(`Không tìm thấy ${name}`);
  return source.slice(start + 1, source.indexOf("\n  }\n", start) + 4);
}
function constant(source, name) {
  const match = source.match(new RegExp(`const ${name} = [^;]+;`));
  if (!match) throw new Error(`Không tìm thấy hằng số ${name}`);
  return match[0];
}

const guid = n => `${String(n).padStart(8, "0")}-aaaa-bbbb-cccc-${String(n).padStart(12, "0")}`;

(async () => {
  // --- Bridge: đọc DONGIA trên form từng phòng, chỉ GET ------------------------------
  {
    const requests = [];
    const forms = new Map([
      [guid(1), { DONGIA: "500000.00" }],
      [guid(2), { DONGIA: "700000.00" }],
      // Phòng đang có phiên: website trả form của phiên, đơn giá vẫn của phòng.
      [guid(3), { DONGIA: "700000.00", recordId: guid(99) }],
      [guid(4), { DONGIA: "0.00" }]
    ]);
    const box = {
      URLSearchParams,
      location: { origin: "http://banhang.test" },
      shopBasePath: () => "pariskimgiang",
      isLoginRedirect: (response, html) => html.includes("ĐĂNG NHẬP"),
      window: {
        fetch: async (url, options) => {
          requests.push({ url, method: options.method });
          const roomId = new URLSearchParams(url.split("?")[1]).get("DBANID");
          if (roomId === guid(5)) return { ok: false, status: 500, text: async () => "Lỗi máy chủ" };
          if (roomId === guid(6)) return { ok: true, status: 200, text: async () => "<html>không có form</html>" };
          if (roomId === guid(7)) throw new Error("Failed to fetch");
          if (roomId === guid(8)) return { ok: true, status: 200, text: async () => "<html>ĐĂNG NHẬP</html>" };
          const form = forms.get(roomId);
          const formData = {
            _AddEditTableID: box.SALES_TABLE_ID, _RecordID: form.recordId || "",
            mapper: { ID: form.recordId || "", Maps: [
              { Field: "DBANID", Value: roomId }, { Field: "DONGIA", Value: form.DONGIA }, { Field: "DKHOXUATID", Value: guid(50) }
            ] }
          };
          return { ok: true, status: 200, text: async () => `<script>var formData = new DataTransferJs(${JSON.stringify(formData)});</script>` };
        }
      }
    };
    vm.createContext(box);
    vm.runInContext([
      constant(bridgeSource, "SALES_TABLE_ID"), constant(bridgeSource, "FORM_DATA_MARKER"),
      ...["extractJsonObject", "isGuid", "formDataRecordId", "mapObject", "formAmount", "salesFormDataFromHtml",
        "readRoomHourlyRate", "readRoomHourlyRates"].map(name => fn(bridgeSource, name)),
      "this.SALES_TABLE_ID = SALES_TABLE_ID; this.readRoomHourlyRates = readRoomHourlyRates;"
    ].join("\n"), box);

    const room = (n, name) => ({ id: guid(n), name, areaId: guid(40) });
    const result = await box.readRoomHourlyRates({ rooms: [
      room(1, "VIP 1"), room(2, "VIP 2"), room(3, "VIP 3"), room(4, "VIP 4"), room(5, "VIP 5"), room(6, "VIP 6"),
      room(7, "VIP 7"), { id: "", name: "không id" }
    ] });
    const byName = Object.fromEntries(result.rooms.map(item => [item.name, item]));
    assert.strictEqual(result.rooms.length, 7, "Phòng không có id hợp lệ thì bỏ qua");
    assert.strictEqual(byName["VIP 1"].rate, 500000);
    assert.strictEqual(byName["VIP 2"].rate, 700000);
    assert.strictEqual(byName["VIP 3"].rate, 700000);
    assert.strictEqual(byName["VIP 3"].busy, true, "Phòng đang có phiên vẫn đọc được giá");
    assert.strictEqual(byName["VIP 4"].rate, 0, "Form chưa có đơn giá thì 0 (dùng giá dự phòng)");
    assert.deepStrictEqual([byName["VIP 5"].rate, byName["VIP 5"].error], [0, "HTTP 500"]);
    assert.deepStrictEqual([byName["VIP 6"].rate, byName["VIP 6"].error], [0, "không đọc được form phòng"]);
    assert.deepStrictEqual([byName["VIP 7"].rate, byName["VIP 7"].error], [0, "Failed to fetch"], "Lỗi một phòng không hỏng cả lượt");
    assert(requests.every(item => item.method === "GET" && /\/pariskimgiang\/AddEdit\?/.test(item.url) &&
      new URLSearchParams(item.url.split("?")[1]).get("RecordID") === ""), "Chỉ đọc: GET form phòng với RecordID rỗng, không DoSave");
    await assert.rejects(box.readRoomHourlyRates({ rooms: [room(1, "VIP 1"), room(8, "VIP 8")] }), /đăng nhập/,
      "Mất đăng nhập thì dừng hẳn");
  }

  // --- Content: dùng bảng giá đọc từ website ------------------------------------------
  const storage = {};
  const statuses = [];
  const requests = [];
  let roomMapRooms = [];
  let readResult = null;
  const box = {
    pageTenantSlug: "pariskimgiang",
    pageTenantLabel: "Paris Kim Giang",
    console,
    chrome: { storage: { local: {
      get: async key => ({ [key]: storage[key] ? JSON.parse(JSON.stringify(storage[key])) : undefined }),
      set: async values => { Object.assign(storage, JSON.parse(JSON.stringify(values))); }
    } } },
    formatMoney: value => new Intl.NumberFormat("vi-VN").format(Math.round(Number(value) || 0)),
    setStatus: (message, tone) => statuses.push(`${tone}: ${message}`),
    loadRoomMapForSelection: async () => ({ rooms: roomMapRooms, diagnostics: {} }),
    request: async (action, payload) => {
      requests.push({ action, payload });
      if (readResult instanceof Error) throw readResult;
      return readResult;
    }
  };
  vm.createContext(box);
  vm.runInContext([
    constant(contentSource, "DEFAULT_HOURLY_RATE"), constant(contentSource, "PARIS_NHON_ROOM_HOURLY_RATES"),
    constant(contentSource, "ROOM_RATES_KEY"), constant(contentSource, "ROOM_RATES_MAX_AGE_MS"),
    "let websiteRoomRates = null;",
    ...["normalizeRoomText", "roomAreaKey", "isRetailRoomName", "parseUiDateTime", "roomIsFreeForRange", "isIdleMapRoom",
      "websiteRoomRate", "isPageTenant", "roomHourlyRate", "tenantHourlyRates", "rankIdleRoomsFromMap",
      "hourPricingForRate", "inferHourPricing", "loadWebsiteRoomRates", "refreshWebsiteRoomRates", "roomRatesSummary",
      "ensureWebsiteRoomRates"].map(name => fn(contentSource, name)),
    "this.api = { websiteRoomRate, roomHourlyRate, tenantHourlyRates, rankIdleRoomsFromMap, inferHourPricing,",
    "  loadWebsiteRoomRates, refreshWebsiteRoomRates, roomRatesSummary, ensureWebsiteRoomRates,",
    "  setTable: table => { websiteRoomRates = table; }, table: () => websiteRoomRates };"
  ].join("\n"), box);
  const api = box.api;

  // Chưa đọc bảng giá: như trước, Kim Giang mọi phòng 600.000đ.
  assert.strictEqual(api.roomHourlyRate("VIP 1"), 600000);
  assert.deepStrictEqual([...api.tenantHourlyRates()], [600000]);

  const mapRoom = (n, name, extra = {}) => ({ id: guid(n), name, areaId: guid(40), areaName: "TẦNG 2", status: 0, gio: "", counter: 0, ...extra });
  roomMapRooms = [
    mapRoom(1, "VIP 1"), mapRoom(2, "VIP 2"), mapRoom(3, "VIP 3", { status: 1, gio: "1h 05'" }), mapRoom(4, "VIP 4"),
    mapRoom(9, "BÁN LẺ"), mapRoom(10, "QUẦY", { counter: 1 }), mapRoom(11, "VIP 11", { areaName: "KHU BÁN LẺ" })
  ];
  readResult = { readAt: new Date().toISOString(), rooms: [
    { id: guid(2), name: "VIP 2", rate: 700000 }, { id: guid(1), name: "VIP 1", rate: 500000 },
    { id: guid(3), name: "VIP 3", rate: 700000, busy: true }, { id: guid(4), name: "VIP 4", rate: 0, error: "HTTP 500" }
  ] };
  const table = await api.refreshWebsiteRoomRates();
  assert.deepStrictEqual(Array.from(requests[0].payload.rooms, room => room.name), ["VIP 1", "VIP 2", "VIP 3", "VIP 4"],
    "Không đọc giá quầy BÁN LẺ / quầy thu ngân");
  assert.strictEqual(requests[0].action, "readRoomHourlyRates");
  assert.deepStrictEqual(Array.from(table.rooms, room => room.name), ["VIP 1", "VIP 2", "VIP 3", "VIP 4"], "Giữ thứ tự phòng của website");
  assert.deepStrictEqual(storage["invoiceTargetRoomHourlyRates__pariskimgiang"].rooms[0], { id: guid(1), name: "VIP 1", rate: 500000 },
    "Lưu theo cơ sở");

  // Đơn giá từng phòng: theo website; phòng website không trả giá thì dự phòng 600k.
  assert.strictEqual(api.roomHourlyRate("VIP 1"), 500000);
  assert.strictEqual(api.roomHourlyRate("  vip 2 "), 700000, "Khớp tên không phân biệt hoa thường/khoảng trắng");
  assert.strictEqual(api.roomHourlyRate("", undefined, guid(3)), 700000, "Khớp theo id phòng");
  assert.strictEqual(api.roomHourlyRate("VIP 4"), 600000);
  assert.strictEqual(api.roomHourlyRate("VIP 1", "parislinhdam"), 600000, "Bảng giá Kim Giang không áp cho cơ sở khác");
  assert.deepStrictEqual([...api.tenantHourlyRates()], [500000, 600000, 700000],
    "Chỉ các mức có phòng thật (VIP 4 chưa đọc được giá nên còn 600k)");
  assert.deepStrictEqual([...api.tenantHourlyRates("parislinhdam")], [600000]);

  // Chọn phòng cho phiếu mới: chỉ phòng đúng đơn giá của phương án.
  const idle = roomMapRooms;
  assert.deepStrictEqual(Array.from(api.rankIdleRoomsFromMap(idle, new Map(), "", "", 500000), room => room.name), ["VIP 1"]);
  assert.deepStrictEqual(Array.from(api.rankIdleRoomsFromMap(idle, new Map(), "", "", 700000), room => room.name), ["VIP 2"],
    "VIP 3 cũng 700k nhưng đang bận");
  assert.deepStrictEqual(Array.from(api.rankIdleRoomsFromMap(idle, new Map(), "", "", 600000), room => room.name), ["VIP 4"]);

  // Phiếu có sẵn: dùng đơn giá ghi trên phiếu; không có thì suy, kể cả về 600k
  // cho phiếu lập trước khi đổi giá dù không phòng nào còn 600k.
  assert.strictEqual(api.inferHourPricing({ roomRate: 700000, currentHour: 1, durationMinutes: 60 }).hourlyRate, 700000);
  assert.strictEqual(api.inferHourPricing({ roomRate: 700000, currentHour: 0, durationMinutes: 0 }).hourStep, 7000);
  assert.strictEqual(api.inferHourPricing({ currentHour: 500000, durationMinutes: 60 }).hourlyRate, 500000);
  api.setTable({ readAt: new Date().toISOString(), rooms: [{ id: guid(1), name: "VIP 1", rate: 500000 }, { id: guid(2), name: "VIP 2", rate: 700000 }] });
  assert.deepStrictEqual([...api.tenantHourlyRates()], [500000, 700000]);
  assert.strictEqual(api.inferHourPricing({ currentHour: 600000, durationMinutes: 60 }).hourlyRate, 600000);
  assert.match(api.roomRatesSummary(table), /^500\.000đ: VIP 1 · 700\.000đ: VIP 2, VIP 3 · chưa đọc được giá .*: VIP 4$/);

  // Website không trả giá phòng nào: vẫn lưu (khỏi đọc lại mỗi lần) nhưng dùng như trước.
  readResult = { readAt: new Date().toISOString(), rooms: [{ id: guid(1), name: "VIP 1", rate: 0 }] };
  await api.refreshWebsiteRoomRates();
  assert.strictEqual(api.roomHourlyRate("VIP 1"), 600000);
  assert.deepStrictEqual([...api.tenantHourlyRates()], [600000]);

  // Dựng Batch: bảng còn mới thì không đọc lại; cũ thì đọc lại; lỗi thì nhắc và giữ bảng cũ.
  requests.length = 0;
  readResult = { readAt: new Date().toISOString(), rooms: [{ id: guid(1), name: "VIP 1", rate: 500000 }] };
  api.setTable({ readAt: new Date().toISOString(), rooms: [{ id: guid(1), name: "VIP 1", rate: 450000 }] });
  assert.strictEqual(await api.ensureWebsiteRoomRates(), "");
  assert.strictEqual(requests.length, 0, "Bảng còn mới thì không đọc lại");
  api.setTable({ readAt: new Date(Date.now() - 13 * 3600 * 1000).toISOString(), rooms: [{ id: guid(1), name: "VIP 1", rate: 450000 }] });
  assert.strictEqual(await api.ensureWebsiteRoomRates(), "");
  assert.strictEqual(api.roomHourlyRate("VIP 1"), 500000, "Bảng cũ hơn 12 giờ thì đọc lại");
  api.setTable({ readAt: "2026-01-01T00:00:00Z", rooms: [{ id: guid(1), name: "VIP 1", rate: 450000 }] });
  readResult = new Error("Phiên đăng nhập đã hết");
  assert.match(await api.ensureWebsiteRoomRates(), /^Chưa đọc lại được giá giờ các phòng \(Phiên đăng nhập đã hết\); dùng bảng giá đọc lúc /);
  assert.strictEqual(api.roomHourlyRate("VIP 1"), 450000, "Đọc lỗi thì giữ bảng cũ");

  // F5: nạp lại bảng đã lưu.
  api.setTable(null);
  await api.loadWebsiteRoomRates();
  assert.strictEqual(api.table().rooms.length, 1);

  // --- Bất biến nguồn -----------------------------------------------------------------
  assert(fn(contentSource, "buildBatchReview").includes("await ensureWebsiteRoomRates()"),
    "Dựng Batch Review phải đọc lại bảng giá giờ khi đã cũ");
  assert(fn(contentSource, "rankIdleRoomsFromMap").includes("roomHourlyRate(room.name, undefined, room.id)"),
    "Chọn phòng phải tra đơn giá theo cả id phòng");
  assert(bridgeSource.includes('detail.action === "readRoomHourlyRates"'), "Bridge phải nhận lệnh readRoomHourlyRates");
  assert(/hourlyRate: formAmount\(fields\.DONGIA\)/.test(fn(bridgeSource, "getOpenFormRoom")) &&
    fn(bridgeSource, "scan").includes("roomRate: openRoom.hourlyRate"), "scan phải trả đơn giá ghi trên phiếu");

  console.log("đơn giá giờ theo phòng đọc từ website: OK");
})().catch(error => { console.error(error); process.exit(1); });
