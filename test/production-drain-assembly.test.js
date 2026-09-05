import assert from 'node:assert/strict';
import test from 'node:test';
import { assembleProductionApplication } from '../src/config/production-assembly.js';
import { loadL2DeploymentProfile } from '../src/config/deployment-profile.js';
import { loadProtocolProfile } from '../src/protocol/protocol-profile.js';
import { MySqlOracleRepository } from '../src/adapters/mysql-repository.js';
import { SignerSetPolicy } from '../src/domain/signer-set-policy.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function fixture({ commitGate, failCommit = false, publishGate, sourceHandler } = {}) {
  const l2Profile = await loadL2DeploymentProfile('config/l2.production.json');
  const l3Profile = await loadProtocolProfile('config/l3.protocol.wd-0.1.1.json');
  const events = [];
  const commands = new Map();
  const commitEntered = deferred();
  const publishEntered = deferred();
  const pool = {
    async execute(sql, args) {
      events.push('read');
      if (sql.includes('FROM command_journal')) {
        const row = commands.get(args[0]);
        return [row ? [row] : []];
      }
      return [[]];
    },
    async getConnection() {
      events.push('acquire');
      const pending = new Map();
      return {
        async beginTransaction() {},
        async execute(sql, args) {
          events.push('sql');
          if (sql.startsWith('INSERT INTO command_journal'))
            pending.set(args[0], {
              command_hash: args[1],
              command_status: 'PENDING',
              result_json: null,
            });
          if (sql.startsWith('UPDATE command_journal')) {
            const row = pending.get(args[1]);
            row.command_status = 'COMPLETED';
            row.result_json = args[0];
          }
          return [{ affectedRows: 1 }];
        },
        async commit() {
          events.push('commit');
          commitEntered.resolve();
          if (commitGate) await commitGate.promise;
          if (failCommit) {
            const error = new Error('synthetic-driver-failure');
            error.code = 'PERMISSION_DENIED';
            throw error;
          }
          for (const [key, row] of pending) commands.set(key, row);
        },
        async rollback() {
          events.push('rollback');
        },
        async release() {
          events.push('release');
        },
        async destroy() {
          events.push('destroy');
        },
      };
    },
  };
  const signer = {
    signerSetId: 'synthetic-signers',
    signerPolicy: new SignerSetPolicy({
      signerSetId: 'synthetic-signers',
      threshold: 1,
      signers: ['synthetic-signer'],
      environment: 'production',
    }),
    signBytes() {
      assert.fail('no signing');
    },
    verifyBytes() {
      return false;
    },
    verifyHistoricalBytes() {
      return false;
    },
    async rotate() {
      assert.fail('no rotation');
    },
    async reconcile() {
      assert.fail('no rotation');
    },
    async activateRuntime() {
      assert.fail('no rotation');
    },
  };
  const repository = new MySqlOracleRepository({ pool });
  const assembly = await assembleProductionApplication({
    config: { environment: 'production', externalWritesEnabled: false },
    repositoryDrainEnabled: true,
    clock: () => {
      events.push('command-clock');
      return new Date('2026-09-05T00:00:00Z');
    },
    l2Profile,
    l3Profile,
    settlementConfiguration: {
      profileId: 'giraffe-settlement/production-v1',
      businessCalendarRef: 'synthetic-calendar',
      targetBusinessDays: 5,
      timeZone: 'Asia/Shanghai',
    },
    resolver: {
      async resolve(_reference, kind) {
        if (kind === 'repository') return repository;
        if (kind === 'signer') return signer;
        if (kind === 'source')
          return {
            fetchByFixedReference(reference) {
              if (sourceHandler) return sourceHandler(reference);
              assert.fail('no source fetch');
            },
          };
        if (kind === 'admin-authenticator')
          return {
            async authenticate(request) {
              return {
                actorId: request.actorId ?? 'synthetic-security',
                roles: request.roles ?? ['SECURITY_OFFICER'],
              };
            },
          };
        if (kind === 'event-publisher')
          return {
            async publish() {
              events.push('publish');
              publishEntered.resolve();
              if (publishGate) await publishGate.promise;
            },
            async publishDeadLetter() {
              assert.fail('no dead letter');
            },
          };
        if (kind === 'monitoring')
          return {
            async checkReadiness() {
              return { ok: true };
            },
          };
        if (kind === 'alerting') return { async reportFailure() {}, async reportEvent() {} };
        return Object.freeze({ synthetic: true });
      },
    },
  });
  await assembly.authenticateAdmin({});
  const input = (key = 'synthetic-command') => ({
    actorId: 'synthetic-security',
    idempotencyKey: key,
    actionId: `action-${key}`,
    sourceId: 'authoritative-registry',
    reasonHash: 'a'.repeat(64),
  });
  const command = (value = input()) => assembly.controlPlane.requestSourceDisable(value);
  function enqueue() {
    const event = assembly.runtime.outbox.enqueue({
      eventType: 'synthetic-event',
      subjectId: 'synthetic-subject',
      payloadHash: 'a'.repeat(64),
      createdAt: new Date().toISOString(),
    });
    assembly.runtime.outbox.markDurable(event.eventId);
  }
  return { assembly, events, input, command, commitEntered, publishEntered, enqueue };
}

