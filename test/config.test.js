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

test("rejects non-loopback binds", () => {
  assert.throws(
    () => loadConfig({ GIRAFFE_ORACLE_HOST: "example.invalid" }),
    /NON_LOOPBACK_BIND_NOT_AUTHORIZED/,
  );
});

test("rejects enabling external writes", () => {
  assert.throws(
    () => loadConfig({ GIRAFFE_ORACLE_EXTERNAL_WRITES: "true" }),
    /EXTERNAL_WRITES_NOT_IMPLEMENTED/,
  );
});

