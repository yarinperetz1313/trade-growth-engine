export const IMPORT_CSV_MAX_BYTES = 256 * 1024;

export async function readImportFileAsBase64(file) {
  if (!file || !Number.isSafeInteger(file.size) || file.size < 0) {
    throw importFileError(
      "CSV_UPLOAD_INVALID",
      "A readable CSV upload is required.",
      400
    );
  }
  if (file.size > IMPORT_CSV_MAX_BYTES) {
    throw importFileError(
      "CSV_FILE_LIMIT_EXCEEDED",
      "The CSV upload exceeds the byte limit.",
      413
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function importFileError(code, message, status) {
  const error = new Error(message);
  error.name = "ImportFileError";
  error.code = code;
  error.status = status;
  return error;
}
