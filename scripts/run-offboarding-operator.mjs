#!/usr/bin/env node

import workflowModule from "../src/tenantOffboarding/operatorWorkflow.js";
import adapterModule from "../src/tenantOffboarding/postgresOperatorAdapter.js";

const {
  OffboardingOperatorError,
  createOffboardingOperatorWorkflow,
  parseOperatorArguments,
  readOperatorConfiguration
} = workflowModule;
const { createPostgresOffboardingOperatorAdapter } = adapterModule;

let adapter;
try {
  const input = parseOperatorArguments(process.argv.slice(2));
  const configuration = readOperatorConfiguration(process.env);
  adapter = createPostgresOffboardingOperatorAdapter(configuration);
  const workflow = createOffboardingOperatorWorkflow(adapter);
  const operation = input.command === "request"
    ? workflow.request
    : ["receipt", "inventory"].includes(input.command)
      ? workflow.receipt
      : workflow.inspect;
  const result = await operation(input);
  process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
} catch (error) {
  const code = error instanceof OffboardingOperatorError
    ? error.code
    : "OFFBOARDING_OPERATOR_FAILED";
  process.stderr.write(`${JSON.stringify({ ok: false, error: code })}\n`);
  process.exitCode = 1;
} finally {
  await adapter?.close().catch(() => {});
}
