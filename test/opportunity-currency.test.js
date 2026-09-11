const assert = require("node:assert/strict");
const test = require("node:test");

const {
  opportunityFromRow,
  opportunityToRow
} = require("../src/persistence/postgres/mappers");
const {
  createPersistence
} = require("../src/persistence/createPersistence");

function opportunity(overrides = {}) {
  return {
    id: "currency-opportunity",
    business_name: "Currency Trade",
    stage: "QUALIFIED",
    value: "1250.5",
    ...overrides
  };
}

function row(overrides = {}) {
  return {
    id: "currency-opportunity",
    business_name: "Currency Trade",
    stage: "QUALIFIED",
    commercial_value: "1250.500000",
    commercial_value_state: "KNOWN",
    commercial_value_raw: 1250.5,
    currency: null,
    metadata: {},
    legacy_payload: {},
    current_payload: {},
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    ...overrides
  };
}

test("PostgreSQL mapping round-trips exact authoritative opportunity currency", () => {
  assert.equal(opportunityToRow(opportunity({ currency: "AUD" })).currency, "AUD");
  assert.equal(opportunityFromRow(row({ currency: "USD" })).currency, "USD");
});

test("missing and null opportunity currency remain truthfully unknown", () => {
  const absent = opportunityToRow(opportunity());
  const explicitNull = opportunityToRow(opportunity({ currency: null }));
  assert.equal(absent.currency, null);
  assert.equal(explicitNull.currency, null);

  const oldRow = opportunityFromRow(row());
  assert.equal(Object.hasOwn(oldRow, "currency"), false);
  const nullRow = opportunityFromRow(row({ current_payload: { currency: null } }));
  assert.equal(Object.hasOwn(nullRow, "currency"), true);
  assert.equal(nullRow.currency, null);
});

test("persistence rejects noncanonical or non-lossless supplied currency", () => {
  for (const currency of ["aud", " AUD", "AUD ", "A$", "US", "USDA", 123, true, {}]) {
    assert.throws(
      () => opportunityToRow(opportunity({ currency })),
      error => error?.code === "OPPORTUNITY_CURRENCY_INVALID"
        && error?.field === "currency",
      String(currency)
    );
  }
});

test("modeled currency does not consume unrelated JSON-compatible fields", () => {
  const mapped = opportunityToRow(opportunity({
    currency: "NZD",
    unknown_currency_note: { source: "legacy", raw: "keep-me" }
  }));
  assert.equal(mapped.currency, "NZD");
  assert.equal(Object.hasOwn(mapped.current_payload, "currency"), false);
  assert.deepEqual(mapped.current_payload.unknown_currency_note, {
    source: "legacy",
    raw: "keep-me"
  });
});

test("JSON persistence keeps old unknown records and rejects malformed new currency", async () => {
  const records = [
    { id: "old-missing", value: 10, preserved: { raw: true } },
    { id: "old-null", value: 20, currency: null }
  ];
  const store = {
    readCollection: () => records,
    findRecord: (_name, id) => records.find(record => record.id === id) || null,
    createRecord: (_name, record) => {
      records.push({ ...record });
      return records.at(-1);
    },
    updateRecord: (_name, id, changes) => {
      const index = records.findIndex(record => record.id === id);
      records[index] = { ...records[index], ...changes };
      return records[index];
    },
    deleteRecord: () => false
  };
  const repository = createPersistence({ adapter: "json", store })
    .repositories.opportunities;

  assert.deepEqual(await repository.list(), records);
  const inserted = await repository.insert({
    id: "known",
    value: 30,
    currency: "GBP",
    preserved: "keep"
  });
  assert.equal(inserted.currency, "GBP");
  await assert.rejects(
    repository.update("known", { currency: "gbp" }),
    error => error?.code === "OPPORTUNITY_CURRENCY_INVALID"
  );
  assert.equal((await repository.findById("known")).currency, "GBP");
  assert.deepEqual((await repository.findById("old-missing")).preserved, {
    raw: true
  });
  assert.equal(
    Object.hasOwn(await repository.findById("old-missing"), "currency"),
    false
  );
});
