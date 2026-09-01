const localStore = require("../services/localStore");

function createJsonRepositories({ store = localStore } = {}) {
  const collection = (name, { immutable = false, order, filters = {} } = {}) => ({
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
        return store.createRecord(name, record);
      },
      async update(contextOrId, idOrChanges, maybeChanges) {
        const id = maybeChanges === undefined ? contextOrId : idOrChanges;
        const changes = maybeChanges === undefined ? idOrChanges : maybeChanges;
        return store.updateRecord(name, id, changes);
      },
      async delete(contextOrId, maybeId) {
        const id = maybeId === undefined ? contextOrId : maybeId;
        return store.deleteRecord(name, id);
      }
    } : {})
  });

  return {
    prospects: collection("prospects"),
    opportunities: collection("opportunities", {
      filters: { prospectId: "prospect_id", stage: "stage" }
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
    })
  };
}

module.exports = {
  createJsonRepositories
};
