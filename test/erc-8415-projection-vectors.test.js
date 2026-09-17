import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { SyntheticConsumerStateMachine } from "../src/domain/consumer-state-machine.js";

/**
 * The shared ERC-8415 projection vectors, run against Oracle's consumer model.
 *
 * The file is vendored from ERC8415-Kit rather than authored here, matching the
 * architecture `ArtFi → Oracle → ERC8415-Kit → ERC-8415`. Its SHA-256 is pinned
 * in erc-8415/conformance/SOURCE.md and rechecked below, so this copy cannot
 * drift away from the Kit's without failing.
 *
 * Oracle is compatible with ERC-8415, not dedicated to it. What these vectors
 * bind is only the two questions Oracle answers under the standard's own names:
 * who the register confirms for an instant, and whether that answer can still
 * change. Oracle's status model, rights classes and gap shape are its own and
 * are untouched here.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vectorPath = path.join(root, "erc-8415/conformance/projection-vectors.json");
const raw = readFileSync(vectorPath);
const vectors = JSON.parse(raw.toString("utf8"));

const PINNED_SHA256 = readFileSync(path.join(root, "erc-8415/conformance/SOURCE.md"), "utf8")
  .match(/`([0-9a-f]{64})`/)[1];

test("the vendored vector file matches the SHA-256 pinned for it", () => {
  assert.equal(createHash("sha256").update(raw).digest("hex"), PINNED_SHA256);
  assert.equal(vectors.schemaVersion, 1);
});

const build = (entries) => {
  const machine = new SyntheticConsumerStateMachine();
  for (const entry of entries) {
    machine.closeGap("vector-token", { effectiveAt: entry.effectiveAt, holder: entry.holder });
  }
  return machine;
};

for (const testCase of vectors.cases) {
  test(`ERC-8415 vector ${testCase.id}: ${testCase.why}`, () => {
    const machine = build(testCase.entries);
    for (const expectation of testCase.expect) {
      assert.equal(
        machine.isFinalAsOf("vector-token", expectation.instant),
        expectation.final,
        `isFinalAsOf(${expectation.instant})`,
      );
      assert.equal(
        machine.holderAsOf("vector-token", expectation.instant),
        expectation.holder,
        `holderAsOf(${expectation.instant})`,
      );
    }
  });
}

for (const gapCase of vectors.gapCases) {
  test(`ERC-8415 vector ${gapCase.id}: ${gapCase.why}`, () => {
    const machine = build(gapCase.entries);
    machine.openGap("vector-token", { openedAt: gapCase.openedAt ?? gapCase.openGapAt });
    if (gapCase.cancelGap) machine.cancelGap("vector-token");

    for (const expectation of gapCase.expect) {
      assert.equal(
        machine.isFinalAsOf("vector-token", expectation.instant),
        expectation.final,
        `isFinalAsOf(${expectation.instant}) with a gap in play`,
      );
    }

    // The gap really is in the state the case describes, or the assertions
    // above would prove nothing.
    assert.equal(machine.openGapOf("vector-token"), gapCase.cancelGap ? 0 : 1);
  });
}
