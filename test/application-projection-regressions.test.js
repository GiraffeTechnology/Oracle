import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import http from 'node:http';
import test from 'node:test';
import { KitProjectionSource } from '../src/adapters/kit-projection-source.js';
import { createApplicationProjectionApi } from '../src/services/application-projection-api.js';
import { loadApplicationProjectionConfig, assembleApplicationProjection } from '../src/config/application-projection.js';
import { loadConfig } from '../src/config.js';
import { startApplication } from '../src/main.js';
import { SourceRegistry } from '../src/domain/source-registry.js';

const REGISTER = `0x${'84'.repeat(32)}`;
const HOLDER = `0x${'ab'.repeat(20)}`;
const BINDING = { chainId: '560048', contract: `0x${'cd'.repeat(20)}`, registerId: REGISTER };
const MAX_TOKEN = ((1n << 256n) - 1n).toString();
const entry = (version = '101') => ({ version, holder: HOLDER, effectiveAt: version, supersededAt: '0', recordCommitment: REGISTER, previousCommitment: REGISTER, registryReference: REGISTER });
const fake = (respond) => new KitProjectionSource({ baseUrl: 'https://kit.invalid', fetchImpl: async (url, options) => new Response(JSON.stringify(respond(new URL(url), options)), { headers: { 'content-type': 'application/json' } }) });
const api = (extra = {}) => createApplicationProjectionApi({ projectionBinding: BINDING, projectionSource: { registerId: async () => REGISTER, entryCount: async () => '101', isFinalAsOf: async () => false, holderAsOf: async () => HOLDER }, ...extra });
const get = (source, path) => source.handle('GET', `/v1/oracle/projection/${path}`);
const configEnv = (baseUrl = 'https://kit.invalid') => ({ GIRAFFE_ORACLE_KIT_READ_API_URL: baseUrl, GIRAFFE_ORACLE_PROJECTION_CHAIN_ID: BINDING.chainId, GIRAFFE_ORACLE_PROJECTION_CONTRACT: BINDING.contract, GIRAFFE_ORACLE_PROJECTION_REGISTER_ID: REGISTER });

// Pinned Kit API: ERC8415-Kit 93035d2c api/routes.ts and api/serialize.ts.
test('latest entry uses count then exact version beyond the first 100 entries', async () => {
  const paths = [];
  const kit = fake((url, options) => {
    paths.push(url.pathname);
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    if (url.pathname === '/projection/42') return { tokenId: '42', registerId: REGISTER, entryCount: 101 };
    if (url.pathname === '/projection/42/entry/version/101') return { tokenId: '42', entry: entry() };
    assert.fail(`Unexpected path ${url.pathname}`);
  });
  assert.equal(await kit.registerId('42'), REGISTER);
  assert.equal((await kit.currentEntry('42')).version, '101');
  assert.deepEqual(paths, ['/projection/42', '/projection/42', '/projection/42/entry/version/101']);
});

test('uint256 tokens survive adapter and HTTP API without number conversion', async () => {
  const kit = fake((url) => {
    assert.equal(url.pathname, `/projection/${MAX_TOKEN}`);
    return { tokenId: MAX_TOKEN, registerId: REGISTER, entryCount: 0 };
  });
  const a = api({ projectionSource: kit });
  const result = await get(a, MAX_TOKEN);
  assert.equal(result.status, 200);
  assert.equal(result.body.tokenId, MAX_TOKEN);
  assert.equal(result.body.entryCount, '0');
  for (const invalid of [(1n << 256n).toString(), '01', '-1', '1.5', '1e2']) assert.equal((await get(a, invalid)).status, 400);
  for (const tail of ['entry/version/', 'entry/as-of/', 'holder/as-of/', 'finality/as-of/']) {
    assert.equal((await get(a, `1/${tail}${1n << 64n}`)).status, 400);
  }
});

test('finality accepts only literal booleans, never truthiness or a missing field', async () => {
  for (const value of ['false', 0, null, undefined, {}, []]) {
    const kit = fake(() => ({ tokenId: '1', instant: '99', final: value }));
    await assert.rejects(() => kit.isFinalAsOf('1', '99'), { errorCode: 'PROJECTION_SOURCE_MALFORMED', status: 502 });
  }
  assert.equal(await fake(() => ({ tokenId: '1', instant: '99', final: false })).isFinalAsOf('1', '99'), false);
});