test('opt-in production assembly exposes scoped lifecycle without a raw repository bypass', async () => {
  const f = await fixture();
  assert.equal(f.assembly.repositoryLifecycle.snapshot().state, 'ACCEPTING');
  assert.equal(f.assembly.ports.repository.pool, undefined);
  await assert.rejects(
    async () => f.assembly.ports.repository.getCommand('synthetic'),
    /REPOSITORY_EXECUTION_SCOPE_REQUIRED/,
  );
  await f.assembly.repositoryLifecycle.quiesce({ timeoutMs: 100 });
  await assert.rejects(f.command(), /REPOSITORY_ADMISSION_CLOSED/);
  assert.equal(f.events.includes('acquire'), false);
});

test('concurrent same-key commands retain shared Durable inFlight deduplication', async () => {
  const hold = deferred();
  const f = await fixture({ commitGate: hold });
  assert.ok(f.assembly.repositoryLifecycle);
  const first = f.command();
  await f.commitEntered.promise;
  const second = f.command();
  for (let tick = 0; tick < 20; tick += 1) await Promise.resolve();
  assert.equal(f.events.filter((event) => event === 'acquire').length, 1);
  hold.resolve();
  const results = await Promise.all([first, second]);
  assert.equal(results[1].replayed, true);
  assert.equal(f.events.filter((event) => event === 'commit').length, 1);
  assert.equal(f.assembly.repositoryLifecycle.snapshot().inFlight, 0);
});

test('different keys retain one shared Durable write queue', async () => {
  const hold = deferred();
  const f = await fixture({ commitGate: hold });
  assert.ok(f.assembly.repositoryLifecycle);
  const first = f.command(f.input('synthetic-first'));
  await f.commitEntered.promise;
  const second = f.command(f.input('synthetic-second'));
  for (let tick = 0; tick < 20; tick += 1) await Promise.resolve();
  assert.equal(f.events.filter((event) => event === 'acquire').length, 1);
  hold.resolve();
  await Promise.all([first, second]);
  assert.equal(f.events.filter((event) => event === 'commit').length, 2);
});

test('authorization and normal business rejection do not poison global admission', async () => {
  const f = await fixture();
  assert.ok(f.assembly.repositoryLifecycle);
  const before = f.events.length;
  await assert.rejects(
    f.command({ ...f.input(), actorId: 'unregistered' }),
    /ACTOR_NOT_REGISTERED/,
  );
  assert.equal(f.events.length, before);
  await assert.rejects(
    f.command({ ...f.input(), reasonHash: 'bad' }),
    /SOURCE_DISABLE_REASON_HASH_INVALID/,
  );
  assert.equal(f.assembly.repositoryLifecycle.snapshot().state, 'ACCEPTING');
  await f.command();
  assert.equal(f.events.filter((event) => event === 'commit').length, 1);
});

