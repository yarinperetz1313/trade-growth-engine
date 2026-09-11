const localStore = require("../services/localStore");
const {
  createJsonRevenueLeakCaseRepository,
  LOCAL_REVENUE_LEAK_TENANT_ID
} = require("../revenueLeakCases/jsonRevenueLeakCaseRepository");
const {
  createJsonPilotEvidenceRepository
} = require("../pilotEvidence/jsonPilotEvidenceRepository");
const {
  assertOpportunityCurrency
} = require("../opportunities/opportunityCurrency");

function createJsonRepositories({ store = localStore } = {}) {
  const collection = (
    name,
    { immutable = false, order, filters = {}, validateChanges } = {}
  ) => ({
    async list(contextOrFilters, maybeFilters) {
      const requestedFilters = maybeFilters === undefined
        ? contextOrFilters || {}
        : maybeFilters || {};
      let records = store.readCollection(name);
      for (const [filterName, recordField] of Object.entries(filters)) {
        if (requestedFilters[filterName] === undefined) continue;
        records = records.filter(
          record => record[recordField] === requestedFilters[filterName]
        );
      }
      return order ? [...records].sort(order) : records;
    },
    async findById(contextOrId, maybeId) {
      const id = maybeId === undefined ? contextOrId : maybeId;
      return store.findRecord(name, id);
    },
    ...(!immutable ? {
      async insert(contextOrRecord, maybeRecord) {
        const record = maybeRecord === undefined ? contextOrRecord : maybeRecord;
        validateChanges?.(record);
        return store.createRecord(name, record);
      },
      async update(contextOrId, idOrChanges, maybeChanges) {
        const id = maybeChanges === undefined ? contextOrId : idOrChanges;
        const changes = maybeChanges === undefined ? idOrChanges : maybeChanges;
        validateChanges?.(changes);
        return store.updateRecord(name, id, changes);
      },
      async delete(contextOrId, maybeId) {
        const id = maybeId === undefined ? contextOrId : maybeId;
        return store.deleteRecord(name, id);
      }
    } : {})
  });

  const repositories = {
    prospects: collection("prospects"),
    opportunities: collection("opportunities", {
      filters: { prospectId: "prospect_id", stage: "stage" },
      validateChanges(record) {
        if (Object.hasOwn(record, "currency")) {
          assertOpportunityCurrency(record.currency);
        }
      }
    }),
    tasks: collection("tasks", {
      filters: { opportunityId: "opportunity_id", status: "status" }
    }),
    activities: collection("activities", {
      filters: { opportunityId: "opportunity_id", prospectId: "prospect_id" }
    }),
    revenueActions: collection("revenue_actions", {
      immutable: true,
      filters: { opportunityId: "opportunity_id", status: "status" },
      order: (left, right) =>
        String(right.created_at).localeCompare(String(left.created_at))
    }),
    revenueLeakCases: createJsonRevenueLeakCaseRepository({ store }),
    pilotEvidence: createJsonPilotEvidenceRepository({
      store,
      localTenantId: LOCAL_REVENUE_LEAK_TENANT_ID
    })
  };
  repositories.opportunities.listForStalledScan = async ({ limit } = {}) => {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new TypeError("A positive stalled-opportunity scan limit is required.");
    }
    const records = store.readCollection("opportunities")
      .map((record, ordinal) => ({ record, ordinal }))
      .sort((left, right) => {
        const leftId = typeof left.record?.id === "string" ? left.record.id : "\uffff";
        const rightId = typeof right.record?.id === "string" ? right.record.id : "\uffff";
        return leftId.localeCompare(rightId) || left.ordinal - right.ordinal;
      })
      .map(item => item.record);
    return {
      records: records.slice(0, limit),
      totalCount: records.length
    };
  };
  return repositories;
}

module.exports = {
  createJsonRepositories
};
