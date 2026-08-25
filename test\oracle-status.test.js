import assert from "node:assert/strict";
import test from "node:test";
import { ORACLE_STATUSES, isOracleStatus } from "../src/domain/oracle-status.js";

test("exports exactly the PRD public statuses", () => {
  assert.deepEqual(ORACLE_STATUSES, [
    "VALID",
    "INVALID",
    "TRANSFER_PENDING",
    "FROZEN",
    "REVOKED",
    "EXPIRED",
    "REVIEW_REQUIRED",
    "NOT_VERIFIED",
  ]);
});

test("rejects unknown status values", () => {
  assert.equal(isOracleStatus("ACTIVE"), false);
  assert.equal(isOracleStatus("VALID"), true);
});

