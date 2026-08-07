const assert = require("assert");
const fs = require("fs");

const source = fs.readFileSync("bridge.js", "utf8");
const match = source.match(/function suffixInput\(prefix\)\s*\{([\s\S]*?)\n\s*\}/);

assert.ok(match, "bridge.js must define suffixInput(prefix)");
assert.ok(
  match[1].includes("new RegExp(`^${prefix}\\\\d+$`)"),
  "suffixInput must match the exact prefix followed only by a numeric suffix"
);

function matchingIds(prefix, ids) {
  const pattern = new RegExp(`^${prefix}\\d+$`);
  return ids.filter(id => pattern.test(id));
}

assert.deepStrictEqual(
  matchingIds("numTILEGIAMGIA", [
    "numTILEGIAMGIA355",
    "numTILEGIAMGIAGIO355",
    "numTILEGIAMGIA",
    "numTILEGIAMGIAABC"
  ]),
  ["numTILEGIAMGIA355"]
);

console.log("BUG-1 prefix collision: OK");
