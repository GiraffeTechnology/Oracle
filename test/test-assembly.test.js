import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { assembleIsolatedTestApplication } from "../src/config/test-assembly.js";

const config = loadConfig({ GIRAFFE_ORACLE_ENV: "test" });

test("isolated test assembly is rejected outside test environment", () => {
  assert.throws(() => assembleIsolatedTestApplication({ config: loadConfig({}) }), /TEST_ASSEMBLY_ENVIRONMENT_REJECTED/);
});

test("test admin authentication stays disabled without the exact acknowledgement", async () => {
  const assembly = assembleIsolatedTestApplication({ config, env: {} });
  assert.equal(await assembly.authenticateAdmin({ headers: { "x-oracle-test-actor": "auditor-test" } }), null);
});

test("test assembly accepts only fixed test actor aliases after acknowledgement", async () => {
  const assembly = assembleIsolatedTestApplication({ config, env: { GIRAFFE_ORACLE_TEST_ADMIN_ACK: "isolated-test-only" } });
  assert.equal(await assembly.authenticateAdmin({ headers: { "x-oracle-test-actor": "auditor-test" } }), "auditor-test");
  assert.equal(await assembly.authenticateAdmin({ headers: { "x-oracle-test-actor": "arbitrary-admin" } }), null);
  assert.equal(assembly.runtime.attestations.signerSetId, "synthetic-oracle-signers");
});
