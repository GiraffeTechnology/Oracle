import assert from "node:assert/strict";
import test from "node:test";
import { createApp, publicSettlement } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { SourceRegistry } from "../src/domain/source-registry.js";
import { createSyntheticRuntime } from "../src/oracle-runtime.js";
import { Authorizer } from "../src/services/authorizer.js";
import { CommandJournal } from "../src/services/command-journal.js";
import { DualControlQueue } from "../src/services/dual-control.js";
import { OracleControlPlane } from "../src/services/oracle-control-plane.js";
import { Outbox } from "../src/services/outbox.js";
import { loadL2DeploymentProfile } from "../src/config/deployment-profile.js";
import { loadProtocolProfile } from "../src/protocol/protocol-profile.js";
import { FixedWindowRateLimiter } from "../src/services/rate-limiter.js";

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
      version: "0.3.0",
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
    assert.equal(body.l2Configured, false);
    assert.equal(body.l3Configured, false);
  });
});

test("configured app publishes redacted L2 and pinned L3 profiles", async () => {
  const l2Profile = await loadL2DeploymentProfile("config/l2.production.json");
  const protocolProfile = await loadProtocolProfile("config/l3.protocol.wd-0.1.1.json");
  const server = createApp({ config: loadConfig({}), sourceRegistry: new SourceRegistry(), l2Profile, protocolProfile });
  await new Promise((resolve) => server.listen(0, "localhost", resolve));
  try {
    const baseUrl = `http://localhost:${server.address().port}`;
    const deployment = await (await fetch(`${baseUrl}/v1/oracle/deployment-profile`)).json();
    const protocol = await (await fetch(`${baseUrl}/v1/oracle/protocol-profile`)).json();
    assert.equal(deployment.profile.profileId, "giraffe-oracle-l2/production-v1");
    assert.doesNotMatch(JSON.stringify(deployment), /deployment:\/\//);
    assert.equal(protocol.profile.profileId, "giraffe-rwa-certificate-settlement/wd-0.1.1");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("all write methods are rejected", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/healthz`, { method: "POST" });
    assert.equal(response.status, 405);
    assert.equal((await response.json()).errorCode, "METHOD_NOT_ALLOWED");
  });
});

test("admin dashboard exposes authenticated operations and is protected against framing", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/admin`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    const csp = response.headers.get("content-security-policy");
    assert.doesNotMatch(csp, /script-src 'unsafe-inline'/);
    const nonce = csp.match(/script-src 'nonce-([^']+)'/)?.[1];
    assert.ok(nonce);
    const body = await response.text();
    assert.match(body, new RegExp(`<script nonce="${nonce}">`));
    assert.match(body, /Authenticated Admin & Audit dashboard/);
    assert.match(body, /sources\/disable/);
    assert.match(body, /signers\/rotate/);
    assert.match(body, /value="reconcile"/);
    assert.match(body, /actions\/approve/);
    assert.match(body, /Controlled operation status/);
    assert.match(body, /crypto\.subtle\.digest\('SHA-256'/);
    assert.match(body, /admin\.export\.'\+crypto\.randomUUID\(\)/);
    assert.match(body, /idempotency-key/);
  const renderedScript = body.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(renderedScript);
  assert.doesNotThrow(() => new Function(renderedScript));
  assert.match(body, /\.grid>\*,\.controls>\*\{min-width:0\}/);
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
  const controlPlane = new OracleControlPlane({ runtime, authorizer, dualControl: new DualControlQueue(), commandJournal: new CommandJournal(), outbox: new Outbox(), allowSyntheticEvidence: true });
  const config = loadConfig({ GIRAFFE_ORACLE_ENV: "test", GIRAFFE_ORACLE_EXTERNAL_WRITES: "true", GIRAFFE_ORACLE_TEST_WRITE_ACK: "synthetic-only" });
  const server = createApp({ config, sourceRegistry: runtime.sourceRegistry, runtime, controlPlane, authenticateAdmin: async () => "oracle-test" });
  await new Promise((resolve) => server.listen(0, "localhost", resolve));
  try {
    const response = await fetch(`http://localhost:${server.address().port}/v1/rwa/admin/assets/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "verify-http-001", "x-requested-with": "GiraffeOracleAdmin" },
      body: JSON.stringify({
        asset: { assetId: "asset-http", assetFingerprintHash: "a".repeat(64), wenbaoRegistryRef: "registry-asset-http", transferEligibility: "VALID", warehouseId: "warehouse-asset-http", warehouseReceiptHash: "c".repeat(64), currentCertificateHash: "b".repeat(64), currentCertificateVersion: 1, currentOwnerCommitment: "d".repeat(64), encumbranceStatus: "CLEAR", oracleStatus: "VALID", updatedAt: "2026-08-27T00:00:00.000Z" },
        certificate: { assetId: "asset-http", tokenId: "1", certificateHash: "b".repeat(64), certificateVersion: 1, previousCertificateHash: null, wenbaoChangeRef: "initial-asset-http", warehouseReceiptHash: "c".repeat(64), effectiveAt: "2026-08-27T00:00:00.000Z", status: "CURRENT" },
        warehouse: { assetId: "asset-http", warehouseId: "warehouse-asset-http", warehouseReceiptHash: "c".repeat(64), warehouseStatus: "IN_CUSTODY", encumbranceStatus: "CLEAR", observedAt: "2026-08-27T00:00:00.000Z" },
        evidenceVersion: 1,
      }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).result.result.status, "VALID");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("admin HTTP route awaits an asynchronous control-plane result", async () => {
  const config = loadConfig({ GIRAFFE_ORACLE_ENV: "test", GIRAFFE_ORACLE_EXTERNAL_WRITES: "true", GIRAFFE_ORACLE_TEST_WRITE_ACK: "synthetic-only" });
  const controlPlane = { async verifyAsset() { await Promise.resolve(); return { persisted: true }; } };
  const server = createApp({ config, sourceRegistry: new SourceRegistry(), controlPlane, authenticateAdmin: async () => "oracle-test" });
  await new Promise((resolve) => server.listen(0, "localhost", resolve));
  try {
    const response = await fetch(`http://localhost:${server.address().port}/v1/rwa/admin/assets/verify`, {
      method: "POST", headers: { "content-type": "application/json", "idempotency-key": "async-ok", "x-requested-with": "GiraffeOracleAdmin" }, body: "{}",
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, result: { persisted: true } });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("admin HTTP route maps an asynchronous control-plane rejection", async () => {
  const config = loadConfig({ GIRAFFE_ORACLE_ENV: "test", GIRAFFE_ORACLE_EXTERNAL_WRITES: "true", GIRAFFE_ORACLE_TEST_WRITE_ACK: "synthetic-only" });
  const controlPlane = { async verifyAsset() { await Promise.resolve(); throw new Error("PERMISSION_DENIED:asset:verify"); } };
  const server = createApp({ config, sourceRegistry: new SourceRegistry(), controlPlane, authenticateAdmin: async () => "oracle-test" });
  await new Promise((resolve) => server.listen(0, "localhost", resolve));
  try {
    const response = await fetch(`http://localhost:${server.address().port}/v1/rwa/admin/assets/verify`, {
      method: "POST", headers: { "content-type": "application/json", "idempotency-key": "async-fail", "x-requested-with": "GiraffeOracleAdmin" }, body: "{}",
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { ok: false, errorCode: "PERMISSION_DENIED:asset:verify" });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("HTTP boundaries never return arbitrary dependency messages", async () => {
  const config = loadConfig({ GIRAFFE_ORACLE_ENV: "test", GIRAFFE_ORACLE_EXTERNAL_WRITES: "true", GIRAFFE_ORACLE_TEST_WRITE_ACK: "synthetic-only" });
  const controlPlane = { executeSignerRotation: async () => { throw new Error("credential at C:\\private\\key leaked"); } };
  const server = createApp({ config, sourceRegistry: new SourceRegistry(), controlPlane, authenticateAdmin: async () => "oracle-test" });
  await new Promise((resolve) => server.listen(0, "localhost", resolve));
  try {
    const response = await fetch(`http://localhost:${server.address().port}/v1/rwa/admin/signers/rotate/execute`, { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "GiraffeOracleAdmin", "idempotency-key": "sanitize-error-001" }, body: "{}" });
    const payload = await response.json();
    assert.equal(response.status, 500);
    assert.equal(payload.errorCode, "ADMIN_OPERATION_FAILED");
    assert.equal(JSON.stringify(payload).includes("private"), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("admin HTTP writes reject a missing idempotency key", async () => {
  const config = loadConfig({ GIRAFFE_ORACLE_ENV: "test", GIRAFFE_ORACLE_EXTERNAL_WRITES: "true", GIRAFFE_ORACLE_TEST_WRITE_ACK: "synthetic-only" });
  const server = createApp({ config, sourceRegistry: new SourceRegistry(), controlPlane: { verifyAsset() { return {}; } }, authenticateAdmin: async () => "oracle-test" });
  await new Promise((resolve) => server.listen(0, "localhost", resolve));
  try {
    const response = await fetch(`http://localhost:${server.address().port}/v1/rwa/admin/assets/verify`, { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "GiraffeOracleAdmin" }, body: "{}" });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).errorCode, "IDEMPOTENCY_KEY_REQUIRED");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("path settlement routes reject a caller-owned settlementId in the body", async () => {
  const config = loadConfig({ GIRAFFE_ORACLE_ENV: "test", GIRAFFE_ORACLE_EXTERNAL_WRITES: "true", GIRAFFE_ORACLE_TEST_WRITE_ACK: "synthetic-only" });
  let calls = 0;
  const controlPlane = { async finalizeSettlement() { calls += 1; return {}; } };
  const server = createApp({ config, sourceRegistry: new SourceRegistry(), controlPlane, authenticateAdmin: async () => "oracle-test" });
  await new Promise((resolve) => server.listen(0, "localhost", resolve));
  try {
    const response = await fetch("http://localhost:" + server.address().port + "/v1/rwa/settlements/settlement-path/finalize", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "path-id-refused", "x-requested-with": "GiraffeOracleAdmin" },
      body: JSON.stringify({ settlementId: "settlement-body" }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).errorCode, "SETTLEMENT_BODY_ID_REFUSED");
    assert.equal(calls, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
test("public settlement projection omits counterparties and execution reference", () => {
  const projected = publicSettlement({ settlementId: "s-001", assetId: "a-001", sellerWallet: "seller-secret", buyerWallet: "buyer-secret", externalExecutionRef: "market-secret", status: "PENDING", snapshotHash: "a".repeat(64) });
  assert.deepEqual(projected, { settlementId: "s-001", assetId: "a-001", status: "PENDING", snapshotHash: "a".repeat(64) });
  assert.equal(JSON.stringify(projected).includes("secret"), false);
});

test("generic and market price query fields are rejected", async () => {
  await withServer(async (baseUrl) => {
    for (const field of ["price", "marketPrice"]) {
      const response = await fetch(`${baseUrl}/healthz?${field}=1`);
      assert.equal(response.status, 400);
      assert.equal((await response.json()).errorCode, "FINANCIAL_OUTPUT_PROHIBITED");
    }
  });
});

test("public verifier ignores caller-supplied time overrides", async () => {
  const issuedAt = new Date("2020-01-01T00:00:00.000Z");
  let serverNow = issuedAt;
  const runtime = createSyntheticRuntime({ clock: () => serverNow });
  const attestation = runtime.attestations.issue({ subject: { assetId: "asset-old", chainId: "test-chain", contract: "test-contract", tokenId: "1", purpose: "test" }, factType: "STATUS", factValue: "VALID", sourceAuthority: "synthetic-registry", sourceRecordHash: "a".repeat(64), validForSeconds: 1, nonce: "old-nonce" });
  serverNow = new Date("2020-01-01T00:00:02.000Z");
  const server = createApp({ config: loadConfig({}), sourceRegistry: runtime.sourceRegistry, runtime });
  await new Promise((resolve) => server.listen(0, "localhost", resolve));
  try {
    const response = await fetch(`http://localhost:${server.address().port}/v1/rwa/attestations/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ attestation, expectedSubject: { assetId: "asset-old", chainId: "test-chain", contract: "test-contract", tokenId: "1", purpose: "test" }, now: issuedAt.toISOString() }),
    });
    assert.deepEqual(await response.json(), { valid: false, errorCode: "NOT_CURRENT" });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("public verification endpoint enforces the HTTP rate limit", async () => {
  const runtime = createSyntheticRuntime();
  const server = createApp({ config: loadConfig({}), sourceRegistry: runtime.sourceRegistry, runtime, verificationRateLimiter: new FixedWindowRateLimiter({ limit: 1, windowMs: 60000 }) });
  await new Promise((resolve) => server.listen(0, "localhost", resolve));
  try {
    const url = `http://localhost:${server.address().port}/v1/rwa/attestations/verify`;
    await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const limited = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).errorCode, "RATE_LIMIT_EXCEEDED");
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

test("asset detail local-time script is authorized by a per-response CSP nonce", async () => {
  const runtime = createSyntheticRuntime();
  runtime.recordStore.putAsset({ assetId: "asset-csp", assetFingerprintHash: "a".repeat(64), updatedAt: "2026-08-27T00:00:00.000Z" });
  const server = createApp({ config: loadConfig({}), sourceRegistry: runtime.sourceRegistry, runtime });
  await new Promise((resolve) => server.listen(0, "localhost", resolve));
  try {
    const response = await fetch(`http://localhost:${server.address().port}/assets/asset-csp`);
    const csp = response.headers.get("content-security-policy");
    const nonce = csp.match(/script-src 'nonce-([^']+)'/)?.[1];
    assert.ok(nonce);
    assert.match(await response.text(), new RegExp(`<script nonce="${nonce}">`));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("public asset certificate and warehouse views redact settlement buyer commitments", async () => {
  const runtime = createSyntheticRuntime();
  const buyerCommitment = "e".repeat(64);
  const assetId = "asset-buyer-redaction";
  runtime.recordStore.putAsset({ assetId, assetFingerprintHash: "a".repeat(64), settlementBuyerCommitment: buyerCommitment });
  runtime.recordStore.appendCertificate({ assetId, tokenId: "1", certificateVersion: 1, certificateHash: "b".repeat(64), previousCertificateHash: null, settlementBuyerCommitment: buyerCommitment });
  runtime.recordStore.putWarehouse({ assetId, warehouseReceiptHash: "c".repeat(64), warehouseId: "warehouse-private", holderCommitment: "d".repeat(64), settlementBuyerCommitment: buyerCommitment });
  runtime.tokenIndex.bind({ chainId: "test-chain", contract: "contract-private", tokenId: "1", assetId });
  const server = createApp({ config: loadConfig({}), sourceRegistry: runtime.sourceRegistry, runtime });
  await new Promise((resolve) => server.listen(0, "localhost", resolve));
  try {
    const baseUrl = "http://localhost:" + server.address().port;
    const responses = await Promise.all([
      fetch(baseUrl + "/v1/rwa/assets/" + assetId),
      fetch(baseUrl + "/v1/rwa/assets/" + assetId + "/certificate-history"),
      fetch(baseUrl + "/v1/rwa/tokens/test-chain/contract-private/1"),
      fetch(baseUrl + "/v1/rwa/tokens/test-chain/contract-private/1/certificate-history"),
      fetch(baseUrl + "/assets/" + assetId),
    ]);
    for (const response of responses) {
      assert.equal(response.status, 200);
      assert.equal((await response.text()).includes(buyerCommitment), false);
    }
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
