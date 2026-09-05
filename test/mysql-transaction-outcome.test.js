import assert from 'node:assert/strict';
import test from 'node:test';
import { inspect } from 'node:util';
import { MySqlOracleRepository, MySqlTransactionError, getMySqlTransactionDiagnostics } from '../src/adapters/mysql-repository.js';
import { DurableOracleControlPlane } from '../src/services/durable-control-plane.js';
import { createSyntheticRuntime } from '../src/oracle-runtime.js';
import { DualControlQueue } from '../src/services/dual-control.js';
import { evidenceHash } from '../src/domain/canonical-json.js';

function fixture(failAt, rollbackFails = false, releaseFails = false) {
  const events = [];
  const primary = new Error('synthetic-private-detail-primary');
  const rollback = new Error('synthetic-private-detail-rollback');
  const release = new Error('synthetic-private-detail-release');
  const connection = {
    async beginTransaction() { events.push('begin'); if (failAt === 'BEGIN') throw primary; },
    async commit() { events.push('commit'); if (failAt === 'COMMIT') throw primary; },
    async rollback() { events.push('rollback'); if (rollbackFails) throw rollback; },
    async release() { events.push('release'); if (releaseFails) throw release; },
    async destroy() { events.push('destroy'); },
  };
  const repository = new MySqlOracleRepository({ pool: { async getConnection() { events.push('acquire'); if (failAt === 'ACQUIRE') throw primary; return connection; } } });
  const run = () => repository.transaction(async () => { events.push('operation'); if (failAt === 'OPERATION') throw primary; return 'result'; });
  return { run, events, primary, rollback, release, connection };
}

for (const phase of ['ACQUIRE', 'BEGIN', 'OPERATION', 'COMMIT']) {
  for (const rollbackFails of [false, true]) {
    for (const releaseFails of [false, true]) {
      test(`transaction ${phase}, rollback failure=${rollbackFails}, release failure=${releaseFails}`, async () => {
        const f = fixture(phase, rollbackFails, releaseFails);
        await assert.rejects(f.run, (error) => {
          assert.ok(error instanceof MySqlTransactionError);
          assert.equal(error.phase, phase);
          assert.equal(error.outcome, phase === 'COMMIT' ? 'COMMIT_UNKNOWN' : phase === 'OPERATION' ? rollbackFails ? 'ROLLBACK_UNKNOWN' : 'ROLLED_BACK' : 'NOT_STARTED');
          const internal = getMySqlTransactionDiagnostics(error);
          assert.equal(internal.primaryError, f.primary);
          assert.equal(internal.rollbackError, phase !== 'ACQUIRE' && rollbackFails ? f.rollback : null);
          const discardRequired = phase === 'COMMIT' || rollbackFails;
          assert.equal(internal.releaseError, phase !== 'ACQUIRE' && !discardRequired && releaseFails ? f.release : null);
          assert.equal(internal.cleanupError, null);
          assert.equal(error.connectionState, phase === 'ACQUIRE' ? 'NOT_ACQUIRED' : discardRequired || releaseFails ? 'DESTROYED' : 'RELEASED');
          for (const output of [String(error), error.stack, JSON.stringify(error), inspect(error, { showHidden: true, depth: 8 })]) assert.ok(!output.includes('synthetic-private-detail'));
          return true;
        });
        const prefix = phase === 'ACQUIRE' ? ['acquire'] : phase === 'BEGIN' ? ['acquire', 'begin', 'rollback'] : phase === 'OPERATION' ? ['acquire', 'begin', 'operation', 'rollback'] : ['acquire', 'begin', 'operation', 'commit', 'rollback'];
        const cleanup = phase === 'ACQUIRE' ? [] : phase === 'COMMIT' || rollbackFails ? ['destroy'] : releaseFails ? ['release', 'destroy'] : ['release'];
        assert.deepEqual(f.events, [...prefix, ...cleanup]);
      });
    }
  }
}