test('source success payloads validate requested identity and exact decimal fields', async () => {
  for (const payload of [null, [], {}, { tokenId: '2', instant: '99', final: false }, { tokenId: '1', instant: '98', final: false }]) {
    await assert.rejects(() => fake(() => payload).isFinalAsOf('1', '99'), { errorCode: 'PROJECTION_SOURCE_MALFORMED' });
  }
  for (const count of [undefined, -1, 1.1, Number.MAX_SAFE_INTEGER + 1, '01', (1n << 64n).toString()]) {
    await assert.rejects(() => fake(() => ({ tokenId: '1', entryCount: count })).entryCount('1'), { errorCode: 'PROJECTION_SOURCE_MALFORMED' });
  }
  for (const value of [{ ...entry(), version: '100' }, { ...entry(), effectiveAt: 100 }, { ...entry(), holder: 'invalid' }]) {
    await assert.rejects(() => fake(() => ({ tokenId: '1', entry: value })).entryAt('1', '101'), { errorCode: 'PROJECTION_SOURCE_MALFORMED' });
  }
  await assert.rejects(() => fake(() => ({ tokenId: '1', entryCount: 0 })).currentEntry('1'), { errorCode: 'EMPTY_PROJECTION', status: 404 });
});

test('every successful route exposes the same pinned server-owned source identity', async () => {
  const a = api();
  for (const tail of ['', '/holder/as-of/99', '/finality/as-of/99', '/position']) {
    const result = await get(a, `42${tail}`);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.source, BINDING);
    assert.equal(result.body.tokenId, '42');
    if (tail.includes('as-of')) assert.equal(result.body.instant, '99');
  }
  const mismatch = api({ projectionSource: { registerId: async () => `0x${'ef'.repeat(32)}` } });
  for (const tail of ['', '/entry/current', '/holder/as-of/99', '/finality/as-of/99', '/position']) {
    assert.equal((await get(mismatch, `1${tail}`)).body.errorCode, 'PROJECTION_SOURCE_IDENTITY_MISMATCH');
  }
});

test('position outages and unexpected projection failures stay bounded and do not leak', async () => {
  const failedOwner = api({ positionSource: { ownerOf: async () => { throw new Error('private-rpc-detail'); } } });
  assert.deepEqual(await get(failedOwner, '1/position'), { status: 503, body: { ok: false, errorCode: 'POSITION_SOURCE_UNAVAILABLE' } });
  assert.equal((await get(failedOwner, '1/holder/as-of/99')).body.holder, HOLDER);
  const failedProjection = api({ projectionSource: { registerId: async () => { throw new Error('private-kit-detail'); } } });
  assert.deepEqual(await get(failedProjection, '1/finality/as-of/99'), { status: 503, body: { ok: false, errorCode: 'PROJECTION_SOURCE_UNAVAILABLE' } });
});

test('configuration is explicit, validated and unavailable until all binding fields exist', async () => {
  for (const key of Object.keys(configEnv())) {
    const env = configEnv(); delete env[key];
    const configured = assembleApplicationProjection(loadApplicationProjectionConfig(env));
    assert.equal((await get(createApplicationProjectionApi(configured), '1')).body.errorCode, 'PROJECTION_SOURCE_NOT_CONFIGURED');
  }
  for (const change of [{ GIRAFFE_ORACLE_PROJECTION_CHAIN_ID: '0' }, { GIRAFFE_ORACLE_PROJECTION_CONTRACT: 'bad' }, { GIRAFFE_ORACLE_PROJECTION_REGISTER_ID: 'bad' }, { GIRAFFE_ORACLE_KIT_READ_API_URL: 'http://kit.invalid' }, { GIRAFFE_ORACLE_KIT_READ_API_URL: 'https://kit.invalid?target=other' }]) {
    assert.throws(() => loadConfig({ ...configEnv(), ...change }), /PROJECTION_BINDING_INVALID/);
  }
  assert.deepEqual(assembleApplicationProjection(loadConfig(configEnv()).applicationProjection).projectionBinding, BINDING);
  const missing = createApplicationProjectionApi();
  assert.equal((await missing.handle('POST', '/v1/oracle/projection/1')).status, 405);
});

