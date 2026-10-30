import assert from "node:assert/strict";
import test from "node:test";

import { SyntheticConsumerStateMachine } from "../src/domain/consumer-state-machine.js";

/**
 * ERC-8415 conformance for the one accessor Oracle borrows from the standard by name.
 *
 * Oracle is not an ERC-8415-only project; it is compatible with it. What that compatibility
 * requires is that where Oracle answers a question the standard defines, it answers the
 * standard's way. `isFinalAsOf` is such a question, and the PRD already states the rule the
 * same way (§ "whether that moment is final": whether a later register entry could still change the answer).
 *
 * These tests exist because both properties below regressed once: an instant preceding the
 * first entry was reported final, and an open gap was folded into the answer.
 */

const entries = (machine, tokenRef, ...points) => {
  for (const [effectiveAt, holder] of points) machine.closeGap(tokenRef, { effectiveAt, holder });
  return machine;
};

test("ERC-8415 finality is the half-open interval between the first and latest entry", () => {
  const machine = entries(new SyntheticConsumerStateMachine(), "t", [100, "A"], [200, "B"]);

  // Below the first entry the projection says nothing, so nothing is final there.
  assert.equal(machine.isFinalAsOf("t", 0), false);
  assert.equal(machine.isFinalAsOf("t", 99), false);

  // [100, 200) is closed by a later entry and therefore final.
  assert.equal(machine.isFinalAsOf("t", 100), true, "at first.effectiveAt");
  assert.equal(machine.isFinalAsOf("t", 150), true, "inside the closed interval");
  assert.equal(machine.isFinalAsOf("t", 199), true, "up to but excluding the latest entry");

  // The latest interval stays open-ended: a later entry can still cover it.
  assert.equal(machine.isFinalAsOf("t", 200), false, "at latest.effectiveAt");
  assert.equal(machine.isFinalAsOf("t", 10_000), false, "beyond the latest entry");
});

test("ERC-8415 finality does not depend on whether a gap is open", () => {
  const machine = entries(new SyntheticConsumerStateMachine(), "t", [100, "A"], [200, "B"]);
  const before = [50, 100, 150, 200].map((instant) => machine.isFinalAsOf("t", instant));

  machine.openGap("t", { openedAt: 120 });
  const during = [50, 100, 150, 200].map((instant) => machine.isFinalAsOf("t", instant));

  // A gap says what is expected, not what can still arrive. Opening one changes no answer.
  assert.deepEqual(during, before);
  assert.equal(machine.isFinalAsOf("t", 150), true, "an open gap covering the instant changes nothing");
  assert.equal(machine.openGapOf("t"), 1, "the gap really is open, or this proves nothing");
});

test("cancelling a gap admits nothing, so it makes no instant final", () => {
  const machine = new SyntheticConsumerStateMachine();
  machine.openGap("t", { openedAt: 300 });
  machine.cancelGap("t");

  // CONSUMER-006. This follows from the rule rather than being special-cased: cancelling
  // appends no entry, so there is still no interval closed behind anything.
  assert.equal(machine.openGapOf("t"), 0);
  assert.equal(machine.isFinalAsOf("t", 300), false);
  assert.equal(machine.holderAsOf("t", 300), null);
});

test("a single entry closes no interval, so no instant is final yet", () => {
  const machine = entries(new SyntheticConsumerStateMachine(), "t", [100, "A"]);
  assert.equal(machine.holderAsOf("t", 150), "A", "the holder resolves");
  assert.equal(machine.isFinalAsOf("t", 150), false, "but provisionally");
  assert.equal(machine.isFinalAsOf("t", 100), false);
});

test("a confirming entry finalises the earlier interval without changing the holder", () => {
  const machine = entries(new SyntheticConsumerStateMachine(), "t", [100, "A"]);
  assert.equal(machine.isFinalAsOf("t", 150), false);

  machine.closeGap("t", { effectiveAt: 300, holder: "A" });

  assert.equal(machine.holderAsOf("t", 150), "A", "the holder never moved");
  assert.equal(machine.isFinalAsOf("t", 150), true, "and the interval is now closed behind it");
});

test("isFinalAsOf answers rather than throwing for an uncovered instant or unknown token", () => {
  const machine = entries(new SyntheticConsumerStateMachine(), "t", [100, "A"], [200, "B"]);
  assert.equal(machine.isFinalAsOf("t", 1), false);
  assert.equal(machine.isFinalAsOf("unknown-token", 150), false);
});

/**
 * CONSUMER-007 is "final AND no open gap". Keeping the gap out of isFinalAsOf does not weaken
 * it: the conjunction lives at the exercise, which checks the gap separately.
 */
test("CONSUMER-007 still refuses a perishable exercise while a gap is open", () => {
  const machine = new SyntheticConsumerStateMachine();
  const attestation = { attestationId: "a" };
  const accept = () => true;
  machine.transition({ tokenRef: "t", to: "VERIFIED", attestation, verify: accept });
  machine.transition({ tokenRef: "t", to: "ACTIVE", attestation, verify: accept });
  entries(machine, "t", [10, "wallet-a"], [20, "wallet-b"]);

  assert.throws(
    () => machine.assertOperationAllowed("t", "redeem", { instant: 10 }),
    /CONSUMER_REDEMPTION_EXERCISER_REQUIRED/,
  );
  assert.throws(
    () => machine.assertOperationAllowed("t", "redeem", { instant: 10, exerciser: "wallet-b" }),
    /CONSUMER_REDEMPTION_HOLDER_MISMATCH/,
  );
  assert.equal(machine.assertOperationAllowed("t", "redeem", { instant: 10, exerciser: "wallet-a" }), true);

  machine.openGap("t", { openedAt: 5 });
  // The instant is final by the standard's rule, and the exercise is still refused.
  assert.equal(machine.isFinalAsOf("t", 10), true);
  assert.throws(
    () => machine.assertOperationAllowed("t", "redeem", { instant: 10, exerciser: "wallet-a" }),
    /CONSUMER_PERISHABLE_GAP_OPEN:redeem/,
  );
  assert.equal(machine.assertOperationAllowed("t", "transfer"), true, "and transfer is never refused");
});
