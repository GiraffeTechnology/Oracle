import assert from 'node:assert/strict';
import test from 'node:test';
import { createRepositoryExecutionScope } from '../src/services/repository-execution-scope.js';
import { MySqlOracleRepository } from '../src/adapters/mysql-repository.js';
import { EvmReceiptReadSource, RECEIPT_READ_ABI, RECEIPT_SCHEMA_ID } from '../src/adapters/evm-receipt-read-source.js';
import { assembleReceiptRead } from '../src/config/receipt-read.js';
import { createApplicationProjectionApi } from '../src/services/application-projection-api.js';
import { createRequestHandler } from '../src/app.js';
import { startApplication } from '../src/main.js';

const address = (digit) => `0x${digit.repeat(40)}`;
const hash = (digit) => `0x${digit.repeat(64)}`;
const target = { chainId: '11155111', contract: address('a'), registerId: hash('b'), sourceAuthority: address('c') };
// Independent fixed ABI wire vectors; root unit tests need no contract toolchain.
const schemaHash = '0xee5bd417e3dddcc2dfb85f45260f817dc32e4c1945000d5bb7a738c142a4f9e3';
const selectors = { '0xbbc2a065': 'registerId', '0x42101596': 'sourceAuthority',
  '0x6352211e': 'ownerOf', '0x1d1b039c': 'entryCount', '0xa3b200a4': 'mintPolicyHash',
  '0xf6752412': 'entryAt', '0x5b88055d': 'receiptBinding' };
function encodeWords(values) {
  return '0x' + values.flat().map((value) =>
    (typeof value === 'string' && value.startsWith('0x') ? value.slice(2) : BigInt(value).toString(16)).padStart(64, '0')).join('');
}
const code = '0x60006000'; // Synthetic test code only, never a deployed profile.
const first = [hash('1'), hash('0'), hash('3'), address('4'), '1', '100', '200'];
const latest = [hash('2'), hash('1'), hash('3'), address('5'), '2', '200', '0'];
function fixture({ chain = '0xaa36a7', observedCode = code, reorg = false, absent = false, alterCall, afterRequest, timeoutMs = 1000 } = {}) {
  const calls = [];
  let canonicalReads = 0;
  const rpc = { async request({ method, params }) {
    calls.push({ method, params });
    let result;
    if (method === 'eth_chainId') result = typeof chain === 'function' ? chain(calls) : chain;
    else if (method === 'eth_getCode') result = observedCode;
    else if (method === 'eth_getBlockByNumber') {
      if (params[0] === 'latest') result = { number: '0xa', hash: hash('6') };
      else {
        canonicalReads += 1;
        result = { number: '0x9', hash: reorg && canonicalReads > 1 ? hash('8') : hash('7') };
      }
    } else if (method === 'eth_call') {
      const data = params[0].data;
      const name = selectors[data.slice(0, 10)];
      assert.ok(name, 'unexpected receipt ABI selector');
      const parsed = { name, args: [0n, data.length >= 138 ? BigInt('0x' + data.slice(74, 138)) : 0n] };
      const outputs = {
        registerId: [target.registerId], sourceAuthority: [target.sourceAuthority], ownerOf: [address('9')],
        entryCount: [2n], mintPolicyHash: [hash('e')],
        entryAt: [parsed.name === 'entryAt' && String(parsed.args[1]) === '1' ? first : latest],
        receiptBinding: [absent ? Array(5).fill(hash('0')) : [RECEIPT_SCHEMA_ID, hash('e'), hash('f'), hash('a'), hash('d')]],
      };
      const values = alterCall?.(parsed.name, outputs[parsed.name]) ?? outputs[parsed.name];
      result = encodeWords(values);
    } else throw new Error(`READ_METHOD_NOT_ALLOWED:${method}`);
    await afterRequest?.(method, params);
    return result;
  } };
  const source = new EvmReceiptReadSource({ rpc, binding: target, expectedRuntimeCode: code, minConfirmations: 2, timeoutMs });
  return { source, calls, rpc, api: createApplicationProjectionApi({ receiptProjectionSource: source }) };
}
const get = (f, tail = 'version/1') => f.api.handle('GET', `/v1/oracle/projection/7/receipt/${tail}`);

