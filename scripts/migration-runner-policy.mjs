const ownerBootstrapMigrationId = "002";

export function requiredExecutionRole(migrationId) {
  return migrationId.localeCompare(ownerBootstrapMigrationId) > 0
    ? "tge_owner"
    : null;
}

export function assertNoImplicitInitialBaseline(existingInitialRelations) {
  if (existingInitialRelations.length === 0) return;

  throw new Error(
    "Audited baseline required: migration 001 is unapplied, but known 001 "
      + `object(s) already exist: ${existingInitialRelations.join(", ")}. `
      + "Refusing to infer or record migration 001 as applied."
  );
}

export async function setMigrationExecutionRole(client, migration) {
  const role = requiredExecutionRole(migration.id);
  if (!role) return;

  try {
    await client.query(`set local role ${role}`);
  } catch (error) {
    throw new Error(
      `Migration ${migration.fileName} requires SET LOCAL ROLE ${role}; `
        + "the role is unavailable or the migration login lacks membership",
      { cause: error }
    );
  }
}
