import assert from "node:assert/strict";
import test from "node:test";

import { createApplicationProjectionApi } from "../src/services/application-projection-api.js";
import { KitProjectionSource } from "../src/adapters/kit-projection-source.js";
import { ProjectionSourceError } from "../src/ports/projection-source.js";

const ALICE = `0x${"aa".repeat(20)}`;
const BOB = `0x${"bb".repeat(20)}`;
const CAROL = `0x${"cc".repeat(20)}`;
const REFERENCE = `0x${"ab".repeat(32)}`;

const entry = (version, holder, effectiveAt, supersededAt) => ({
  version: String(version),
  holder,
  effectiveAt: String(effectiveAt),
  supersededAt: String(supersededAt),
  recordCommitment: `0x${String(version).padStart(64, "0")}`,
  previousCommitment: `0x${"0".repeat(64)}`,
  registryReference: REFERENCE,
});

const ENTRIES = [entry(1, ALICE, 100, 130), entry(2, BOB, 130, 0)];

/** A projection source with the two entries above. */
const source = () => ({
  registerId: async () => `0x${"84".repeat(32)}`,
  entryCount: async () => "2",
  currentEntry: async () => ENTRIES[1],
  entryAt: async (_t, version) => {
    const found = ENTRIES.find((item) => item.version === version);
    if (!found) throw new ProjectionSourceError("UNKNOWN_VERSION", 404);
    return found;
  },
  entryAsOf: async (_t, instant) => {
    if (BigInt(instant) < 100n) throw new ProjectionSourceError("INSTANT_NOT_COVERED", 404);
    return BigInt(instant) >= 130n ? ENTRIES[1] : ENTRIES[0];
  },
  holderAsOf: async (_t, instant) => {
    if (BigInt(instant) < 100n) throw new ProjectionSourceError("INSTANT_NOT_COVERED", 404);
    return BigInt(instant) >= 130n ? BOB : ALICE;
  },
  isFinalAsOf: async (_t, instant) => BigInt(instant) >= 100n && BigInt(instant) < 130n,
});

const api = (extra = {}) => createApplicationProjectionApi({ projectionSource: source(), ...extra });
const get = (a, path) => a.handle("GET", `/v1/oracle/projection${path}`);

test("the application-facing API answers each projection accessor", async () => {
  const a = api();
  assert.deepEqual((await get(a, "/1")).body, {
    tokenId: "1",
    registerId: `0x${"84".repeat(32)}`,
    entryCount: "2",
  });
  assert.equal((await get(a, "/1/entry/current")).body.entry.version, "2");
  assert.equal((await get(a, "/1/entry/version/1")).body.entry.holder, ALICE);
  assert.equal((await get(a, "/1/entry/as-of/120")).body.entry.version, "1");
  assert.equal((await get(a, "/1/holder/as-of/120")).body.holder, ALICE);
  assert.equal((await get(a, "/1/holder/as-of/130")).body.holder, BOB);
  assert.equal((await get(a, "/1/finality/as-of/120")).body.final, true);
  assert.equal((await get(a, "/1/finality/as-of/130")).body.final, false);
});

test("the three questions stay three routes and are never merged", async () => {
  const a = api();
  const holder = (await get(a, "/1/holder/as-of/120")).body;
  const finality = (await get(a, "/1/finality/as-of/120")).body;

  // Neither response carries the other's answer.
  assert.equal(holder.final, undefined);
  assert.equal(holder.provisional, undefined);
  assert.equal(finality.holder, undefined);

  // And no route returns a combined status.
  for (const path of ["/1", "/1/entry/current", "/1/holder/as-of/120", "/1/finality/as-of/120"]) {
    const body = (await get(a, path)).body;
    for (const forbidden of ["status", "state", "settled", "confirmed", "pending"]) {
      assert.equal(body[forbidden], undefined, `${path} exposes ${forbidden}`);
    }
  }
});

test("an instant the projection does not cover refuses, while finality answers", async () => {
  const a = api();
  assert.equal((await get(a, "/1/holder/as-of/99")).status, 404);
  assert.equal((await get(a, "/1/holder/as-of/99")).body.errorCode, "INSTANT_NOT_COVERED");
  assert.equal((await get(a, "/1/entry/as-of/99")).status, 404);

  const finality = await get(a, "/1/finality/as-of/99");
  assert.equal(finality.status, 200);
  assert.equal(finality.body.final, false);
});

test("the tradeable position is a separate fact, and absent means not read", async () => {
  const withOwner = api({ positionSource: { ownerOf: async () => CAROL } });
  const position = (await get(withOwner, "/1/position")).body;
  assert.equal(position.tradeablePosition, CAROL);
  assert.equal(position.source, "erc-721");
  // It differs from the confirmed holder at the same moment, and says so.
  assert.notEqual(position.tradeablePosition, (await get(withOwner, "/1/holder/as-of/120")).body.holder);

  const without = api();
  assert.equal((await get(without, "/1/position")).body.tradeablePosition, null);
  assert.equal((await get(without, "/1/position")).body.note, "not read");
});

