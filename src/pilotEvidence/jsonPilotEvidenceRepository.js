"use strict";

const { isDeepStrictEqual } = require("node:util");
const {
  PilotEvidenceError,
  buildPilotEvidenceEvent,
  conflict,
  isSingletonMilestone,
  publicPilotEvidenceEvent
} = require("./pilotEvidenceDomain");
const { requireTenantContext } = require("../persistence/tenantContext");

function createJsonPilotEvidenceRepository({ store, localTenantId } = {}) {
  if (
    !store
    || typeof store.readCollection !== "function"
    || typeof localTenantId !== "string"
  ) throw new TypeError("JSON pilot evidence requires a store and local tenant ID.");

  function trusted(context) {
    return requireTenantContext(context);
  }

  function read() {
    const records = store.readCollection("pilot_evidence_events");
    if (!Array.isArray(records)) {
      throw persistenceUnavailable();
    }
    return records.map(validatePersistedEvent);
  }

  return Object.freeze({
    async append(context, event) {
      const request = trusted(context);
      if (
        request.tenantId !== localTenantId
        || event?.tenant_id !== request.tenantId
        || event?.actor_subject_id !== request.subjectId
      ) {
        throw new PilotEvidenceError(
          "PILOT_EVIDENCE_UNAVAILABLE",
          "Pilot evidence is unavailable.",
          404
        );
      }
      const records = read();
      const existing = records.find(record =>
        record.tenant_id === request.tenantId
        && record.semantic_key === event.semantic_key
      );
      if (existing) {
        if (
          existing.event_type !== event.event_type
          || (
            !isSingletonMilestone(event.event_type)
            && JSON.stringify(existing.facts) !== JSON.stringify(event.facts)
          )
        ) throw conflict();
        return { record: publicPilotEvidenceEvent(existing), duplicate: true, created: false };
      }
      if (typeof store.writeCollection === "function") {
        store.writeCollection("pilot_evidence_events", [
          ...records,
          structuredClone(event)
        ]);
      } else if (typeof store.createRecord === "function") {
        store.createRecord("pilot_evidence_events", structuredClone(event));
      } else {
        throw new PilotEvidenceError(
          "PILOT_EVIDENCE_PERSISTENCE_UNAVAILABLE",
          "Pilot evidence persistence is unavailable.",
          500
        );
      }
      return { record: publicPilotEvidenceEvent(event), duplicate: false, created: true };
    },

    async list(context) {
      const request = trusted(context);
      if (request.tenantId !== localTenantId) return [];
      return read()
        .filter(record => record.tenant_id === request.tenantId)
        .sort((left, right) =>
          left.occurred_at.localeCompare(right.occurred_at)
          || left.id.localeCompare(right.id)
        )
        .map(record => publicPilotEvidenceEvent(record));
    }
  });
}

function validatePersistedEvent(record) {
  try {
    return rebuildPersistedEvent(record);
  } catch {
    throw persistenceUnavailable();
  }
}

function rebuildPersistedEvent(record) {
  const expectedKeys = [
    "tenant_id", "id", "event_type", "actor_subject_id",
    "occurred_at", "semantic_key", "facts"
  ];
  if (
    !record
    || typeof record !== "object"
    || Array.isArray(record)
    || Object.keys(record).length !== expectedKeys.length
    || !expectedKeys.every(key => Object.hasOwn(record, key))
  ) throw persistenceUnavailable();

  const rebuilt = buildPilotEvidenceEvent({
    eventType: record.event_type,
    facts: record.facts
  }, {
    tenantId: record.tenant_id,
    subjectId: record.actor_subject_id,
    occurredAt: record.occurred_at,
    id: record.id
  });
  if (!isDeepStrictEqual(record, rebuilt)) throw persistenceUnavailable();
  return rebuilt;
}

function persistenceUnavailable() {
  return new PilotEvidenceError(
    "PILOT_EVIDENCE_PERSISTENCE_UNAVAILABLE",
    "Pilot evidence persistence is unavailable.",
    500
  );
}

module.exports = {
  createJsonPilotEvidenceRepository,
  validatePersistedPilotEvidenceEvent: validatePersistedEvent
};
