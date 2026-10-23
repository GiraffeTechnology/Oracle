import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { id } from 'ethers';
import {
  assembleSourceReceipt,
  validateSourceReceiptConfiguration,
} from '../../src/config/source-receipt-assembly.js';
import { SourceRegistry } from '../../src/domain/source-registry.js';
import { KeySetRegistry } from '../../src/domain/key-set-registry.js';
import { canonicalJson, evidenceHash } from '../../src/domain/canonical-json.js';
import {
  SOURCE_RECEIPT_SCHEMA,
  RECEIPT_BINDING_SCHEMA,
} from '../../src/services/source-receipt-ingress.js';
import { FixedSourceTransportAdapter } from '../../src/adapters/fixed-source-transport.js';
import { createApplicationProjectionApi } from '../../src/services/application-projection-api.js';
import { sqlFixture } from '../fixtures/receipt-journal.mjs';

const now = new Date('2026-10-16T18:00:00.000Z');
const sourceId = 'synthetic-registry';
const target = {
  chainId: '31337',
  contract: `0x${'a'.repeat(40)}`,
  registerId: id('register'),
  sourceAuthority: `0x${'b'.repeat(40)}`,
};
const configuration = (domain = target) => ({
  profileId: 'oracle-source-receipt.v1',
  sourceRoutes: [{ registrationSource: 'REG_DIRECT', sourceId }],
  schemaVersion: SOURCE_RECEIPT_SCHEMA,
  target: domain,
  rpcRef: 'deployment://receipt/rpc',
  executionClientRef: 'deployment://receipt/execution',
  signerReference: 'deployment://receipt/existing-source',
  minConfirmations: 2,
  formatVerifierRef: 'deployment://receipt/format',
  formatProfileId: 'synthetic-only.registration.v1',
});
function assemblyFixture(overrides = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const keySetRegistry = new KeySetRegistry();
  keySetRegistry.register({
    keySetId: 'synthetic-registry-keys',
    publicKey,
    validFrom: '2026-01-01T00:00:00.000Z',
  });
  const sourceRegistry = new SourceRegistry([
    {
      id: sourceId,
      displayName: 'Synthetic registry',
      kind: 'REGISTRY',
      keySetId: 'synthetic-registry-keys',
      schemaVersions: [SOURCE_RECEIPT_SCHEMA],
      active: true,
    },
  ]);
  const db = sqlFixture();
  const calls = [];
  const runtime = { sourceRegistry, operationalState: {} };
  const input = {
    receiptConfiguration: configuration(),
    l2: {
      sources: [
        {
          sourceId,
          kind: 'REGISTRY',
          keySetRef: 'deployment://source-keyset/synthetic',
          schemaVersions: [SOURCE_RECEIPT_SCHEMA],
        },
      ],
    },
    ports: {
      repository: db.repository,
      registrySource: {
        async fetchByFixedReference() {
          throw new Error('NO_SOURCE_FIXTURE');
        },
      },
    },
    runtime,
    config: { externalWritesEnabled: true },
    clock: () => now,
    resolver: {
      async resolve(ref, kind) {
        calls.push([ref, kind]);
        if (kind === 'receipt-format-verifier')
          return {
            profileId: configuration().formatProfileId,
            async verifyOriginalRegistration() {
              throw new Error('NO_APPROVED_FORMAT_FIXTURE');
            },
          };
        if (kind === 'source-keyset') return keySetRegistry;
        if (kind === 'receipt-rpc')
          return {
            async request() {
              throw new Error('NO_RPC_FIXTURE');
            },
          };
        if (kind === 'receipt-execution')
          return {
            async submit() {
              throw new Error('NO_EXECUTION_FIXTURE');
            },
            async lookup() {
              return null;
            },
          };
      },
    },
    ...overrides,
  };
  return {
    input,
    keySetRegistry,
    sourceRegistry,
    privateKey,
    calls,
    db,
    runtime,
    build: (extra = {}) => assembleSourceReceipt({ ...input, ...extra }),
  };
}