test('actual startApplication assembles Kit configuration in production and contains provider outages', async () => {
  let malformed = false;
  const paths = [];
  const kit = http.createServer((request, response) => {
    paths.push(request.url);
    response.setHeader('content-type', 'application/json');
    const identity = { tokenId: '42', registerId: REGISTER, entryCount: 101 };
    response.end(JSON.stringify(request.url === '/projection/42' ? identity : {
      tokenId: '42', instant: '99', final: malformed ? 'false' : false,
    }));
  });
  kit.listen(0, '127.0.0.1'); await once(kit, 'listening');
  let state = 'ACCEPTING'; let failures = 0;
  const lifecycle = {
    snapshot: () => ({ state, inFlight: 0, poolCloseAllowed: false, writeResumptionAllowed: false }),
    async quiesce() { state = 'DRAINED'; return this.snapshot(); },
  };
  const env = { ...configEnv(`http://127.0.0.1:${kit.address().port}`), GIRAFFE_ORACLE_ENV: 'production', GIRAFFE_ORACLE_PRODUCTION_ACK: 'l2-l3-profile-locked', GIRAFFE_ORACLE_PROCESS_LIFECYCLE: 'true' };
  const app = startApplication({
    config: { ...loadConfig(env), port: 0 }, signalSource: new EventEmitter(), report() {}, markFailed() { failures++; },
    bootstrapProduction: async () => ({ sourceRegistry: new SourceRegistry(), repositoryLifecycle: lifecycle, positionSource: { ownerOf: async () => { throw new Error('synthetic-owner-outage'); } } }),
  });
  try {
    await app.ready;
    const base = `http://localhost:${app.server.address().port}/v1/oracle/projection/42`;
    const identity = await (await fetch(base)).json();
    assert.deepEqual(identity.source, BINDING);
    const normal = await fetch(`${base}/finality/as-of/99?baseUrl=https://ignored.invalid`);
    assert.equal(normal.status, 200); assert.equal((await normal.json()).final, false);
    malformed = true;
    const bad = await fetch(`${base}/finality/as-of/99`);
    assert.equal(bad.status, 502); assert.equal((await bad.json()).errorCode, 'PROJECTION_SOURCE_MALFORMED');
    const owner = await fetch(`${base}/position`);
    assert.equal(owner.status, 503); assert.equal((await owner.json()).errorCode, 'POSITION_SOURCE_UNAVAILABLE');
    assert.equal((await fetch(base, { method: 'POST' })).status, 405);
    assert.equal(app.snapshot().state, 'ACCEPTING'); assert.equal(failures, 0);
    assert.ok(paths.every((path) => path.startsWith('/projection/42')));
    assert.equal((await app.shutdown()).state, 'DRAINED');
  } finally {
    if (app.server?.listening) await app.shutdown();
    kit.close(); await once(kit, 'close');
  }
});


test('Kit HTTP bodies are JSON-only, bounded to 64 KiB and completely deadline-limited', async () => {
  const malformedBodies = [
    new Response('{}', { headers: { 'content-type': 'text/html' } }),
    new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '65537' } }),
    new Response(' '.repeat(65537), { headers: { 'content-type': 'application/json' } }),
    new Response('{', { headers: { 'content-type': 'application/json' } }),
  ];
  for (const response of malformedBodies) {
    const kit = new KitProjectionSource({ baseUrl: 'https://kit.invalid', fetchImpl: async () => response });
    await assert.rejects(() => kit.registerId('42'), { errorCode: 'PROJECTION_SOURCE_MALFORMED' });
  }
  // Neither fake transport honors the abort signal. The adapter must still finish.
  for (const fetchImpl of [
    async () => new Promise(() => {}),
    async () => new Response(new ReadableStream({ start() {} }), { headers: { 'content-type': 'application/json' } }),
  ]) {
    const kit = new KitProjectionSource({ baseUrl: 'https://kit.invalid', fetchImpl, timeoutMs: 20 });
    await assert.rejects(() => kit.registerId('42'), { errorCode: 'PROJECTION_SOURCE_UNAVAILABLE', status: 503 });
  }
});

test('entry-as-of rejects version zero and intervals that do not cover the requested instant', async () => {
  for (const value of [
    { ...entry('0'), effectiveAt: '50' },
    { ...entry('1'), effectiveAt: '100' },
    { ...entry('1'), effectiveAt: '50', supersededAt: '99' },
    { ...entry('1'), effectiveAt: '50', supersededAt: '49' },
  ]) {
    await assert.rejects(() => fake(() => ({ tokenId: '1', instant: '99', entry: value })).entryAsOf('1', '99'), { errorCode: 'PROJECTION_SOURCE_MALFORMED' });
  }
  const valid = { ...entry('1'), effectiveAt: '50', supersededAt: '100' };
  assert.deepEqual(await fake(() => ({ tokenId: '1', instant: '99', entry: valid })).entryAsOf('1', '99'), valid);
});
