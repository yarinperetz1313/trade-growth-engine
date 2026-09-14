const MAX_BATCH_ID_BYTES = 200;

export function importResumeHash(batchId) {
  if (!validBatchId(batchId)) throw invalidResumePointer();
  const parameters = new URLSearchParams({ batch: batchId });
  return `imports?${parameters.toString()}`;
}

export function parseImportResumeHash(hash) {
  if (typeof hash !== "string") return invalidResult();
  const route = hash.replace(/^#\/?/, "");
  if (route === "imports") return { kind: "NONE", batchId: null };
  if (!route.startsWith("imports?")) return invalidResult();

  const parameters = new URLSearchParams(route.slice("imports?".length));
  if (
    [...parameters.keys()].length !== 1
    || !parameters.has("batch")
    || parameters.getAll("batch").length !== 1
  ) return invalidResult();
  const batchId = parameters.get("batch");
  return validBatchId(batchId)
    ? { kind: "BATCH", batchId }
    : invalidResult();
}

function validBatchId(value) {
  return typeof value === "string"
    && value !== ""
    && value === value.trim()
    && new TextEncoder().encode(value).length <= MAX_BATCH_ID_BYTES
    && !/[\0-\x1f\x7f]/.test(value);
}

function invalidResult() {
  return { kind: "INVALID", batchId: null };
}

function invalidResumePointer() {
  const error = new Error("The import resume pointer is invalid.");
  error.name = "ImportResumeError";
  error.code = "IMPORT_RESUME_POINTER_INVALID";
  return error;
}
