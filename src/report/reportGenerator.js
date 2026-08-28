const fs = require("fs");
const path = require("path");

const REPORT_DIR = path.join(
  process.cwd(),
  "data",
  "reports"
);

function ensureReportDirectory() {
  fs.mkdirSync(REPORT_DIR, {
    recursive: true
  });
}

function timestamp() {
  return new Date()
    .toISOString()
    .replace(/[:.]/g, "-");
}

function saveReport(report) {
  ensureReportDirectory();

  const filename =
    `opportunity-report-${timestamp()}.json`;

  const filepath =
    path.join(REPORT_DIR, filename);

  fs.writeFileSync(
    filepath,
    JSON.stringify(report, null, 2),
    "utf8"
  );

  return filepath;
}

function loadLatestReport() {
  ensureReportDirectory();

  const files = fs
    .readdirSync(REPORT_DIR)
    .filter(file =>
      file.startsWith("opportunity-report-") &&
      file.endsWith(".json")
    )
    .sort()
    .reverse();

  if (files.length === 0) {
    return null;
  }

  const filepath =
    path.join(REPORT_DIR, files[0]);

  try {
    return JSON.parse(
      fs.readFileSync(filepath, "utf8")
    );
  } catch {
    return null;
  }
}

module.exports = {
  saveReport,
  loadLatestReport
};
