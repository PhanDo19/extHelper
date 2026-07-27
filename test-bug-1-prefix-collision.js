// Test BUG-1: suffixInput should match exact id patterns to avoid prefix collision
// Example: "numTILEGIAMGIA123" vs "numTILEGIAMGIAGIO456"

(function () {
  "use strict";

  // Simulate the fixed suffixInput function
  function suffixInput(prefix) {
    const pattern = new RegExp(`^${prefix}\\d+$`);
    const candidates = Array.from(document.querySelectorAll(`[id^="${prefix}"]`)).filter(el => pattern.test(el.id));
    return candidates.find(isVisible) || candidates.reverse().find(input => input.isConnected) || null;
  }

  function isVisible(element) {
    if (!element || !element.isConnected) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0 || rect.width <= 0 || rect.height <= 0) return false;
    return true;
  }

  // Create mock DOM with colliding prefixes
  const testDiv = document.createElement("div");
  const input1 = document.createElement("input");
  input1.id = "numTILEGIAMGIA355";
  input1.value = "100";
  input1.style.display = "block";

  const input2 = document.createElement("input");
  input2.id = "numTILEGIAMGIAGIO355";
  input2.value = "200";
  input2.style.display = "block";

  testDiv.appendChild(input1);
  testDiv.appendChild(input2);
  document.body.appendChild(testDiv);

  try {
    // Test: suffixInput("numTILEGIAMGIA") should find input1, NOT input2
    const result = suffixInput("numTILEGIAMGIA");
    const pass = result === input1;

    console.log(`BUG-1 test: ${pass ? "OK" : "FAIL"}`);
    if (!pass) {
      console.error(`  Expected id="numTILEGIAMGIA355", got id="${result?.id || 'null'}"`);
    }

    // Cleanup
    document.body.removeChild(testDiv);
  } catch (error) {
    console.error("BUG-1 test: ERROR -", error.message);
    if (testDiv.parentElement) document.body.removeChild(testDiv);
  }
})();
