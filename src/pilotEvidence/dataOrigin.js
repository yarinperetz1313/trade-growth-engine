"use strict";

function classifyOpportunityDataOrigin(opportunity) {
  if (opportunity?.metadata?.data_origin === "SAMPLE_DEMO") {
    return Object.freeze({ kind: "SAMPLE_DEMO", importBatchId: null });
  }
  const imported = opportunity?.metadata?.import;
  if (
    validId(imported?.batch_id, 200)
    && validId(imported?.source_system, 128)
    && validId(imported?.source_record_id, 512)
    && /^[0-9a-f]{64}$/.test(imported?.raw_payload_sha256 || "")
  ) {
    return Object.freeze({
      kind: "IMPORTED_CUSTOMER",
      importBatchId: imported.batch_id
    });
  }
  return Object.freeze({ kind: "EXISTING_CUSTOMER", importBatchId: null });
}

function validId(value, maximumBytes) {
  return typeof value === "string"
    && value !== ""
    && value === value.trim()
    && Buffer.byteLength(value, "utf8") <= maximumBytes;
}

module.exports = { classifyOpportunityDataOrigin };
