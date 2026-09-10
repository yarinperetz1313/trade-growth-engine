"use strict";

const { isDeepStrictEqual } = require("node:util");

const {
  PilotEvidenceError,
  conflict,
  isSingletonMilestone,
  publicPilotEvidenceEvent
} = require("./pilotEvidenceDomain");

function createPostgresPilotEvidenceRepository(client, tenantId, subjectId) {
  if (!client || typeof client.query !== "function") {
    throw new TypeError("PostgreSQL pilot evidence requires a transaction client.");
  }

  return Object.freeze({
    async append(event) {
      if (
        event?.tenant_id !== tenantId
        || event?.actor_subject_id !== subjectId
      ) {
        throw new PilotEvidenceError(
          "PILOT_EVIDENCE_UNAVAILABLE",
          "Pilot evidence is unavailable.",
          404
        );
      }
      const inserted = await client.query(
        `insert into tge.pilot_evidence_events (
           tenant_id, id, event_type, actor_subject_id, occurred_at,
           semantic_key, facts, created_at
         ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $5)
         on conflict (tenant_id, semantic_key) do nothing
         returning *`,
        [
          tenantId,
          event.id,
          event.event_type,
          subjectId,
          event.occurred_at,
          event.semantic_key,
          JSON.stringify(event.facts)
        ]
      );
      if (inserted.rows[0]) {
        return {
          record: publicPilotEvidenceEvent(fromRow(inserted.rows[0])),
          duplicate: false,
          created: true
        };
      }
      const selected = await client.query(
        `select * from tge.pilot_evidence_events
         where tenant_id = $1 and semantic_key = $2`,
        [tenantId, event.semantic_key]
      );
      const existing = selected.rows[0] ? fromRow(selected.rows[0]) : null;
      if (
        !existing
        || existing.event_type !== event.event_type
        || (
          !isSingletonMilestone(event.event_type)
          && !isDeepStrictEqual(existing.facts, event.facts)
        )
      ) throw conflict();
      return {
        record: publicPilotEvidenceEvent(existing),
        duplicate: true,
        created: false
      };
    },

    async list() {
      const result = await client.query(
        `select * from tge.pilot_evidence_events
         where tenant_id = $1
         order by occurred_at, id`,
        [tenantId]
      );
      return result.rows.map(row => publicPilotEvidenceEvent(fromRow(row)));
    }
  });
}

function fromRow(row) {
  return {
    tenant_id: row.tenant_id,
    id: row.id,
    event_type: row.event_type,
    actor_subject_id: row.actor_subject_id,
    occurred_at: new Date(row.occurred_at).toISOString(),
    semantic_key: row.semantic_key,
    facts: structuredClone(row.facts)
  };
}

module.exports = {
  createPostgresPilotEvidenceRepository,
  pilotEvidenceFromRow: fromRow
};
