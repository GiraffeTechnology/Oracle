import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("MySQL migration contains all required durable projections", async () => {
  const sql = await readFile(new URL("../db/mysql/001_initial.sql", import.meta.url), "utf8");
  for (const table of ["source_authorities", "schema_versions", "assets", "certificate_versions", "warehouse_records", "token_bindings", "attestations", "revocations", "settlements", "audit_events", "outbox_events"]) {
    assert.match(sql, new RegExp(`CREATE TABLE ${table} \\(`));
  }
  assert.doesNotMatch(sql, /PASSWORD|PRIVATE KEY|IDENTIFIED BY/i);
});

test("OpenAPI declares no caller-selectable server endpoint", async () => {
  const spec = await readFile(new URL("../docs/openapi.yaml", import.meta.url), "utf8");
  assert.match(spec, /servers: \[\]/);
  assert.doesNotMatch(spec, /marketPrice|yield|collateralRatio/);
  assert.match(spec, /AuthoritativeSettlementFinalizationRequest:[\s\S]*additionalProperties: false[\s\S]*required: \[snapshotHash, evidenceVersion, assetReference, certificateReference, warehouseReference\]/);
  assert.match(spec, /\/v1\/rwa\/settlements\/\{settlementId\}\/finalize:[\s\S]*#\/components\/schemas\/AuthoritativeSettlementFinalizationRequest/);
  assert.doesNotMatch(spec, /warehouseConfirmed|ownerBindingConfirmed|newOwnerCommitment/);
});

test("SBOM confirms no third-party runtime components", async () => {
  const sbom = JSON.parse(await readFile(new URL("../sbom.cdx.json", import.meta.url), "utf8"));
  const packageManifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(sbom.bomFormat, "CycloneDX");
  assert.equal(sbom.metadata.component.version, packageManifest.version);
  assert.deepEqual(sbom.components, []);
});