test('acknowledged commit followed by release failure remains COMMITTED, never retried or rolled back', async () => {
  const f = fixture(null, true, true);
  await assert.rejects(f.run, (error) => {
    assert.equal(error.code, 'MYSQL_CONNECTION_RELEASE_FAILED');
    assert.equal(error.outcome, 'COMMITTED');
    assert.equal(getMySqlTransactionDiagnostics(error).primaryError, f.release);
    return true;
  });
  assert.deepEqual(f.events, ['acquire', 'begin', 'operation', 'commit', 'release', 'destroy']);
});

test('successful transaction keeps its result and releases exactly once', async () => {
  const f = fixture(null);
  assert.equal(await f.run(), 'result');
  assert.deepEqual(f.events, ['acquire', 'begin', 'operation', 'commit', 'release']);
});

test('a falsy rollback rejection is not treated as an acknowledged rollback', async () => {
  let released = 0;
  const repository = new MySqlOracleRepository({ pool: { async getConnection() { return {
    async beginTransaction() {}, async rollback() { throw null; }, release() { released += 1; },
  }; } } });
  await assert.rejects(() => repository.transaction(async () => { throw new Error('synthetic-operation'); }), { outcome: 'ROLLBACK_UNKNOWN' });
  assert.equal(released, 0);
});

for (const failAt of ['BEGIN', 'OPERATION', 'COMMIT', null]) {
  for (const destroyMode of ['absent', 'reject']) {
    test(`unconfirmed discard preserves diagnostics, phase=${failAt}, destroy=${destroyMode}`, async () => {
      const f = fixture(failAt, true, true);
      const cleanup = new Error('synthetic-private-detail-destroy');
      if (destroyMode === 'absent') delete f.connection.destroy;
      else f.connection.destroy = async () => { f.events.push('destroy'); throw cleanup; };
      await assert.rejects(f.run, (error) => {
        assert.equal(error.connectionState, 'DISCARD_UNCONFIRMED');
        const internal = getMySqlTransactionDiagnostics(error);
        assert.equal(internal.primaryError, failAt === null ? f.release : f.primary);
        assert.equal(internal.rollbackError, failAt === null ? null : f.rollback);
        assert.equal(internal.releaseError, failAt === null ? f.release : null);
        if (destroyMode === 'absent') assert.equal(internal.cleanupError.message, 'MYSQL_CONNECTION_DESTROY_UNAVAILABLE');
        else assert.equal(internal.cleanupError, cleanup);
        for (const output of [String(error), error.stack, JSON.stringify(error), inspect(error, { showHidden: true, depth: 8 })]) assert.ok(!output.includes('synthetic-private-detail'));
        return true;
      });
      assert.equal(f.events.filter((event) => event === 'release').length, failAt === null ? 1 : 0);
      assert.equal(f.events.filter((event) => event === 'operation').length, failAt === 'BEGIN' ? 0 : 1);
    });
  }
}

for (const failAt of ['OPERATION', 'COMMIT']) {
  test(`unresolved ${failAt} connection cannot contaminate a later transaction or recovery read`, async () => {
    let dirty = false;
    let available = true;
    let unexpectedlyCommitted = false;
    const connection = {
      async beginTransaction() { if (dirty) unexpectedlyCommitted = true; },
      async commit() { throw new Error('synthetic-lost-ack'); },
      async rollback() { throw new Error('synthetic-rollback-failure'); },
      release() { available = true; },
      destroy() { dirty = false; },
    };
    const repository = new MySqlOracleRepository({ pool: {
      async getConnection() { if (!available) throw new Error('synthetic-pool-unavailable'); available = false; return connection; },
      async execute() { return [available && dirty ? [{ command_hash: 'same', command_status: 'COMPLETED' }] : []]; },
    } });
    await assert.rejects(() => repository.transaction(async () => { dirty = true; if (failAt === 'OPERATION') throw new Error('synthetic-operation'); }), { connectionState: 'DESTROYED' });
    assert.equal(await repository.getCommand('synthetic-command'), null);
    await assert.rejects(() => repository.transaction(async () => {}), { outcome: 'NOT_STARTED' });
    assert.equal(unexpectedlyCommitted, false);
  });
}

