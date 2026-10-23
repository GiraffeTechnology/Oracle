import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplicationProjectionApi } from '../src/services/application-projection-api.js';
import { RECEIPT_BINDING_SCHEMA } from '../src/services/source-receipt-ingress.js';
const word = (n) => `0x${n.repeat(64)}`;
const addr = (n) => `0x${n.repeat(40)}`;
const domain = {
  chainId: '31337',
  contract: addr('a'),
  registerId: word('b'),
  sourceAuthority: addr('c'),
};
const snapshot = () => ({
  ...domain,
  tokenId: '1',
  block: { number: '10', hash: word('d') },
  mintPolicyHash: word('e'),
  entry: {
    version: '2',
    holder: addr('f'),
    recordCommitment: word('1'),
    previousCommitment: word('2'),
    registryReference: word('3'),
    effectiveAt: '100',
    supersededAt: '0',
  },
  receiptBinding: {
    schemaId: RECEIPT_BINDING_SCHEMA,
    mintPolicyHash: word('e'),
    segmentDigest: word('4'),
    requestHash: word('5'),
    receiptDocumentHash: word('6'),
  },
});
function fixture(value = snapshot()) {
  const calls = [];
  const api = createApplicationProjectionApi({
    receiptProjectionBinding: domain,
    receiptProjectionSource: {
      async receiptSnapshot(...args) {
        calls.push(args);
        return value;
      },
    },
  });
  return {
    api,
    calls,
    get: (path = 'current') => api.handle('GET', `/v1/oracle/projection/1/receipt/${path}`),
  };
}
test('receipt reads expose only one pinned snapshot, never sequential legacy fallbacks', async () => {
  const value = snapshot();
  value.rawDocument = 'must not be returned';
  value.receiptBinding.signature = 'must not be returned';
  const f = fixture(value);
  const result = await f.get();
  assert.equal(result.status, 200);
  assert.equal(result.body.receiptAvailable, true);
  assert.deepEqual(result.body.source, domain);
  assert.deepEqual(result.body.block, value.block);
  assert.equal(result.body.rawDocument, undefined);
  assert.equal(result.body.receiptBinding.signature, undefined);
  assert.deepEqual(f.calls, [['1', 'latest']]);
  assert.equal((await f.get('version/2')).status, 200);
  assert.equal((await f.get('version/1')).status, 502);
  assert.equal((await f.get('version/0')).status, 400);
});
test('legacy missing policy and absent binding cannot become receipt proof', async () => {
  const empty = snapshot();
  for (const key of Object.keys(empty.receiptBinding)) empty.receiptBinding[key] = word('0');
  const absent = await fixture(empty).get();
  assert.equal(absent.status, 200);
  assert.equal(absent.body.receiptAvailable, false);
  empty.mintPolicyHash = word('0');
  assert.equal((await fixture(empty).get()).status, 503);
  assert.equal(
    (
      await createApplicationProjectionApi().handle(
        'GET',
        '/v1/oracle/projection/1/receipt/current',
      )
    ).status,
    503,
  );
});
test('wrong domain, version, block, partial/foreign schema and mismatched policy fail closed', async () => {
  for (const mutate of [
    (value) => {
      value.chainId = '1';
    },
    (value) => {
      value.contract = addr('d');
    },
    (value) => {
      value.registerId = word('d');
    },
    (value) => {
      value.sourceAuthority = addr('d');
    },
    (value) => {
      value.tokenId = '2';
    },
    (value) => {
      value.block.hash = word('0');
    },
    (value) => {
      value.block.number = '01';
    },
    (value) => {
      value.entry.version = '0';
    },
    (value) => {
      value.entry.holder = addr('0');
    },
    (value) => {
      value.entry.supersededAt = '99';
    },
    (value) => {
      value.receiptBinding.schemaId = word('a');
    },
    (value) => {
      value.receiptBinding.mintPolicyHash = word('b');
    },
    (value) => {
      value.receiptBinding.requestHash = word('0');
    },
    (value) => {
      delete value.receiptBinding;
    },
  ]) {
    const value = snapshot();
    mutate(value);
    assert.equal((await fixture(value).get()).status, 502);
  }
});
test('read routes reject writes and never install an ingestion/upload endpoint', async () => {
  const f = fixture();
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'])
    assert.equal(
      (await f.api.handle(method, '/v1/oracle/projection/1/receipt/current')).status,
      405,
    );
  assert.equal(await f.api.handle('GET', '/v1/oracle/projection/1/receipt/ingest'), null);
  assert.equal(f.calls.length, 0);
});