test('receipt API uses the existing full ABI and one confirmed block for historical receipt evidence', async () => {
  assert.equal(RECEIPT_SCHEMA_ID, schemaHash);
  assert.equal(RECEIPT_READ_ABI.length, Object.keys(selectors).length);
  const f = fixture();
  const result = await get(f);
  assert.equal(result.status, 200);
  assert.equal(result.body.tokenId, '7');
  assert.deepEqual(result.body.source, target);
  assert.deepEqual(result.body.block, { number: '9', hash: hash('7') });
  assert.equal(result.body.entry.version, '1');
  assert.equal(result.body.entry.holder, address('4'));
  assert.equal(result.body.receiptBinding.schemaId, RECEIPT_SCHEMA_ID);
  assert.equal(result.body.receiptAvailable, true);
  assert.equal(result.body.evidence.kind, 'canonical-contract-state');
  assert.equal(result.body.evidence.minimumConfirmations, 2);
  assert.equal(result.body.originalDocumentVerified, undefined);
  assert.equal(result.body.transactionHash, undefined);
  const pinned = f.calls.filter(({ method }) => method === 'eth_call' || method === 'eth_getCode');
  assert.equal(pinned.length, 8);
  for (const { params } of pinned) assert.deepEqual(params[1], { blockHash: hash('7'), requireCanonical: true });
  assert.equal((await get(f, 'current')).body.entry.version, '2');
});

test('receipt identity rejects wrong chain, switched provider, code, register and source authority', async () => {
  for (const options of [
    { chain: '0x1' },
    { chain: (calls) => calls.filter(({ method }) => method === 'eth_chainId').length > 1 ? '0x1' : '0xaa36a7' },
    { observedCode: '0x60016000' },
    { alterCall: (name, values) => name === 'registerId' ? [hash('8')] : values },
    { alterCall: (name, values) => name === 'sourceAuthority' ? [address('8')] : values },
  ]) {
    const result = await get(fixture(options));
    assert.equal(result.status, 409);
    assert.equal(result.body.entry, undefined);
  }
});

test('receipt reads reject reorg, future versions and invalid tuple or policy bindings', async () => {
  assert.equal((await get(fixture({ reorg: true }))).body.errorCode, 'RECEIPT_SOURCE_REORGED');
  assert.equal((await get(fixture(), 'version/3')).body.errorCode, 'UNKNOWN_VERSION');
  for (const [name, output, expected] of [
    ['mintPolicyHash', [hash('0')], 503],
    ['entryAt', [[...first.slice(0, 4), '2', '100', '200']], 502],
    ['entryAt', [[...first.slice(0, 6), '0']], 502],
    ['receiptBinding', [[RECEIPT_SCHEMA_ID, hash('e'), hash('0'), hash('a'), hash('d')]], 502],
    ['receiptBinding', [[RECEIPT_SCHEMA_ID, hash('8'), hash('f'), hash('a'), hash('d')]], 502],
  ]) assert.equal((await get(fixture({ alterCall: (method, values) => method === name ? output : values }))).status, expected);
  const absent = await get(fixture({ absent: true }));
  assert.equal(absent.status, 200);
  assert.equal(absent.body.receiptAvailable, false);
});

test('receipt read configuration is fixed by deployment and resolves only a read capability', async () => {
  assert.deepEqual(await assembleReceiptRead({}), { receiptProjectionSource: null });
  const f = fixture();
  const resolved = [];
  const configuration = { profileId: 'oracle-receipt-read.v1', rpcRef: 'deployment://oracle/receipt-read',
    target, expectedRuntimeCode: code, minConfirmations: 2 };
  const assembled = await assembleReceiptRead({ receiptReadConfiguration: configuration,
    resolver: { async resolve(...args) { resolved.push(args); return f.rpc; } } });
  assert.deepEqual(resolved, [['deployment://oracle/receipt-read', 'receipt-rpc']]);
  assert.deepEqual(Object.keys(assembled.receiptProjectionSource), ['receiptSnapshot']);
  assert.equal((await assembled.receiptProjectionSource.receiptSnapshot('7', '1')).entry.version, '1');
  await assert.rejects(assembleReceiptRead({ receiptReadConfiguration: { ...configuration, rpcRef: 'https://caller.invalid' } }), /RECEIPT_READ_CONFIGURATION_INVALID/);
});

test('receipt assembly snapshots deployment identity before asynchronous capability resolution', async () => {
  const f = fixture();
  const configuration = { profileId: 'oracle-receipt-read.v1', rpcRef: 'deployment://oracle/receipt-read',
    target: { ...target }, expectedRuntimeCode: code, minConfirmations: 2 };
  let release;
  const capability = new Promise((resolve) => { release = resolve; });
  const assembling = assembleReceiptRead({ receiptReadConfiguration: configuration,
    resolver: { resolve: () => capability } });
  configuration.expectedRuntimeCode = '0x60016000';
  configuration.minConfirmations = 256;
  configuration.target.chainId = '1';
  release(f.rpc);
  const assembled = await assembling;
  const snapshot = await assembled.receiptProjectionSource.receiptSnapshot('7', '1');
  assert.equal(snapshot.source.chainId, target.chainId);
  assert.equal(snapshot.evidence.minimumConfirmations, 2);
  assert.equal(snapshot.entry.version, '1');
});