function durableFixture(failure) {
  const runtime = createSyntheticRuntime();
  let record = null;
  let readFails = false;
  let operations = 0;
  const repository = {
    async getCommand(key) { assert.equal(key, 'synthetic-command'); if (readFails) throw new Error('synthetic-private-read-detail'); return record; },
    async persistMutation() { return failure.run(); },
  };
  const controlPlane = {
    authorizeCommand(_method, input) { if (input.actorId !== 'synthetic-operator') throw new Error('PERMISSION_DENIED'); },
    async verifyAsset() { operations += 1; return { result: { synthetic: true } }; },
  };
  const durable = new DurableOracleControlPlane({ controlPlane, repository, runtime, dualControl: new DualControlQueue() });
  const input = { actorId: 'synthetic-operator', idempotencyKey: 'synthetic-command' };
  return { durable, runtime, input, setRecord(value) { record = value; }, failRead() { readFails = true; }, operations: () => operations };
}

for (const phase of ['OPERATION', 'COMMIT', null]) {
  test(`durability failure blocks unsafe writes, phase=${phase}`, async () => {
    const f = fixture(phase, true, true);
    const d = durableFixture(f);
    await assert.rejects(() => d.durable.verifyAsset(d.input), (error) => {
      assert.ok(error instanceof MySqlTransactionError);
      assert.equal(error.outcome, phase === 'COMMIT' ? 'COMMIT_UNKNOWN' : phase === 'OPERATION' ? 'ROLLBACK_UNKNOWN' : 'COMMITTED');
      assert.equal(d.runtime.operationalState.errorCode, error.code);
      assert.ok(getMySqlTransactionDiagnostics(error));
      return true;
    });
    assert.equal(d.runtime.operationalState.compromised, true);
    await assert.rejects(() => d.durable.verifyAsset(d.input), /DURABLE_STATE_COMPROMISED/);
    assert.equal(d.operations(), 1);
  });
}

test('recovery observes persistent command identity but never unblocks, guesses non-commit or retries', async () => {
  const d = durableFixture(fixture('COMMIT'));
  await assert.rejects(() => d.durable.verifyAsset(d.input), /MYSQL_COMMIT_UNKNOWN/);
  const read = () => d.durable.inspectCommandRecovery('verifyAsset', d.input);
  assert.deepEqual(await read(), { status: 'UNRESOLVED', writeResumptionAllowed: false });
  const commandHash = evidenceHash({ method: 'verifyAsset', input: d.input });
  d.setRecord({ commandHash, status: 'PENDING' });
  assert.equal((await read()).status, 'UNRESOLVED');
  d.setRecord({ commandHash: 'different', status: 'COMPLETED' });
  assert.equal((await read()).status, 'CONFLICT');
  d.setRecord({ commandHash, status: 'COMPLETED', result: { detail: 'synthetic-private-record-detail' } });
  assert.deepEqual(await read(), { status: 'COMPLETED_OBSERVED', writeResumptionAllowed: false });
  assert.equal(d.runtime.operationalState.compromised, true);
  assert.equal(d.operations(), 1);
  await assert.rejects(() => d.durable.inspectCommandRecovery('verifyAsset', { ...d.input, actorId: 'unauthorized' }), /PERMISSION_DENIED/);
  await assert.rejects(() => d.durable.inspectCommandRecovery('unlisted', d.input), /COMMAND_METHOD_INVALID/);
  await assert.rejects(() => d.durable.inspectCommandRecovery('verifyAsset', { ...d.input, idempotencyKey: '' }), /IDEMPOTENCY_KEY_REQUIRED/);
  d.failRead();
  await assert.rejects(read, { message: 'MYSQL_RECOVERY_READ_FAILED' });
});
