import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";

test("loads fail-closed development defaults", () => {
  assert.deepEqual(loadConfig({}), {
    environment: "development",
    host: "localhost",
    port: 8780,
    externalWritesEnabled: false,
  });
});

test("rejects production mode before authorization", () => {
  assert.throws(
    () => loadConfig({ GIRAFFE_ORACLE_ENV: "production" }),
    /PRODUCTION_MODE_NOT_AUTHORIZED/,
  );
});

test("loads pinned L2-L3 production profile references only with explicit acknowledgement", () => {
  const config = loadConfig({
    GIRAFFE_ORACLE_ENV: "production",
    GIRAFFE_ORACLE_PRODUCTION_ACK: "l2-l3-profile-locked",
  });
  assert.equal(config.environment, "production");
  assert.equal(config.externalWritesEnabled, false);
  assert.equal(config.l2ProfileRef, "config/l2.production.json");
  assert.equal(config.l3ProfileRef, "config/l3.protocol.wd-0.1.1.json");
});

test("production writes require a separate authenticated-control-plane acknowledgement", () => {
  const base = {
    GIRAFFE_ORACLE_ENV: "production",
    GIRAFFE_ORACLE_PRODUCTION_ACK: "l2-l3-profile-locked",
    GIRAFFE_ORACLE_EXTERNAL_WRITES: "true",
  };
  assert.throws(() => loadConfig(base), /EXTERNAL_WRITES_NOT_AUTHORIZED/);
  assert.equal(loadConfig({ ...base, GIRAFFE_ORACLE_PRODUCTION_WRITE_ACK: "authenticated-control-plane" }).externalWritesEnabled, true);
});

test("rejects non-loopback binds", () => {
  assert.throws(
    () => loadConfig({ GIRAFFE_ORACLE_HOST: "example.invalid" }),
    /NON_LOOPBACK_BIND_NOT_AUTHORIZED/,
  );
});

test("rejects enabling external writes", () => {
  assert.throws(
    () => loadConfig({ GIRAFFE_ORACLE_EXTERNAL_WRITES: "true" }),
    /EXTERNAL_WRITES_NOT_AUTHORIZED/,
  );
});

test("allows external writes only for explicitly acknowledged synthetic tests", () => {
  const config = loadConfig({
    GIRAFFE_ORACLE_ENV: "test",
    GIRAFFE_ORACLE_EXTERNAL_WRITES: "true",
    GIRAFFE_ORACLE_TEST_WRITE_ACK: "synthetic-only",
  });
  assert.equal(config.externalWritesEnabled, true);
});
