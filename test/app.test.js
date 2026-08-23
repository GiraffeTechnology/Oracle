import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { SourceRegistry } from "../src/domain/source-registry.js";
import { createSyntheticRuntime } from "../src/oracle-runtime.js";

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
