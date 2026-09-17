import assert from "node:assert/strict";
import test from "node:test";

import { buildImportArrivalContext } from "../web/lib/importArrivalContext.mjs";

test("committed import arrival keeps only bounded non-authoritative presentation context", () => {
  assert.deepEqual(buildImportArrivalContext({
    batch: { id: "private-batch-id" },
    summary: { committed: 3, skipped: 1, failed: 0 }
  }, {
    source_collection: "opportunities",
    committed_count: 3,
    source_system: "operator-crm"
  }), {
    committedCount: 3,
    sourceLabel: "Opportunity export"
  });
});

test("invalid or incomplete arrival context is discarded instead of becoming truth", () => {
  assert.equal(buildImportArrivalContext({ summary: { committed: -1 } }, {
    source_collection: "opportunities"
  }), null);
  assert.equal(buildImportArrivalContext({ summary: { committed: 2 } }, {
    source_collection: "tasks"
  }), null);
  assert.equal(buildImportArrivalContext(null, null), null);
});