test('driver failure cannot be exempted by a forged business error code', async () => {
  const f = await fixture({ failCommit: true });
  assert.ok(f.assembly.repositoryLifecycle);
  await assert.rejects(f.command(), (error) => error.outcome === 'COMMIT_UNKNOWN');
  assert.equal(f.assembly.repositoryLifecycle.snapshot().state, 'BLOCKED');
  await assert.rejects(f.command(f.input('synthetic-next')), /REPOSITORY_ADMISSION_CLOSED/);
  await assert.rejects(f.assembly.outboxDispatcher.drain(), /REPOSITORY_ADMISSION_CLOSED/);
  assert.equal(f.events.filter((event) => event === 'acquire').length, 1);
});

test('whole background batch shares the command gate and quiesce stops scheduling', async () => {
  const publishing = deferred();
  const f = await fixture({ publishGate: publishing });
  assert.ok(f.assembly.repositoryLifecycle);
  f.enqueue();
  const worker = f.assembly.startBackgroundWorkers({ intervalMs: 100 });
  try {
    await f.publishEntered.promise;
    const drain = f.assembly.repositoryLifecycle.quiesce({ timeoutMs: 1000 });
    assert.ok(f.assembly.repositoryLifecycle.snapshot().inFlight > 0);
    await assert.rejects(f.command(), /REPOSITORY_ADMISSION_CLOSED/);
    publishing.resolve();
    assert.equal((await drain).state, 'DRAINED');
    assert.throws(
      () => f.assembly.startBackgroundWorkers({ intervalMs: 100 }),
      /REPOSITORY_ADMISSION_CLOSED/,
    );
    assert.equal(f.events.filter((event) => event === 'publish').length, 1);
  } finally {
    publishing.resolve();
    worker.stop();
  }
});

test('authenticated recovery observation remains read-only after failure and never unlocks writes', async () => {
  const f = await fixture({ failCommit: true });
  assert.ok(f.assembly.repositoryLifecycle);
  await assert.rejects(f.command(), /MYSQL_COMMIT_UNKNOWN/);
  const { actorId: _actor, ...input } = f.input();
  const acquires = f.events.filter((event) => event === 'acquire').length;
  assert.deepEqual(await f.assembly.inspectCommandRecovery({}, 'requestSourceDisable', input), {
    status: 'UNRESOLVED',
    writeResumptionAllowed: false,
  });
  await assert.rejects(
    f.assembly.inspectCommandRecovery({ roles: ['READER'] }, 'requestSourceDisable', input),
    /PERMISSION_DENIED/,
  );
  assert.equal(f.events.filter((event) => event === 'acquire').length, acquires);
  assert.equal(f.assembly.repositoryLifecycle.snapshot().state, 'BLOCKED');
  assert.equal(f.assembly.repositoryLifecycle.snapshot().poolCloseAllowed, false);
});

test('a failed delivery-state commit stops later publishing within the admitted batch', async () => {
  const f = await fixture({ failCommit: true });
  f.enqueue();
  f.enqueue();
  await assert.rejects(f.assembly.outboxDispatcher.drain());
  assert.equal(f.assembly.repositoryLifecycle.snapshot().state, 'BLOCKED');
  assert.equal(f.events.filter((event) => event === 'publish').length, 1);
});

test('public publisher capability cannot dispatch outside an admitted scope', async () => {
  const f = await fixture();
  await assert.rejects(
    async () => f.assembly.ports.eventPublisher.publish({}),
    /REPOSITORY_EXECUTION_SCOPE_REQUIRED/,
  );
  assert.equal(f.events.includes('publish'), false);
});

