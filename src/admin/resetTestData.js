const fs = require("fs");
const path = require("path");

const DATA_DIRS = [
  path.join(
    process.cwd(),
    "data",
    "leads"
  ),

  path.join(
    process.cwd(),
    "data",
    "analytics"
  ),

  path.join(
    process.cwd(),
    "data",
    "dashboard"
  )
];

function removeJsonFiles(directory) {
  if (!fs.existsSync(directory)) {
    return 0;
  }

  const files =
    fs.readdirSync(
      directory
    );

  let removed = 0;

  for (const file of files) {
    if (
      !file.endsWith(".json")
    ) {
      continue;
    }

    const filePath =
      path.join(
        directory,
        file
      );

    fs.unlinkSync(
      filePath
    );

    removed += 1;
  }

  return removed;
}

function resetTestData() {
  let totalRemoved = 0;

  for (
    const directory of DATA_DIRS
  ) {
    const removed =
      removeJsonFiles(
        directory
      );

    totalRemoved +=
      removed;

    console.log(
      `Removed ${removed} JSON file(s) from ${directory}`
    );
  }

  return totalRemoved;
}

if (
  require.main === module
) {
  console.log(`
==========================================
          RESET TEST DATA
==========================================
`);

  const removed =
    resetTestData();

  console.log(`
Removed:
${removed} JSON file(s)

Test data reset complete.
==========================================
`);
}

module.exports = {
  resetTestData
};
