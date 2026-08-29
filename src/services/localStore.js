const crypto = require('crypto');
const fs = require("fs");
const path = require("path");

function getDataDir() {
  return (
    process.env.LOCAL_STORE_DIR ||
    path.join(
      process.cwd(),
      "data"
    )
  );
}

function ensureDataDir() {
  fs.mkdirSync(
    getDataDir(),
    {
      recursive: true
    }
  );
}

function filePath(
  collection
) {
  return path.join(
    getDataDir(),
    `${collection}.json`
  );
}

function readCollection(
  collection
) {
  ensureDataDir();

  const file =
    filePath(collection);

  if (!fs.existsSync(file)) {
    fs.writeFileSync(
      file,
      "[]\n"
    );
  }

  return JSON.parse(
    fs.readFileSync(
      file,
      "utf8"
    )
  );
}

function readCollectionReadOnly(
  collection
) {
  const file =
    filePath(collection);

  if (!fs.existsSync(file)) {
    return [];
  }

  return JSON.parse(
    fs.readFileSync(
      file,
      "utf8"
    )
  );
}

function writeCollection(
  collection,
  data
) {
  ensureDataDir();

  fs.writeFileSync(
    filePath(collection),
    JSON.stringify(
      data,
      null,
      2
    ) + "\n"
  );

  return data;
}

function createRecord(
  collection,
  record
) {
  const records =
    readCollection(
      collection
    );

  const newRecord = {
    id:
      crypto.randomUUID(),

    created_at:
      new Date().toISOString(),

    updated_at:
      new Date().toISOString(),

    ...record
  };

  records.push(
    newRecord
  );

  writeCollection(
    collection,
    records
  );

  return newRecord;
}

function updateRecord(
  collection,
  id,
  updates
) {
  const records =
    readCollection(
      collection
    );

  const index =
    records.findIndex(
      record =>
        record.id === id
    );

  if (index === -1) {
    return null;
  }

  records[index] = {
    ...records[index],

    ...updates,

    updated_at:
      new Date().toISOString()
  };

  writeCollection(
    collection,
    records
  );

  return records[index];
}

function findRecord(
  collection,
  id
) {
  const records =
    readCollection(
      collection
    );

  return (
    records.find(
      record =>
        record.id === id
    ) || null
  );
}

function deleteRecord(
  collection,
  id
) {
  const records =
    readCollection(
      collection
    );

  const filtered =
    records.filter(
      record =>
        record.id !== id
    );

  if (
    filtered.length ===
    records.length
  ) {
    return false;
  }

  writeCollection(
    collection,
    filtered
  );

  return true;
}

module.exports = {
  readCollection,
  readCollectionReadOnly,
  writeCollection,
  createRecord,
  updateRecord,
  findRecord,
  deleteRecord,
  getDataDir
};