test('readiness fails closed when repository admission is drained or blocked', async () => {
  const f = await fixture();
  assert.equal((await f.assembly.readinessCheck()).ok, true);
  await f.assembly.repositoryLifecycle.quiesce({ timeoutMs: 100 });
  assert.equal((await f.assembly.readinessCheck()).ok, false);
});

test('timeout remains sticky while a publisher settles and prevents subsequent DB dispatch', async () => {
  const publishing = deferred();
  const f = await fixture({ publishGate: publishing });
  f.enqueue();
  f.enqueue();
  const batch = f.assembly.outboxDispatcher.drain();
  const rejected = assert.rejects(batch);
  await f.publishEntered.promise;
  assert.equal((await f.assembly.repositoryLifecycle.quiesce({ timeoutMs: 5 })).state, 'BLOCKED');
  assert.equal(f.assembly.repositoryLifecycle.snapshot().inFlight, 1);
  publishing.resolve();
  await rejected;
  assert.equal(f.assembly.repositoryLifecycle.snapshot().state, 'BLOCKED');
  assert.equal(f.assembly.repositoryLifecycle.snapshot().inFlight, 0);
  assert.equal(f.events.filter((event) => event === 'publish').length, 1);
  assert.equal(f.events.includes('acquire'), false);
});

test('already queued commands cannot mutate runtime after a drain timeout', async () => {
  const hold = deferred();
  const f = await fixture({ commitGate: hold });
  const first = f.command(f.input('synthetic-first'));
  await f.commitEntered.promise;
  const auditBefore = f.assembly.runtime.auditJournal.list().length;
  const clockBefore = f.events.filter((event) => event === 'command-clock').length;
  const second = f.command(f.input('synthetic-second'));
  const settled = Promise.allSettled([first, second]);
  for (let tick = 0; tick < 20; tick += 1) await Promise.resolve();
  await f.assembly.repositoryLifecycle.quiesce({ timeoutMs: 5 });
  hold.resolve();
  const results = await settled;
  assert.equal(results[1].status, 'rejected');
  assert.equal(f.assembly.runtime.auditJournal.list().length, auditBefore);
  assert.equal(f.events.filter((event) => event === 'command-clock').length, clockBefore);
  assert.equal(f.events.filter((event) => event === 'commit').length, 1);
});

test('early source rejection cannot hide another still-running source from drain', async () => {
  const hold = deferred();
  const entered = deferred();
  let calls = 0;
  const f = await fixture({
    sourceHandler: async () => {
      calls += 1;
      if (calls === 2) {
        entered.resolve();
        await hold.promise;
      }
      throw new Error('SYNTHETIC_SOURCE_REJECTED');
    },
  });
  await f.assembly.authenticateAdmin({ roles: ['ORACLE_OPERATOR'] });
  const command = f.assembly.controlPlane.verifyAsset({
    actorId: 'synthetic-security',
    idempotencyKey: 'source-failure',
    evidenceReferences: {
      asset: 'synthetic:asset',
      certificate: 'synthetic:certificate',
      warehouse: 'synthetic:warehouse',
    },
    evidenceVersion: 1,
  });
  const rejected = assert.rejects(command, /SYNTHETIC_SOURCE_REJECTED/);
  try {
    await entered.promise;
    for (let tick = 0; tick < 40; tick += 1) await Promise.resolve();
    assert.equal(f.assembly.repositoryLifecycle.snapshot().inFlight, 1);
    assert.equal((await f.assembly.repositoryLifecycle.quiesce({ timeoutMs: 5 })).state, 'BLOCKED');
  } finally {
    hold.resolve();
    await rejected;
  }
  assert.equal(f.assembly.repositoryLifecycle.snapshot().inFlight, 0);
  assert.equal(f.events.includes('acquire'), false);
});