test('HTTP receipt dispatch refuses missing configuration and has no ingress, as-of or caller-selected RPC', async () => {
  const handler = createRequestHandler({ config: {}, sourceRegistry: {} });
  const response = { writeHead(status) { this.status = status; }, end(text) { this.body = JSON.parse(text); } };
  await handler({ method: 'GET', url: '/v1/oracle/projection/7/receipt/version/1' }, response);
  assert.equal(response.status, 503);
  assert.equal(response.body.errorCode, 'RECEIPT_SOURCE_NOT_CONFIGURED');
  const entry = { version: '1', holder: address('4') };
  const projectionOnly = createApplicationProjectionApi({ projectionBinding: target,
    projectionSource: { registerId: async () => target.registerId, currentEntry: async () => entry } });
  assert.equal((await projectionOnly.handle('GET', '/v1/oracle/projection/7/receipt/current')).status, 503);
  const independent = await projectionOnly.handle('GET', '/v1/oracle/projection/7/entry/current');
  assert.equal(independent.status, 200);
  assert.deepEqual(independent.body.entry, entry);
  const f = fixture();
  for (const version of ['0', '01', '-1', '18446744073709551616']) assert.equal((await get(f, `version/${version}`)).status, 400);
  for (const method of ['POST', 'PATCH', 'DELETE']) assert.equal((await f.api.handle(method, '/v1/oracle/projection/7/receipt/version/1')).status, 405);
  assert.equal(await f.api.handle('GET', '/v1/oracle/projection/7/receipt/as-of/100'), null);
  assert.equal(await f.api.handle('GET', '/v1/oracle/projection/7/receipt/ingest'), null);
  assert.equal(f.calls.length, 0);
});

test('receipt read transport uncertainty returns unavailable without automatic retries or transaction methods', async () => {
  const f = fixture({ timeoutMs: 5, afterRequest: () => new Promise(() => {}) });
  assert.equal((await get(f)).status, 503);
  assert.equal(f.calls.length, 1);
  assert.ok(f.calls.every(({ method }) => ['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call'].includes(method)));
});

test('an expired observation cannot start transport through a delayed guard callback', async () => {
  let deferred;
  let transports = 0;
  const source = new EvmReceiptReadSource({
    rpc: { request() { transports += 1; return Promise.resolve('0xaa36a7'); } },
    binding: target, expectedRuntimeCode: code, minConfirmations: 2, timeoutMs: 5,
    guardRead: (operation) => { deferred = operation; return new Promise(() => {}); },
  });
  await assert.rejects(source.receiptSnapshot('7', '1'), /RECEIPT_SOURCE_UNAVAILABLE/);
  assert.equal(typeof deferred, 'function');
  assert.throws(() => deferred(), /RECEIPT_SOURCE_UNAVAILABLE/);
  assert.equal(transports, 0);
});

test('the real application start path carries the production assembly receipt capability to HTTP', async () => {
  const f = fixture();
  const app = startApplication({
    config: { environment: 'production', host: '127.0.0.1', port: 0, externalWritesEnabled: false, processLifecycleEnabled: false },
    bootstrapProduction: async () => ({ sourceRegistry: {}, receiptProjectionSource: f.source }),
    report: () => {}, markFailed: () => assert.fail('application startup failed'),
  });
  try {
    await app.ready;
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/v1/oracle/projection/7/receipt/version/1`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).entry.version, '1');
  } finally {
    if (app.server?.listening) await new Promise((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve()));
  }
});


test('receipt HTTP deadline returns while the real repository scope retains stalled transport for drain', async () => {
  let release, entered;
  const blocked = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { entered = resolve; });
  let calls = 0;
  const repository = new MySqlOracleRepository({ pool: { getConnection() { throw new Error('no database work expected'); } } });
  const scope = createRepositoryExecutionScope({ repository, isCompromised: () => false });
  const assembled = await assembleReceiptRead({
    receiptReadConfiguration: { profileId: 'oracle-receipt-read.v1', rpcRef: 'deployment://oracle/receipt-read',
      target, expectedRuntimeCode: code, minConfirmations: 2 },
    resolver: { resolve: async () => ({ request() { calls += 1; entered(); return blocked; } }) },
    timeoutMs: 5,
    guardRead: (operation) => scope.guardSideEffect(operation),
    runInScope: (operation) => scope.run(operation),
  });
  let watchdog;
  try {
    const response = assembled.receiptProjectionSource.receiptSnapshot('7', '1');
    await started;
    await assert.rejects(Promise.race([response, new Promise((_, reject) => {
      watchdog = setTimeout(() => reject(new Error('HTTP_DEADLINE_DEFEATED_BY_DRAIN')), 1000);
    })]), /RECEIPT_SOURCE_UNAVAILABLE/);
    assert.equal(scope.snapshot().inFlight, 1);
    assert.equal(calls, 1);
  } finally {
    clearTimeout(watchdog);
    release('0xaa36a7');
    const drained = await scope.drain({ timeoutMs: 1000 });
    assert.equal(drained.state, 'DRAINED');
    assert.equal(drained.inFlight, 0);
  }
  assert.equal(calls, 1, 'expired observation must not start another RPC');
});
