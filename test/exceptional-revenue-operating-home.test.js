import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = await readFile(new URL("../web/main.jsx", import.meta.url), "utf8");
const queueSource = await readFile(
  new URL("../web/components/RevenueCommandCenter.jsx", import.meta.url),
  "utf8"
);
const actionSource = await readFile(
  new URL("../web/components/OpportunityCommandCenter.jsx", import.meta.url),
  "utf8"
);
const stylesSource = await readFile(new URL("../web/styles.css", import.meta.url), "utf8");
const commandCenterStyles = await readFile(new URL("../web/main.css", import.meta.url), "utf8");
const importSource = await readFile(
  new URL("../web/components/ImportWorkspace.jsx", import.meta.url),
  "utf8"
);

test("revenue attention is the default operating home with unambiguous navigation", () => {
  assert.match(mainSource, /\["opportunities", "Revenue attention"\]/);
  assert.match(mainSource, /\["all-opportunities", "All opportunities"\]/);
  assert.match(mainSource, /\["dashboard", "Pipeline overview"\]/);
  assert.match(mainSource, /:\s*"opportunities";\s*\n}/);
  assert.doesNotMatch(mainSource, /if \(page === "dashboard"\) return "Command Center"/);
});

test("the revenue attention queue and complete portfolio are separate destinations", () => {
  assert.match(mainSource, /page === "opportunities"[\s\S]*<RevenueAttention/);
  assert.match(mainSource, /page === "all-opportunities"[\s\S]*<AllOpportunities/);
  assert.match(mainSource, /if \(view === "attention"\) return \([\s\S]*?<RevenueCommandCenter/);
  assert.match(mainSource, /function AllOpportunities\(\)[\s\S]*view="portfolio"/);
  assert.doesNotMatch(mainSource, /<RevenueCommandCenter[\s\S]*Opportunity Intelligence/);
});

test("the strongest customer case precedes optional filters in queue composition", () => {
  const customerGroup = queueSource.indexOf('aria-label="Priority customer review"');
  const filters = queueSource.indexOf('aria-label="Filter revenue attention"');
  assert.ok(customerGroup >= 0, "priority customer review should remain present");
  assert.ok(filters > customerGroup, "filters should follow the strongest customer case");
  assert.match(queueSource, /<details[^>]*className="rcc2-filter-disclosure"/);
});

test("focused action settles on a sticky-header-safe workflow anchor", () => {
  assert.match(actionSource, /data-focus-anchor="revenue-action-workflow"/);
  assert.match(actionSource, /scrollMarginTop/);
  assert.match(actionSource, /requestAnimationFrame/);
  assert.match(commandCenterStyles, /\.oc-revenue-action-execution[\s\S]*scroll-margin-top/);
});

test("all opportunities use labelled task-oriented cards whenever the content width cannot hold the desktop grid", () => {
  assert.match(mainSource, /className="opportunity-portfolio-card"/);
  assert.match(mainSource, /className="opportunity-portfolio-fact"/);
  assert.match(mainSource, />Commercial value</);
  assert.match(mainSource, />Probability</);
  assert.match(stylesSource, /@media \(max-width: 1120px\)[\s\S]*\.opportunity-portfolio/);
  assert.match(stylesSource, /\.opportunity-portfolio-fact small \{[\s\S]*clip-path: inset\(50%\)/);
  assert.match(stylesSource, /@media \(max-width: 1120px\)[\s\S]*\.opportunity-portfolio-fact small \{[\s\S]*clip-path: none/);
  assert.doesNotMatch(stylesSource, /\.opportunity-table-header,[\s\S]*min-width: 720px/);
});

test("durable queue evidence and an explicit scan refresh have distinct truthful copy", () => {
  assert.match(queueSource, /DURABLE REVENUE ATTENTION/);
  assert.match(queueSource, /These cases come from the last validated queue read/);
  assert.match(queueSource, /Refresh current evidence/);
  assert.match(queueSource, /checks current canonical evidence/);
  assert.doesNotMatch(queueSource, /This runs only when you choose it\. It reviews recorded evidence and refreshes the durable case queue\./);
});

test("usable customer truth stays primary when optional Pilot instrumentation is unavailable", () => {
  const customerGroup = queueSource.indexOf('aria-label="Priority customer review"');
  const diagnostics = queueSource.lastIndexOf("<PilotInstrumentationDiagnostics");
  assert.ok(customerGroup >= 0);
  assert.ok(diagnostics > customerGroup);
  assert.match(queueSource, /<details[^>]*className="rcc2-pilot-diagnostics"/);
  assert.doesNotMatch(queueSource, /\{pilotError && \(\s*<div className="rcc2-alert" role="alert">/);
  assert.match(queueSource, /Customer queue and Operational Data Health remain authoritative/);
});

test("committed import arrival is bounded context and server reads remain authoritative", () => {
  assert.match(mainSource, /importArrivalContext/);
  assert.match(queueSource, /aria-label="Committed import arrival context"/);
  assert.match(queueSource, /server-authoritative readiness and durable queue truth/);
  assert.match(importSource, /buildImportArrivalContext/);
  assert.doesNotMatch(mainSource + importSource, /localStorage|sessionStorage/);
  assert.doesNotMatch(mainSource, /URLSearchParams[\s\S]{0,180}committedCount/);
});

test("focused Opportunity Action defers route-irrelevant intelligence under disclosures", () => {
  assert.match(actionSource, /focusRevenueAction \? "oc-page focused-action"/);
  assert.match(actionSource, /Return to Revenue attention/);
  assert.match(actionSource, /aria-label="General opportunity intelligence"/);
  assert.match(actionSource, /Inspect general opportunity intelligence/);
  assert.match(actionSource, /aria-label="Additional opportunity context"/);
  assert.match(actionSource, /Inspect additional opportunity context/);
  assert.match(commandCenterStyles, /\.oc-page\.focused-action/);
});

test("empty and partial outcomes describe assessed counts, limitations, and truthful next steps", () => {
  assert.match(queueSource, /Assessed · no leak/);
  assert.match(queueSource, /Evidence limitations/);
  assert.match(queueSource, /No opportunity evidence was available to scan/);
  assert.match(queueSource, /No credible stalled-opportunity case found/);
  assert.match(queueSource, /Unknown is not zero/);
  assert.match(queueSource, /Next truthful step/);
  assert.doesNotMatch(queueSource, /revenue recovered|recovered revenue achieved|successful recovery/i);
});