test('receipt configuration is inert by default and does not resolve a signer or source', async () => {
  const f = assemblyFixture();
  assert.deepEqual(await f.build({ receiptConfiguration: undefined }), {
    sourceReceiptIngress: null,
    receiptProjectionSource: null,
    receiptProjectionBinding: null,
  });
  assert.deepEqual(f.calls, []);
});
test('strict fixed route/configuration rejects caller endpoints, missing proof capabilities, and unapproved source schema', async () => {
  for (const mutate of [
    (value) => {
      value.url = 'https://example.invalid';
    },
    (value) => {
      value.signerReference = 'raw-secret';
    },
    (value) => {
      value.sourceRoutes[0].registrationSource = 'registry';
    },
    (value) => {
      value.sourceRoutes[0].holder = target.sourceAuthority;
    },
    (value) => {
      value.sourceRoutes.push(value.sourceRoutes[0]);
    },
    (value) => {
      value.minConfirmations = 0;
    },
  ]) {
    const value = configuration();
    mutate(value);
    assert.throws(() => validateSourceReceiptConfiguration(value));
  }
  const f = assemblyFixture();
  await assert.rejects(() => f.build({ l2: { sources: [] } }), /SOURCE_PROFILE_NOT_APPROVED/);
  await assert.rejects(
    () =>
      f.build({
        resolver: {
          async resolve() {
            return null;
          },
        },
      }),
    /(?:CAPABILITY|FORMAT_VERIFIER)_UNAVAILABLE/,
  );
  await assert.rejects(() => f.build({ ports: { repository: {} } }), /DEPENDENCY_INVALID/);
  f.keySetRegistry.replace('synthetic-registry-keys', 'REVOKED');
  await assert.rejects(() => f.build(), /KEY_SET_NOT_ACTIVE/);
});
test('server-owned routes expose only ingest/reconcile and operational gates refuse before source fetch', async () => {
  const f = assemblyFixture();
  const built = await f.build();
  assert.deepEqual(Object.keys(built.sourceReceiptIngress), ['REG_DIRECT']);
  assert.deepEqual(Object.keys(built.sourceReceiptIngress.REG_DIRECT), ['ingest', 'reconcile']);
  assert.deepEqual(Object.keys(built.receiptProjectionSource), ['receiptSnapshot']);
  for (const flag of ['compromised', 'signerRecoveryRequired']) {
    f.runtime.operationalState[flag] = true;
    await assert.rejects(
      () => built.sourceReceiptIngress.REG_DIRECT.ingest({ recordRef: 'record:1' }),
      /WRITES_DISABLED/,
    );
    f.runtime.operationalState[flag] = false;
  }
  f.input.config.externalWritesEnabled = false;
  await assert.rejects(
    () => built.sourceReceiptIngress.REG_DIRECT.ingest({ recordRef: 'record:1' }),
    /WRITES_DISABLED/,
  );
  assert.equal(f.db.database.rows.size, 0);
});

