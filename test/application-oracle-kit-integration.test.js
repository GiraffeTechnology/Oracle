import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import test from "node:test";

import { createApplicationProjectionApi } from "../src/services/application-projection-api.js";
import { KitProjectionSource } from "../src/adapters/kit-projection-source.js";

/**
 * Application -> Oracle -> ERC8415-Kit, end to end over real sockets.
 *
 * The Kit is stood up here as a server speaking its v2.0 temporal projection
 * routes, Oracle consumes it through the adapter, and every assertion is made
 * against Oracle's application-facing API -- the only surface a consuming
 * application may touch. Nothing in this test reaches past Oracle to the Kit
 * directly, which is the dependency direction the architecture fixes.
 */

const ALICE = `0x${"aa".repeat(20)}`;
const BOB = `0x${"bb".repeat(20)}`;
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
const REGISTER_ID = `0x${"84".repeat(32)}`;

/** A stand-in Kit speaking the routes Oracle consumes. */
function startKit() {
  const requested = [];
  const server = http.createServer((request, response) => {
    requested.push(`${request.method} ${request.url}`);
    const json = (status, body) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    const url = new URL(request.url, "http://kit.invalid");
    const path = url.pathname;

    if (request.method !== "GET") return json(405, { error: "READ_ONLY" });

    const asOf = /^\/projection\/(\d+)\/(entry|holder|finality)\/as-of\/(\d+)$/.exec(path);
    if (asOf) {
      const instant = BigInt(asOf[3]);
      const covered = instant >= 100n;
      const found = instant >= 130n ? ENTRIES[1] : ENTRIES[0];
      if (asOf[2] === "finality") {
        return json(200, { final: instant >= 100n && instant < 130n });
      }
      if (!covered) return json(404, { error: "INSTANT_NOT_COVERED" });
      return json(200, asOf[2] === "entry" ? { entry: found } : { holder: found.holder });
    }

    const version = /^\/projection\/(\d+)\/entry\/version\/(\d+)$/.exec(path);
    if (version) {
      const found = ENTRIES.find((item) => item.version === version[2]);
      return found ? json(200, { entry: found }) : json(404, { error: "UNKNOWN_VERSION" });
    }

    if (/^\/projection\/(\d+)\/entries$/.test(path)) {
      return json(200, { entryCount: ENTRIES.length, entries: ENTRIES });
    }
    if (/^\/projection\/(\d+)$/.test(path)) {
      return json(200, { registerId: REGISTER_ID, entryCount: ENTRIES.length, openGap: null });
    }
    return json(404, { error: "NOT_FOUND" });
  });
  return { server, requested };
}

async function withStack(run) {
  const kit = startKit();
  kit.server.listen(0);
  await once(kit.server, "listening");
  const kitPort = kit.server.address().port;

  const api = createApplicationProjectionApi({
    projectionSource: new KitProjectionSource({ baseUrl: `http://127.0.0.1:${kitPort}` }),
    positionSource: { ownerOf: async () => BOB },
  });

  const oracle = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://oracle.invalid");
    const result = await api.handle(request.method, url.pathname);
    const { status, body } = result ?? { status: 404, body: { ok: false, errorCode: "NOT_FOUND" } };
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  });
  oracle.listen(0);
  await once(oracle, "listening");

  try {
    await run({ base: `http://127.0.0.1:${oracle.address().port}/v1/oracle/projection`, kit });
  } finally {
    oracle.close();
    kit.server.close();
    await Promise.all([once(oracle, "close"), once(kit.server, "close")]);
  }
}

test("a consuming application reads a projection through Oracle, which consumes the Kit", async () => {
  await withStack(async ({ base, kit }) => {
    const identity = await (await fetch(`${base}/1`)).json();
    assert.equal(identity.registerId, REGISTER_ID);
    assert.equal(identity.entryCount, "2");

    assert.equal((await (await fetch(`${base}/1/holder/as-of/120`)).json()).holder, ALICE);
    assert.equal((await (await fetch(`${base}/1/holder/as-of/130`)).json()).holder, BOB);
    assert.equal((await (await fetch(`${base}/1/finality/as-of/120`)).json()).final, true);
    assert.equal((await (await fetch(`${base}/1/finality/as-of/130`)).json()).final, false);
    assert.equal((await (await fetch(`${base}/1/entry/version/1`)).json()).entry.supersededAt, "130");
    assert.equal((await (await fetch(`${base}/1/entry/current`)).json()).entry.version, "2");

    // Oracle reached the Kit, and only through its read routes.
    assert.ok(kit.requested.length > 0);
    assert.ok(kit.requested.every((line) => line.startsWith("GET ")), kit.requested.join("; "));
    assert.ok(!kit.requested.some((line) => line.includes("admission")));
  });
});

test("an uncovered instant stays uncovered across both hops", async () => {
  await withStack(async ({ base }) => {
    const holder = await fetch(`${base}/1/holder/as-of/99`);
    assert.equal(holder.status, 404);
    assert.equal((await holder.json()).errorCode, "INSTANT_NOT_COVERED");

    // Finality still answers, through both hops, without refusing.
    const finality = await fetch(`${base}/1/finality/as-of/99`);
    assert.equal(finality.status, 200);
    assert.equal((await finality.json()).final, false);
  });
});

test("the tradeable position and the confirmed holder disagree and both are visible", async () => {
  await withStack(async ({ base }) => {
    const position = await (await fetch(`${base}/1/position`)).json();
    const holder = await (await fetch(`${base}/1/holder/as-of/120`)).json();

    assert.equal(position.tradeablePosition, BOB);
    assert.equal(holder.holder, ALICE);
    // The asynchronous gap, visible as two separate facts rather than one.
    assert.notEqual(position.tradeablePosition, holder.holder);
  });
});

test("a consumer cannot write through the boundary", async () => {
  await withStack(async ({ base, kit }) => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await fetch(`${base}/1/holder/as-of/120`, { method });
      assert.equal(response.status, 405);
    }
    // No write ever reached the Kit.
    assert.ok(kit.requested.every((line) => line.startsWith("GET ")));
  });
});

test("Oracle reports a Kit outage rather than inventing an answer", async () => {
  const api = createApplicationProjectionApi({
    projectionSource: new KitProjectionSource({ baseUrl: "http://127.0.0.1:1", timeoutMs: 50 }),
    positionSource: { ownerOf: async () => BOB },
  });
  const result = await api.handle("GET", "/v1/oracle/projection/1/holder/as-of/120");
  assert.equal(result.status, 503);
  assert.equal(result.body.errorCode, "PROJECTION_SOURCE_UNAVAILABLE");
  assert.equal(result.body.holder, undefined);
  assert.ok(!JSON.stringify(result.body).includes(BOB));
});
