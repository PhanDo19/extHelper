// Chạy toàn bộ test trong thư mục này.
//   node tests/run-all.js
// Mỗi test là một file độc lập, chạy trong tiến trình riêng để không rò rỉ
// biến toàn cục sang nhau (các module nguồn gắn vào globalThis/window).
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const files = fs
  .readdirSync(__dirname)
  .filter((f) => f.startsWith("test-") && f.endsWith(".js"))
  .sort();

let failed = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, [path.join(__dirname, file)], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    console.log(`PASS  ${file}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${file}`);
    const out = `${err.stdout || ""}${err.stderr || ""}`.trim();
    if (out) console.log(out.split("\n").map((l) => "      " + l).join("\n"));
  }
}

console.log(`\n${files.length - failed}/${files.length} test đã pass`);
process.exit(failed ? 1 : 0);