test(
  'assembled signed fixed source → durable SQL journal → checked local contract → pinned read API; restart and reorg',
  { timeout: 120000 },
  async (t) => {
    // Ephemeral local chain and ephemeral Ed25519 keys; the SQL driver is an explicit capture fixture.
    const configHome = mkdtempSync(join(tmpdir(), 'receipt-assembly-'));
    const old = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = configHome;
    t.after(() => {
      if (old === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = old;
      rmSync(configHome, { recursive: true, force: true });
    });
    const require = createRequire(import.meta.url);
    const hre = require('hardhat');
    const solc = createRequire(require.resolve('hardhat/package.json'))('solc');
    const output = JSON.parse(
      solc.compile(
        JSON.stringify({
          language: 'Solidity',
          sources: {
            'OracleRegisterProjection.sol': {
              content: readFileSync(
                new URL('../../erc-8415/contracts/OracleRegisterProjection.sol', import.meta.url),
                'utf8',
              ),
            },
          },
          settings: {
            optimizer: { enabled: true, runs: 200 },
            viaIR: true,
            outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
          },
        }),
      ),
    );
    assert.deepEqual(
      (output.errors ?? []).filter((value) => value.severity === 'error'),
      [],
    );
    const compiled = output.contracts['OracleRegisterProjection.sol'].OracleRegisterProjection;
    const [source, owner, holder, competingHolder] = await hre.ethers.getSigners();
    const contract = await new hre.ethers.ContractFactory(
      compiled.abi,
      compiled.evm.bytecode.object,
      source,
    ).deploy(target.registerId, source.address);
    await contract.waitForDeployment();
    const domain = {
      ...target,
      contract: (await contract.getAddress()).toLowerCase(),
      sourceAuthority: source.address.toLowerCase(),
    };
    const f = assemblyFixture();
    const policy = {
      receiptFormatHash: id(configuration().formatProfileId),
      registrationSource: 'REG_DIRECT',
      target: domain,
    };
    const binding = {
      schemaId: RECEIPT_BINDING_SCHEMA,
      mintPolicyHash: id(canonicalJson(policy)),
      segmentDigest: id('source-segment'),
      requestHash: id('source-request'),
      receiptDocumentHash: id('original-source-document'),
    };
    await (
      await contract.mintReceiptFromSource(
        owner.address,
        1n,
        id('initial'),
        id('initial-ref'),
        owner.address,
        100n,
        binding.mintPolicyHash,
      )
    ).wait();
    const checkpoint = await hre.network.provider.request({ method: 'evm_snapshot', params: [] });
    let envelope = {
      sourceId,
      schemaVersion: SOURCE_RECEIPT_SCHEMA,
      recordReference: 'record:registration-1',
      issuedAt: now.toISOString(),
      nonce: 'nonce-001',
      idempotencyKey: 'receipt-001',
      payload: {
        registrationSource: 'REG_DIRECT',
        target: domain,
        tokenId: '1',
        expectedPreviousVersion: '1',
        previousCommitment: id('initial'),
        recordCommitment: id('registered'),
        registryReference: id('reference'),
        holder: holder.address.toLowerCase(),
        effectiveAt: '200',
        binding,
      },
    };
    let fetched = 0,
      submitted = 0,
      race = false,
      revoke = false;
    const executions = new Map();
    const originals = new Map();
    const documentFor = (value) => ({
      format: configuration().formatProfileId,
      registrationSource: value.registrationSource,
      tokenId: value.tokenId,
      holder: value.holder,
      effectiveAt: value.effectiveAt,
      recordCommitment: value.recordCommitment,
      registryReference: value.registryReference,
      previousCommitment: value.previousCommitment,
      expectedPreviousVersion: value.expectedPreviousVersion,
      target: value.target,
      mintPolicyHash: value.binding.mintPolicyHash,
      requestHash: value.binding.requestHash,
      segmentDigest: value.binding.segmentDigest,
    });
    const formatVerifier = {
      profileId: configuration().formatProfileId,
      async verifyOriginalRegistration({ profileId, intent }) {
        const original = originals.get(intent.recordReference);
        assert.ok(Buffer.isBuffer(original));
        const parsed = JSON.parse(original.toString('utf8'));
        assert.deepEqual(parsed, documentFor(intent));
        assert.equal(
          intent.binding.receiptDocumentHash,
          `0x${createHash('sha256').update(original).digest('hex')}`,
        );
        assert.equal(id(canonicalJson(policy)), intent.binding.mintPolicyHash);
        assert.equal(await contract.mintPolicyHash(intent.tokenId), intent.binding.mintPolicyHash);
        assert.equal(parsed.format, profileId);
        return {
          verified: true,
          profileId,
          intentHash: evidenceHash(intent),
          receiptDocumentHash: intent.binding.receiptDocumentHash,
          mintPolicyHash: intent.binding.mintPolicyHash,
          receiptFormatHash: policy.receiptFormatHash,
        };
      },
    };
    const fixedSource = new FixedSourceTransportAdapter({
      sourceRegistration: { sourceId },
      transport: {
        async fetch({ sourceRegistrationId, recordRef }) {
          const original = documentFor(envelope.payload);
          originals.set(envelope.recordReference, Buffer.from(canonicalJson(original)));
          envelope.payload.binding.receiptDocumentHash = `0x${evidenceHash(original)}`;
          fetched++;
          assert.equal(sourceRegistrationId, sourceId);
          assert.equal(recordRef, envelope.recordReference);
          return {
            authenticated: true,
            sourceId,
            schemaVersion: SOURCE_RECEIPT_SCHEMA,
            record: structuredClone(envelope.payload),
            recordHash: evidenceHash(envelope.payload),
            envelope: structuredClone(envelope),
            signature: sign(null, Buffer.from(canonicalJson(envelope)), f.privateKey).toString(
              'base64url',
            ),
          };
        },
      },
    });
    const executionClient = {
      async submit(request) {
        submitted++;
        assert.equal(request.signerReference, configuration().signerReference);
        assert.equal(request.data.slice(0, 10), '0x75f1e78f');
        assert.equal(request.value, '0x0');
        const durable = [...f.db.database.rows.values()];
        assert.ok(durable.some((row) => row.state === 'SUBMITTING'));
        if (race)
          await (
            await contract.appendReceiptFromSource(
              2n,
              id('competing-record'),
              id('competing-ref'),
              competingHolder.address,
              150n,
              { ...binding, segmentDigest: id('competing-segment') },
            )
          ).wait();
        try {
          const transaction = await source.sendTransaction({
            to: request.to,
            data: request.data,
            value: request.value,
            chainId: BigInt(request.chainId),
            gasLimit: 3000000n,
          });
          executions.set(request.executionReference, transaction.hash);
          return transaction.hash;
        } catch (error) {
          // Hardhat reports a mined revert as an RPC error. Recover only the exact local tx.
          const block = await hre.network.provider.request({
            method: 'eth_getBlockByNumber',
            params: ['latest', true],
          });
          const transaction = block.transactions.find(
            (tx) => tx.to.toLowerCase() === request.to && tx.input === request.data,
          );
          if (!transaction) throw error;
          executions.set(request.executionReference, transaction.hash);
          return transaction.hash;
        }
      },
      async lookup({ executionReference }) {
        return executions.get(executionReference) ?? null;
      },
    };
    const rpc = {
      async request(request) {
        const result = await hre.network.provider.request(request);
        if (revoke && request.method === 'eth_call')
          f.keySetRegistry.replace('synthetic-registry-keys', 'REVOKED');
        return result;
      },
    };
    const build = () =>
      f.build({
        receiptConfiguration: configuration(domain),
        ports: { repository: f.db.repository, registrySource: fixedSource },
        resolver: {
          async resolve(_ref, kind) {
            return kind === 'receipt-rpc'
              ? rpc
              : kind === 'receipt-execution'
                ? executionClient
                : kind === 'receipt-format-verifier'
                  ? formatVerifier
                  : f.keySetRegistry;
          },
        },
      });
    let assembled = await build();
    let record = await assembled.sourceReceiptIngress.REG_DIRECT.ingest({
      recordRef: envelope.recordReference,
    });
    assert.equal(record.state, 'SUBMITTED');
    assert.equal(submitted, 1);
    await hre.network.provider.request({ method: 'evm_mine', params: [] });
    assembled = await build();
    record = await assembled.sourceReceiptIngress.REG_DIRECT.reconcile({
      intentHash: record.intentHash,
    });
    assert.equal(record.state, 'CONFIRMED');
    assert.equal(record.version, '2');
    assert.equal(submitted, 1);
    const api = createApplicationProjectionApi(assembled);
    const read = await api.handle('GET', '/v1/oracle/projection/1/receipt/current');
    assert.equal(read.status, 200);
    assert.equal(read.body.receiptAvailable, true);
    assert.equal(read.body.entry.holder, holder.address.toLowerCase());
    assert.deepEqual(read.body.receiptBinding, binding);
    assert.equal(await contract.ownerOf(1n), owner.address);
    await assembled.sourceReceiptIngress.REG_DIRECT.ingest({ recordRef: envelope.recordReference });
    assert.equal(submitted, 1);
    assert.equal(fetched, 2);
    await hre.network.provider.request({ method: 'evm_revert', params: [checkpoint] });
    await hre.network.provider.request({ method: 'evm_mine', params: [] });
    record = await assembled.sourceReceiptIngress.REG_DIRECT.reconcile({
      intentHash: record.intentHash,
    });
    assert.equal(record.state, 'REORGED');
    assert.equal(record.blockHash, null);
    assert.equal(submitted, 1);
    const unbound = await api.handle('GET', '/v1/oracle/projection/1/receipt/current');
    assert.equal(unbound.body.receiptAvailable, false);
    // Another source-authorized transaction lands after preflight and before our broker dispatch.
    await (
      await contract.mintReceiptFromSource(
        owner.address,
        2n,
        id('initial'),
        id('initial-ref'),
        owner.address,
        100n,
        binding.mintPolicyHash,
      )
    ).wait();
    const failureCheckpoint = await hre.network.provider.request({
      method: 'evm_snapshot',
      params: [],
    });
    envelope = {
      ...envelope,
      nonce: 'nonce-002',
      idempotencyKey: 'receipt-002',
      recordReference: 'record:registration-2',
      payload: {
        ...envelope.payload,
        tokenId: '2',
        binding: { ...binding, segmentDigest: id('raced-segment') },
      },
    };
    race = true;
    const raced = await assembled.sourceReceiptIngress.REG_DIRECT.ingest({
      recordRef: envelope.recordReference,
    });
    assert.equal(raced.state, 'SUBMITTED');
    assert.equal(raced.reason, 'FAILURE_CONFIRMATIONS_PENDING');
    assert.equal((await contract.currentEntry(2n)).version, 2n);
    assert.equal((await contract.currentEntry(2n)).holder, competingHolder.address);
    assert.equal((await contract.entryAt(2n, 2n)).supersededAt, 0n);
    await assert.rejects(() => contract.receiptBinding(2n, 3n));
    await hre.network.provider.request({ method: 'evm_mine', params: [] });
    const failed = await assembled.sourceReceiptIngress.REG_DIRECT.reconcile({
      intentHash: raced.intentHash,
    });
    assert.equal(failed.state, 'FAILED');
    assert.ok(failed.blockHash);
    assert.equal(failed.version, null);
    const failedCount = submitted;
    await assembled.sourceReceiptIngress.REG_DIRECT.reconcile({ intentHash: raced.intentHash });
    assert.equal(submitted, failedCount);
    // Confirmed no-effect failure releases the lane for a separately authenticated successor.
    race = false;
    envelope = {
      ...envelope,
      nonce: 'nonce-successor',
      idempotencyKey: 'receipt-successor',
      payload: {
        ...envelope.payload,
        expectedPreviousVersion: '2',
        previousCommitment: id('competing-record'),
        binding: { ...binding, segmentDigest: id('successor-segment') },
      },
    };
    const successor = await assembled.sourceReceiptIngress.REG_DIRECT.ingest({
      recordRef: envelope.recordReference,
    });
    assert.equal(successor.state, 'SUBMITTED');
    assert.equal((await contract.currentEntry(2n)).version, 3n);
    assert.equal((await contract.currentEntry(2n)).holder, holder.address);
    const count = submitted;
    await hre.network.provider.request({ method: 'evm_revert', params: [failureCheckpoint] });
    await hre.network.provider.request({ method: 'evm_mine', params: [] });
    const failedReorg = await assembled.sourceReceiptIngress.REG_DIRECT.reconcile({
      intentHash: failed.intentHash,
    });
    assert.equal(failedReorg.state, 'REORGED');
    assert.equal(failedReorg.blockHash, null);
    assert.equal(submitted, count);
    // Revocation during the awaited preflight cannot reach execution or journal preparation.
    race = false;
    revoke = true;
    envelope = {
      ...envelope,
      nonce: 'nonce-003',
      idempotencyKey: 'receipt-003',
      payload: {
        ...envelope.payload,
        tokenId: '1',
        expectedPreviousVersion: '1',
        previousCommitment: id('initial'),
        binding: { ...binding, segmentDigest: id('revoked-segment') },
      },
    };
    await assert.rejects(
      () =>
        assembled.sourceReceiptIngress.REG_DIRECT.ingest({ recordRef: envelope.recordReference }),
      /KEY_SET_NOT_ACTIVE/,
    );
    assert.equal(submitted, count);
  },
);