for (const state of ['ACCEPTING', 'DRAINED', 'BLOCKED']) {
  test(`review regression: public audit export cannot bypass Durable while ${state}`, async () => {
    const f = await fixture({ failCommit: state === 'BLOCKED' });
    if (state === 'BLOCKED') await assert.rejects(f.command());
    f.assembly.runtime.auditJournal.append({
      type: 'synthetic.fixture',
      subjectId: 'synthetic-asset',
      payloadHash: 'a'.repeat(64),
      actorId: 'synthetic-auditor',
      occurredAt: '2026-09-05T00:00:00Z',
    });
    await f.assembly.authenticateAdmin({ actorId: 'synthetic-auditor', roles: ['AUDITOR'] });
    if (state === 'DRAINED') await f.assembly.repositoryLifecycle.quiesce({ timeoutMs: 100 });
    const before = f.assembly.runtime.auditJournal.list().length;
    const acquired = f.events.filter((event) => event === 'acquire').length;
    await assert.rejects(
      f.assembly.adminOperations.exportAudit('synthetic-auditor', 'regulatory-audit'),
      /ADMIN_EXPORT_DURABLE_COMMAND_REQUIRED/,
    );
    assert.equal(f.assembly.runtime.auditJournal.list().length, before);
    assert.equal(f.events.filter((event) => event === 'acquire').length, acquired);
    assert.equal(f.assembly.repositoryLifecycle.snapshot().state, state);
    assert.equal(
      (await f.assembly.adminOperations.snapshot('synthetic-auditor')).audit.recordCount,
      before,
    );
    assert.equal(f.assembly.adminOperations.runtime, undefined);
  });
}

test('legitimate durable audit export persists once and replay retains shared command identity', async () => {
  const f = await fixture();
  f.assembly.runtime.auditJournal.append({
    type: 'synthetic.fixture',
    subjectId: 'synthetic-asset',
    payloadHash: 'a'.repeat(64),
    actorId: 'synthetic-auditor',
    occurredAt: '2026-09-05T00:00:00Z',
  });
  await f.assembly.authenticateAdmin({ actorId: 'synthetic-auditor', roles: ['AUDITOR'] });
  const input = {
    actorId: 'synthetic-auditor',
    idempotencyKey: 'synthetic-export',
    purpose: 'regulatory-audit',
    adminOperations: f.assembly.adminOperations,
  };
  const exported = await f.assembly.controlPlane.exportAudit(input);
  assert.ok(exported.result.manifest);
  const replay = await f.assembly.controlPlane.exportAudit(input);
  assert.equal(replay.replayed, true);
  assert.equal(f.events.filter((event) => event === 'commit').length, 1);
  assert.equal(
    f.assembly.runtime.auditJournal.list().filter(({ type }) => type === 'audit.exported').length,
    1,
  );
  const { actorId, adminOperations, ...recoveryInput } = input;
  assert.deepEqual(
    await f.assembly.inspectCommandRecovery(
      { actorId, roles: ['AUDITOR'] },
      'exportAudit',
      recoveryInput,
    ),
    { status: 'COMPLETED_OBSERVED', writeResumptionAllowed: false },
  );
  await f.assembly.authenticateAdmin({ actorId, roles: ['READER'] });
  const readsBefore = f.events.filter((event) => event === 'read').length;
  await assert.rejects(f.assembly.controlPlane.exportAudit(input), /PERMISSION_DENIED/);
  assert.equal(f.events.filter((event) => event === 'read').length, readsBefore);
});

test('audit export refuses injected capabilities before callbacks or DB reads', async () => {
  const f = await fixture();
  let called = false;
  const before = f.events.length;
  await assert.rejects(
    f.assembly.controlPlane.exportAudit({
      actorId: 'synthetic-security',
      idempotencyKey: 'forged-export',
      purpose: 'regulatory-audit',
      adminOperations: {
        authorizeExport() {
          called = true;
        },
        exportAudit() {
          called = true;
        },
      },
    }),
    /ADMIN_EXPORT_CAPABILITY_INVALID/,
  );
  assert.equal(called, false);
  assert.equal(f.events.length, before);
  assert.equal(f.assembly.repositoryLifecycle.snapshot().state, 'ACCEPTING');
});
