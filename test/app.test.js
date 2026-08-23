import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { SourceRegistry } from "../src/domain/source-registry.js";
import { createSyntheticRuntime } from "../src/oracle-runtime.js";
import { Authorizer } from "../src/services/authorizer.js";
import { CommandJournal } from "../src/services/command-journal.js";
import { DualControlQueue } from "../src/services/dual-control.js";
import { OracleControlPlane } from "../src/services/oracle-control-plane.js";
import { Outbox } from "../src/services/outbox.js";

async function withServer(run) {
  const server = createApp({ config: loadConfig({}), sourceRegistry: new SourceRegistry() });
  await new Promise((resolve) => server.listen(0, "localhost", resolve));
  try {
    const address = server.address();
    await run(`http://localhost:${address.port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test("health endpoint returns service identity", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/healthz`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      service: "giraffe-rwa-oracle",
      version: "0.2.0",
    });
  });
});

test("readiness confirms external writes are disabled", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/readyz`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.externalWritesEnabled, false);
    assert.equal(body.registeredSources, 0);
  });
});

test("all write methods are rejected", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/healthz`, { method: "POST" });
    assert.equal(response.status, 405);
    assert.equal((await response.json()).errorCode, "METHOD_NOT_ALLOWED");
  });
});

test("admin dashboard is read-only and protected against framing", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/admin`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.match(await response.text(), /Read-only operational dashboard/);
  });
});

test("verification endpoint fails closed without a configured verifier", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/rwa/attestations/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ attestation: {} }),
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).errorCode, "VERIFIER_NOT_CONFIGURED");
  });
});

test("admin API remains disabled by default", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/rwa/admin/assets/verify`, { method: "POST", body: "{}" });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).errorCode, "ADMIN_WRITES_DISABLED");
  });
});

test("explicit synthetic test gate enables authenticated idempotent admin commands", async () => {
  const runtime = createSyntheticRuntime();
  const authorizer = new Authorizer();
  authorizer.registerActor("oracle-test", ["ORACLE_OPERATOR"]);
  const controlPlane = new OracleControlPlane({ runtime, authorizer, dualControl: new DualControlQueue(), commandJournal: new CommandJournal(), outbox: new Outbox() });
  const config = loadConfig({ GIRAFFE_ORACLE_ENV: "test", GIRAFFE_ORACLE_EXTERNAL_WRITES: "true", GIRAFFE_ORACLE_TEST_WRITE_ACK: "synthetic-only" });
  const server = createApp({ config, sourceRegistry: runtime.sourceRegistry, runtime, controlPlane, authenticateAdmin: async () => "oracle-test" });
  await new Promise((resolve) => server.listen(0, "localhost", resolve));
  try {
    const response = await fetch(`http://localhost:${server.address().port}/v1/rwa/admin/assets/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "verify-http-001" },
      body: JSON.stringify({ asset: { assetId: "asset-http", assetFingerprintHash: "a".repeat(64) }, certificate: { assetId: "asset-http", certificateHash: "b".repeat(64), certificateVersion: 1 }, warehouse: { assetId: "asset-http", warehouseReceiptHash: "c".repeat(64) }, evidenceVersion: 1 }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).result.result.status, "VALID");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("public verifier ignores caller-supplied time overrides", async () => {
  const issuedAt = new Date("2020-01-01T00:00:00.000Z");
  let serverNow = issuedAt;
  const runtime = createSyntheticRuntime({ clock: () => serverNow });
  const attestation = runtime.attestations.issue({ subject: { assetId: "asset-old", purpose: "test" }, factType: "STATUS", factValue: "VALID", sourceRecordHash: "a".repeat(64), validForSeconds: 1, nonce: "old-nonce" });
  serverNow = new Date("2020-01-01T00:00:02.000Z");
  const server = createApp({ config: loadConfig({}), sourceRegistry: runtime.sourceRegistry, runtime });
  await new Promise((resolve) => server.listen(0, "localhost", resolve));
  try {
    const response = await fetch(`http://localhost:${server.address().port}/v1/rwa/attestations/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ attestation, now: issuedAt.toISOString() }),
    });
    assert.deepEqual(await response.json(), { valid: false, errorCode: "NOT_CURRENT" });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("synthetic runtime exposes minimally disclosed asset facts", async () => {
  const runtime = createSyntheticRuntime();
  runtime.recordStore.putAsset({ assetId: "asset-001", assetFingerprintHash: "a".repeat(64), registryRef: "registry-001" });
  const server = createApp({ config: loadConfig({}), sourceRegistry: runtime.sourceRegistry, runtime });
  await new Promise((resolve) => server.listen(0, "localhost", resolve));
  try {
    const response = await fetch(`http://localhost:${server.address().port}/v1/rwa/assets/asset-001`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.asset.assetId, "asset-001");
    assert.equal(body.status, "NOT_VERIFIED");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("token eligibility endpoint reflects Oracle status", async () => {
  const runtime = createSyntheticRuntime();
  runtime.recordStore.putAsset({ assetId: "asset-001", assetFingerprintHash: "a".repeat(64) });
  runtime.stateEngine.transition({ subjectId: "asset-001", to: "VALID", reasonHash: "b".repeat(64), evidenceVersion: 1, occurredAt: new Date().toISOString() });
  runtime.tokenIndex.bind({ chainId: "test-chain", contract: "contract-001", tokenId: "1", assetId: "asset-001" });
  const server = createApp({ config: loadConfig({}), sourceRegistry: runtime.sourceRegistry, runtime });
  await new Promise((resolve) => server.listen(0, "localhost", resolve));
  try {
    const response = await fetch(`http://localhost:${server.address().port}/v1/rwa/tokens/test-chain/contract-001/1/eligibility`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { binding: { chainId: "test-chain", contract: "contract-001", tokenId: "1", assetId: "asset-001" }, status: "VALID", transferable: true });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
