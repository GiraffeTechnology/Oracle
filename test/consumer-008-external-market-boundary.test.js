import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * CONSUMER-008 requires proving an absence: no order book, matching, counterparty or
 * fund-control path exists, and external market events can only raise a pending T+0 intent.
 *
 * config/prd-v0.4-acceptance.json previously bound CONSUMER-008 to
 * "CONSUMER-004 and CONSUMER-009 fail closed without a verified attestation", which
 * establishes attestation fail-closed and pending-state operation blocking — not absence.
 * An absence claim needs a test that would fail if the capability were added, which is what
 * this file provides.
 */

const SOURCE_ROOT = path.resolve(import.meta.dirname, "..", "src");

function sourceFiles(directory) {
  const found = [];
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) found.push(...sourceFiles(full));
    else if (entry.endsWith(".js") || entry.endsWith(".ts")) found.push(full);
  }
  return found;
}

/**
 * Identifier-shaped patterns, not prose. "matching warehouse identities" is ordinary English
 * and must not trip this; `matchOrders` or `orderBook` must.
 */
const FORBIDDEN_CAPABILITIES = [
  { label: "order book", pattern: /\border_?book\b/i },
  { label: "order matching engine", pattern: /\b(match_?orders|matching_?engine|order_?match)\b/i },
  { label: "counterparty role", pattern: /\bcounterparty\b/i },
  { label: "fund movement", pattern: /\b(transfer_?funds|settle_?funds|disburse|payout|escrow)\b/i },
  { label: "custody of funds", pattern: /\b(custody_?account|funds_?custody|client_?funds)\b/i },
];

/** Route path fragments that would indicate a trading or payment surface. */
const FORBIDDEN_ROUTE_FRAGMENTS = ["/order", "/match", "/trade", "/funds", "/payment", "/payout"];

test("CONSUMER-008 exposes no order book, matching, counterparty or fund-control capability", () => {
  const violations = [];
  for (const file of sourceFiles(SOURCE_ROOT)) {
    const contents = readFileSync(file, "utf8");
    contents.split("\n").forEach((line, index) => {
      for (const { label, pattern } of FORBIDDEN_CAPABILITIES) {
        if (pattern.test(line)) {
          violations.push(`${path.relative(SOURCE_ROOT, file)}:${index + 1}: ${label}`);
        }
      }
    });
  }
  assert.deepEqual(violations, [], `CONSUMER-008 forbids these capabilities:\n${violations.join("\n")}`);
});

test("CONSUMER-008 declares no trading or payment route", () => {
  const app = readFileSync(path.join(SOURCE_ROOT, "app.js"), "utf8");
  const declared = [...app.matchAll(/pathname === "([^"]+)"/g)].map((match) => match[1]);
  assert.ok(declared.length > 0, "no route literals parsed; the assertion would pass vacuously");

  const offending = declared.filter((route) =>
    FORBIDDEN_ROUTE_FRAGMENTS.some((fragment) => route.toLowerCase().includes(fragment)),
  );
  assert.deepEqual(offending, [], `CONSUMER-008 forbids trading or payment routes: ${offending.join(", ")}`);
});
