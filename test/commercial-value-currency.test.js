const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const formatter = import("../web/lib/commercialValue.js");

test("browser formats only explicit canonical opportunity currency", async () => {
  const { formatCommercialValue } = await formatter;
  assert.equal(formatCommercialValue("1250.5", "AUD"), "AUD 1,250.5");
  assert.equal(
    formatCommercialValue("1250.5", null),
    "1,250.5 · Currency unknown"
  );
  assert.equal(
    formatCommercialValue("1250.5", undefined),
    "1,250.5 · Currency unknown"
  );
  assert.equal(formatCommercialValue("1250.5", "aud"), "Unknown");
  assert.equal(formatCommercialValue("1250.5", " AUD "), "Unknown");
  assert.equal(
    formatCommercialValue("99999999999999.999999", "NZD"),
    "NZD 99,999,999,999,999.999999"
  );
});

test("unknown commercial amounts stay unknown regardless of currency", async () => {
  const { formatCommercialValue } = await formatter;
  for (const value of [undefined, null, "", "unknown", 0]) {
    assert.equal(formatCommercialValue(value, "AUD"), "Unknown");
  }
});

test("opportunity-specific browser projections pass authoritative currency explicitly", () => {
  const main = fs.readFileSync(path.join(process.cwd(), "web/main.jsx"), "utf8");

  assert.match(main, /money\(\s*item\.value,\s*item\.currency\s*\)/);
  assert.match(
    main,
    /money\(\s*biggestOpportunity\?\.value,\s*biggestOpportunity\?\.currency\s*\)/
  );
  assert.match(
    main,
    /money\(\s*opportunity\.value,\s*opportunity\.currency\s*\)/
  );
});

test("opportunity route changes clear the unsaved currency draft", () => {
  const component = fs.readFileSync(
    path.join(process.cwd(), "web/components/OpportunityCommandCenter.jsx"),
    "utf8"
  );
  const routeEffect = component.match(
    /useEffect\(\(\) => \{[\s\S]*?\}, \[opportunity\.id\]\);/
  )?.[0];

  assert.ok(routeEffect);
  assert.match(routeEffect, /setCurrency\(""\)/);
});
