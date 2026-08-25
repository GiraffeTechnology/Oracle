import assert from "node:assert/strict";
import test from "node:test";
import { SourceRegistry } from "../src/domain/source-registry.js";

const approvedSource = Object.freeze({
  id: "synthetic-registry",
  displayName: "Synthetic Registry",
  kind: "REGISTRY",
  keySetId: "synthetic-keys",
  schemaVersions: ["asset-record.v1"],
  active: true,
});

test("requires a registered active source and approved schema", () => {
  const registry = new SourceRegistry([approvedSource]);
  assert.equal(
    registry.requireActive("synthetic-registry", "asset-record.v1").id,
    "synthetic-registry",
  );
  assert.throws(
    () => registry.requireActive("synthetic-registry", "asset-record.v2"),
    /SOURCE_SCHEMA_NOT_ALLOWED/,
  );
  assert.throws(
    () => registry.requireActive("unknown-source", "asset-record.v1"),
    /SOURCE_NOT_REGISTERED/,
  );
});

test("rejects caller-supplied endpoint fields", () => {
  const registry = new SourceRegistry();
  assert.throws(
    () => registry.add({ ...approvedSource, endpoint: "https://example.invalid" }),
    /CALLER_SUPPLIED_ENDPOINT_REJECTED/,
  );
});

test("rejects duplicate source identifiers", () => {
  const registry = new SourceRegistry([approvedSource]);
  assert.throws(() => registry.add(approvedSource), /SOURCE_ALREADY_EXISTS/);
});

test("public listing omits key set identifiers", () => {
  const registry = new SourceRegistry([approvedSource]);
  assert.deepEqual(registry.listPublic(), [
    {
      id: "synthetic-registry",
      displayName: "Synthetic Registry",
      kind: "REGISTRY",
      schemaVersions: ["asset-record.v1"],
      active: true,
    },
  ]);
});