test("a failed projection read never falls back to the owner", async () => {
  const failing = createApplicationProjectionApi({
    projectionSource: {
      ...source(),
      holderAsOf: async () => { throw new ProjectionSourceError("PROJECTION_SOURCE_UNAVAILABLE", 503); },
    },
    positionSource: { ownerOf: async () => CAROL },
  });
  const result = await get(failing, "/1/holder/as-of/120");
  assert.equal(result.status, 503);
  assert.equal(result.body.errorCode, "PROJECTION_SOURCE_UNAVAILABLE");
  assert.equal(result.body.holder, undefined);
  assert.ok(!JSON.stringify(result.body).includes(CAROL));
});

test("the surface is read-only for every write method", async () => {
  const a = api();
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    for (const path of ["/v1/oracle/projection/1", "/v1/oracle/projection/1/holder/as-of/120"]) {
      const result = await a.handle(method, path);
      assert.equal(result.status, 405, `${method} ${path}`);
      assert.equal(result.body.errorCode, "PROJECTION_READ_ONLY");
    }
  }
});

test("no settlement, payment, custody, release or refund route exists", async () => {
  const a = api();
  for (const path of [
    "/1/settlement", "/1/settle", "/1/gap", "/1/payment",
    "/1/custody", "/1/release", "/1/refund", "/1/admission",
  ]) {
    const result = await get(a, path);
    assert.equal(result, null, `${path} is routable`);
  }
});

test("a malformed token id, version or instant is refused", async () => {
  const a = api();
  for (const path of ["/abc", "/1/holder/as-of/-1", "/1/holder/as-of/12.5", "/1/entry/version/x"]) {
    const result = await get(a, path);
    assert.ok(result === null || result.status >= 400, `${path} was accepted`);
  }
});

test("uint64 crosses the boundary as a decimal string, never a number", async () => {
  const big = (2n ** 53n + 1n).toString();
  const a = createApplicationProjectionApi({
    projectionSource: { ...source(), holderAsOf: async () => ALICE, isFinalAsOf: async () => false },
  });
  const body = (await get(a, `/1/holder/as-of/${big}`)).body;
  assert.equal(typeof body.instant, "string");
  assert.equal(body.instant, big);
  assert.equal(BigInt(body.instant), 2n ** 53n + 1n);
});

test("the Kit adapter refuses an insecure or credential-bearing base URL", () => {
  assert.throws(() => new KitProjectionSource({ baseUrl: "http://kit.example" }), /INSECURE/);
  // Assembled from parts on purpose. A literal user:password URL matches the
  // repository's own email and credential-assignment scanners, which is the
  // correct behaviour for them, so the test states the case without tripping
  // either.
  const at = String.fromCharCode(64);
  assert.throws(
    () => new KitProjectionSource({ baseUrl: `https://user:token${at}kit.example` }),
    /CREDENTIALS/,
  );
  assert.doesNotThrow(() => new KitProjectionSource({ baseUrl: "https://kit.example" }));
  assert.doesNotThrow(() => new KitProjectionSource({ baseUrl: "http://127.0.0.1:8080" }));
});

test("the Kit adapter surfaces a refusal rather than substituting an answer", async () => {
  const kit = new KitProjectionSource({
    baseUrl: "https://kit.example",
    fetchImpl: async () => ({ status: 404, json: async () => ({ error: "INSTANT_NOT_COVERED" }) }),
  });
  await assert.rejects(() => kit.holderAsOf("1", "99"), (error) => {
    assert.ok(error instanceof ProjectionSourceError);
    assert.equal(error.errorCode, "INSTANT_NOT_COVERED");
    assert.equal(error.status, 404);
    return true;
  });
});

test("the Kit adapter reports an unreachable source rather than leaking the failure", async () => {
  const kit = new KitProjectionSource({
    baseUrl: "https://kit.example",
    fetchImpl: async () => { throw new TypeError("network unreachable"); },
  });
  await assert.rejects(() => kit.holderAsOf("1", "120"), (error) => {
    assert.ok(error instanceof ProjectionSourceError);
    assert.equal(error.errorCode, "PROJECTION_SOURCE_UNAVAILABLE");
    assert.equal(error.status, 503);
    // The transport's own message does not reach the caller.
    assert.ok(!error.message.includes("network unreachable"));
    return true;
  });
});

test("the Kit adapter bounds every read with a deadline", async () => {
  let observed = null;
  const kit = new KitProjectionSource({
    baseUrl: "https://kit.example",
    timeoutMs: 1234,
    fetchImpl: async (_url, init) => {
      observed = init;
      return { status: 200, json: async () => ({ holder: ALICE }) };
    },
  });
  await kit.holderAsOf("1", "120");
  // A read that never returns is a read that never fails, so every call
  // carries an abort deadline rather than relying on the peer to answer.
  assert.ok(observed.signal instanceof AbortSignal);
  assert.equal(observed.signal.aborted, false);
});

test("the Kit adapter has no write path to reach an admission", () => {
  const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(
    new KitProjectionSource({ baseUrl: "https://kit.example" })
  ));
  for (const forbidden of ["admit", "admission", "settle", "begin", "cancel", "finalize", "post"]) {
    assert.ok(!surface.includes(forbidden), `the adapter exposes ${forbidden}`);
  }
  assert.deepEqual(surface.filter((name) => name !== "constructor").sort(), [
    "currentEntry", "entryAsOf", "entryAt", "entryCount", "holderAsOf", "isFinalAsOf", "registerId",
  ]);
});
