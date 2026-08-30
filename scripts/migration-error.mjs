const safeDiagnosticFields = Object.freeze([
  "code",
  "severity",
  "detail",
  "hint",
  "schema",
  "table",
  "constraint",
  "routine",
  "position"
]);

export function createMigrationError(cause, migration) {
  const diagnostic = findPostgresDiagnostic(cause);
  const code = safeDiagnosticValue(diagnostic?.code);
  const message = safeDiagnosticValue(diagnostic?.message)
    ?? safeDiagnosticValue(cause?.message)
    ?? "Unknown PostgreSQL error";
  const codeContext = code ? ` [${code}]` : "";
  const error = new Error(
    `Migration ${migration.fileName} failed${codeContext}: ${message}`,
    { cause }
  );

  error.name = "MigrationError";
  error.migration = {
    id: migration.id,
    fileName: migration.fileName
  };

  for (const field of safeDiagnosticFields) {
    const value = safeDiagnosticValue(diagnostic?.[field]);
    if (value !== undefined) error[field] = value;
  }

  const migrationLine = computeMigrationLine(migration.sql, error.position);
  if (migrationLine !== undefined) error.migrationLine = migrationLine;

  error.context = {
    fileName: migration.fileName,
    ...(migrationLine === undefined ? {} : { line: migrationLine }),
    ...(error.position === undefined ? {} : { position: error.position })
  };

  return error;
}

function findPostgresDiagnostic(error) {
  let current = error;
  while (current) {
    if (safeDiagnosticValue(current.code) !== undefined) return current;
    current = current.cause;
  }
  return error;
}

function safeDiagnosticValue(value) {
  return typeof value === "string" || typeof value === "number"
    ? value
    : undefined;
}

function computeMigrationLine(sql, position) {
  if (typeof sql !== "string") return undefined;

  const parsedPosition = Number.parseInt(position, 10);
  if (!Number.isInteger(parsedPosition)
    || parsedPosition < 1
    || parsedPosition > sql.length + 1) {
    return undefined;
  }

  return sql.slice(0, parsedPosition - 1).split("\n").length;
}
