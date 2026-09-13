import assert from 'node:assert/strict';
import test from 'node:test';
import { RepositoryDrainCoordinator } from '../src/services/repository-drain-coordinator.js';
import { OutboxDispatcher } from '../src/services/outbox-dispatcher.js';
import { DurableOracleControlPlane } from '../src/services/durable-control-plane.js';
import { createSyntheticRuntime } from '../src/oracle-runtime.js';
import { DualControlQueue } from '../src/services/dual-control.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture({
  acquire,
  release,
  destroy,
  query,
  commit,
  rollback,
  acquireFails = false,
  beginFails = false,
  commitFails = false,
  destroyFails = false,
  writeFails = false,
  rollbackFails = false,
  releaseFails = false,
} = {}) {
  const events = [];
  const coordinator = new RepositoryDrainCoordinator({
    pool: {
      async execute() {
        events.push('read');
        return [[]];
      },
      async getConnection() {
        events.push('acquire');
        if (acquire) await acquire.promise;
        if (acquireFails) throw new Error('synthetic-acquire-error');
        return {
          async beginTransaction() {
            events.push('begin');
            if (beginFails) throw new Error('synthetic-begin-error');
          },
          async execute() {
            events.push('source-write');
            if (query) await query.promise;
            if (writeFails) throw new Error('synthetic-write-error');
            return [{ affectedRows: 1 }];
          },
          async commit() {
            events.push('commit');
            if (commit) await commit.promise;
            if (commitFails) throw new Error('synthetic-private-driver-error');
          },
          async rollback() {
            events.push('rollback');
            if (rollback) await rollback.promise;
            if (rollbackFails) throw new Error('synthetic-rollback-error');
          },
          async release() {
            events.push('release-start');
            if (release) await release.promise;
            if (releaseFails) throw new Error('synthetic-release-error');
            events.push('release-end');
          },
          async destroy() {
            events.push('destroy');
            if (destroy) await destroy.promise;
            if (destroyFails) throw new Error('synthetic-private-cleanup-error');
          },
        };
      },
    },
  });
  const write = () =>
    coordinator.run((repo) => repo.transaction((connection) => connection.execute()));
  return { coordinator, events, write };
}

test('foreground driver failure notifies once before cleanup settles', async () => {
  const cleanup = deferred();
  const f = fixture({ writeFails: true, rollback: cleanup });
  const observed = deferred();
  let notifications = 0;
  f.coordinator.observeBlocked((snapshot) => {
    notifications += 1;
    observed.resolve(snapshot);
  });
  const work = f.write();
  const outcome = work.then(
    () => null,
    (error) => error,
  );
  try {
    while (!f.events.includes('rollback')) await Promise.resolve();
    const snapshot = await observed.promise;
    assert.equal(snapshot.state, 'BLOCKED');
    assert.equal(snapshot.inFlight, 1);
    assert.equal(notifications, 1);
  } finally {
    cleanup.resolve();
    await outcome;
  }
  assert.equal(notifications, 1);
  assert.equal(f.coordinator.snapshot().inFlight, 0);
});

test('drain closes admission synchronously, including acquisitions already in flight', async () => {
  const acquire = deferred();
  const f = fixture({ acquire });
  const work = f.write();
  assert.equal(f.coordinator.snapshot().inFlight, 1);
  const draining = f.coordinator.drain({ timeoutMs: 1000 });
  await assert.rejects(f.write(), /REPOSITORY_ADMISSION_CLOSED/);
  assert.deepEqual(f.events, ['acquire']);
  acquire.resolve();
  await work;
  const result = await draining;
  assert.equal(result.state, 'DRAINED');
  assert.equal(result.inFlight, 0);
  assert.equal(result.writeResumptionAllowed, false);
  assert.equal(f.events.filter((event) => event === 'source-write').length, 1);
  await assert.rejects(f.write(), /REPOSITORY_ADMISSION_CLOSED/);
});

test('drain waits for asynchronous connection release, not merely COMMIT', async () => {
  const release = deferred();
  const f = fixture({ release });
  const work = f.write();
  // Wait for the actual fake driver's release entry without elapsed-time assumptions.
  while (!f.events.includes('release-start')) await Promise.resolve();
  let settled = false;
  const draining = f.coordinator.drain({ timeoutMs: 1000 }).then((result) => {
    settled = true;
    return result;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(f.coordinator.snapshot().inFlight, 1);
  release.resolve();
  await work;
  assert.equal((await draining).state, 'DRAINED');
  assert.equal(f.events.at(-1), 'release-end');
});

test('drain timeout stays blocked after late completion and repeated drain', async () => {
  const acquire = deferred();
  const f = fixture({ acquire });
  const work = assert.rejects(f.write(), (error) => error.outcome === 'NOT_STARTED');
  const result = await f.coordinator.drain({ timeoutMs: 5 });
  assert.equal(result.state, 'BLOCKED');
  assert.deepEqual(result.blockers, ['DRAIN_TIMEOUT']);
  assert.equal(result.inFlight, 1);
  await assert.rejects(f.write(), /REPOSITORY_ADMISSION_CLOSED/);
  acquire.resolve();
  await work;
  assert.equal((await f.coordinator.drain({ timeoutMs: 100 })).state, 'BLOCKED');
  assert.equal(f.coordinator.snapshot().inFlight, 0);
  assert.equal(f.coordinator.snapshot().writeResumptionAllowed, false);
});

for (const destroyFails of [false, true]) {
  test(`UNKNOWN transaction blocks admission without retry (destroyFails=${destroyFails})`, async () => {
    const f = fixture({ commitFails: true, destroyFails });
    await assert.rejects(f.write(), (error) => error.outcome === 'COMMIT_UNKNOWN');
    const result = await f.coordinator.drain({ timeoutMs: 100 });
    assert.equal(result.state, 'BLOCKED');
    assert.ok(result.blockers.includes('TRANSACTION_UNRESOLVED'));
    assert.equal(result.unresolvedOperations, 1);
    assert.equal(result.writeResumptionAllowed, false);
    await assert.rejects(f.write(), /REPOSITORY_ADMISSION_CLOSED/);
    assert.equal(f.events.filter((event) => event === 'acquire').length, 1);
    assert.equal(f.events.filter((event) => event === 'commit').length, 1);
    assert.equal(f.events.includes('release-start'), false);
    assert.equal(JSON.stringify(result).includes('private'), false);
  });
}

test('unclassified operation failure fails closed and preserves original thrown value', async () => {
  const f = fixture();
  const failure = new Error('synthetic-private-error');
  await assert.rejects(
    f.coordinator.run(() => {
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.deepEqual(f.coordinator.snapshot().blockers, ['OPERATION_FAILED']);
  await assert.rejects(f.write(), /REPOSITORY_ADMISSION_CLOSED/);
  assert.deepEqual(f.events, []);
});

test('concurrent foreground and background operations share one pinned repository', async () => {
  const f = fixture();
  const hold = deferred();
  const entered = deferred();
  const foreground = f.coordinator.run(async (repo) => {
    entered.resolve();
    await hold.promise;
    return repo.transaction((c) => c.execute());
  });
  await entered.promise;
  await f.write(); // Represents a background caller using the SAME gate.
  const draining = f.coordinator.drain({ timeoutMs: 1000 });
  await assert.rejects(f.write(), /REPOSITORY_ADMISSION_CLOSED/);
  hold.resolve();
  await foreground;
  assert.equal((await draining).state, 'DRAINED');
  assert.equal(f.events.filter((event) => event === 'source-write').length, 2);
  // No target, pool replacement, resume or implicit retry capability is exposed.
  for (const name of ['resume', 'replacePool', 'switchTarget'])
    assert.equal(f.coordinator[name], undefined);
});

test('concurrent drain waiters settle and snapshots cannot reopen admission', async () => {
  const f = fixture();
  const hold = deferred();
  const work = f.coordinator.run(() => hold.promise);
  const a = f.coordinator.drain({ timeoutMs: 1000 });
  const b = f.coordinator.drain({ timeoutMs: 1000 });
  const snapshot = f.coordinator.snapshot();
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.blockers), true);
  hold.resolve();
  await work;
  assert.equal((await a).state, 'DRAINED');
  assert.equal((await b).state, 'DRAINED');
  await assert.rejects(f.write(), /REPOSITORY_ADMISSION_CLOSED/);
});

test('invalid callbacks and drain deadlines never run a database operation', async () => {
  const f = fixture();
  await assert.rejects(f.coordinator.run(null), /REPOSITORY_OPERATION_INVALID/);
  for (const timeoutMs of [-1, 0, Infinity, NaN, 1.5, 2147483648]) {
    await assert.rejects(f.coordinator.drain({ timeoutMs }), /REPOSITORY_DRAIN_TIMEOUT_INVALID/);
  }
  assert.deepEqual(f.events, []);
  assert.equal((await f.coordinator.drain({ timeoutMs: 100 })).state, 'DRAINED');
});

test('rollback UNKNOWN is retained even when connection destruction succeeds', async () => {
  const f = fixture({ writeFails: true, rollbackFails: true });
  await assert.rejects(f.write(), (error) => error.outcome === 'ROLLBACK_UNKNOWN');
  assert.equal(f.coordinator.snapshot().unresolvedOperations, 1);
  assert.deepEqual(f.coordinator.snapshot().blockers, [
    'DRIVER_OPERATION_FAILED',
    'OPERATION_FAILED',
    'TRANSACTION_UNRESOLVED',
  ]);
  assert.equal(f.events.at(-1), 'destroy');
  await assert.rejects(f.write(), /REPOSITORY_ADMISSION_CLOSED/);
});

test('confirmed commit with release failure stays COMMITTED, but does not reopen gate', async () => {
  const f = fixture({ releaseFails: true });
  await assert.rejects(f.write(), (error) => error.outcome === 'COMMITTED');
  assert.equal(f.coordinator.snapshot().unresolvedOperations, 0);
  assert.deepEqual(f.coordinator.snapshot().blockers, [
    'DRIVER_OPERATION_FAILED',
    'OPERATION_FAILED',
  ]);
  await assert.rejects(f.write(), /REPOSITORY_ADMISSION_CLOSED/);
  assert.equal(f.events.filter((event) => event === 'commit').length, 1);
});

test('a failed caller never hides other still-running work', async () => {
  const f = fixture({ commitFails: true });
  const hold = deferred();
  const active = f.coordinator.run(() => hold.promise);
  await assert.rejects(f.write(), /MYSQL_COMMIT_UNKNOWN/);
  const result = await f.coordinator.drain({ timeoutMs: 100 });
  assert.equal(result.state, 'BLOCKED');
  assert.equal(result.inFlight, 1);
  hold.resolve();
  await active;
  assert.equal(f.coordinator.snapshot().state, 'BLOCKED');
  assert.equal(f.coordinator.snapshot().inFlight, 0);
  assert.equal(f.coordinator.snapshot().unresolvedOperations, 1);
});

test('shortest concurrent drain deadline blocks all waiters without cancelling active work', async () => {
  const f = fixture();
  const hold = deferred();
  const active = f.coordinator.run(() => hold.promise);
  const first = f.coordinator.drain({ timeoutMs: 1000 });
  const second = f.coordinator.drain({ timeoutMs: 5 });
  const results = await Promise.all([first, second]);
  for (const result of results) {
    assert.equal(result.state, 'BLOCKED');
    assert.equal(result.inFlight, 1);
    assert.deepEqual(result.blockers, ['DRAIN_TIMEOUT']);
  }
  hold.resolve();
  await active;
  await assert.rejects(f.write(), /REPOSITORY_ADMISSION_CLOSED/);
});

test("a callback cannot redirect the coordinator's pinned target via public properties", async () => {
  const f = fixture();
  let targetCalls = 0;
  const target = {
    async transaction() {
      targetCalls += 1;
    },
  };
  f.coordinator.repository = target;
  f.coordinator.pool = target;
  await f.write();
  assert.equal(targetCalls, 0);
  assert.equal(f.events.filter((event) => event === 'source-write').length, 1);
  await f.coordinator.drain({ timeoutMs: 100 });
  await assert.rejects(
    f.coordinator.run((repo) => repo.transaction()),
    /REPOSITORY_ADMISSION_CLOSED/,
  );
  assert.equal(targetCalls, 0);
});

test('a tracked background batch remains in flight across multiple repository writes', async () => {
  const f = fixture();
  const pause = deferred();
  const firstWrite = deferred();
  const batch = f.coordinator.run(async (repo) => {
    await repo.transaction((c) => c.execute());
    firstWrite.resolve();
    await pause.promise;
    await repo.transaction((c) => c.execute());
  });
  await firstWrite.promise;
  let settled = false;
  const draining = f.coordinator.drain({ timeoutMs: 1000 }).then((result) => {
    settled = true;
    return result;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(f.coordinator.snapshot().inFlight, 1);
  await assert.rejects(f.write(), /REPOSITORY_ADMISSION_CLOSED/);
  pause.resolve();
  await batch;
  assert.equal((await draining).state, 'DRAINED');
  assert.equal(f.events.filter((event) => event === 'source-write').length, 2);
});

test('late UNKNOWN after timeout adds a blocker without erasing timeout or reopening', async () => {
  const commit = deferred();
  const f = fixture({ commit, commitFails: true });
  const work = f.write();
  const rejection = assert.rejects(work, /MYSQL_COMMIT_UNKNOWN/);
  while (!f.events.includes('commit')) await Promise.resolve();
  assert.equal((await f.coordinator.drain({ timeoutMs: 5 })).state, 'BLOCKED');
  commit.resolve();
  await rejection;
  const result = f.coordinator.snapshot();
  assert.equal(result.inFlight, 0);
  assert.equal(result.unresolvedOperations, 1);
  assert.deepEqual(result.blockers, [
    'DRAIN_TIMEOUT',
    'DRIVER_OPERATION_FAILED',
    'TRANSACTION_UNRESOLVED',
  ]);
  await assert.rejects(f.write(), /REPOSITORY_ADMISSION_CLOSED/);
});

test('adversarial: escaped repository handle cannot write after drain', async () => {
  const f = fixture();
  let escaped;
  await f.coordinator.run((repo) => {
    escaped = repo;
  });
  await f.coordinator.drain({ timeoutMs: 100 });
  await assert.rejects(async () => escaped.transaction((c) => c.execute()), /CLOSED/);
});

test('adversarial: unawaited transaction remains counted until driver release', async () => {
  const release = deferred();
  const f = fixture({ release });
  let detached;
  let settled = false;
  const work = f.coordinator
    .run((repo) => {
      detached = repo.transaction((c) => c.execute());
    })
    .then(() => {
      settled = true;
    });
  try {
    while (!f.events.includes('release-start')) await Promise.resolve();
    await Promise.resolve();
    assert.equal(settled, false);
    assert.equal(f.coordinator.snapshot().inFlight, 1);
  } finally {
    release.resolve();
    await detached;
    await work;
  }
});

test('adversarial: swallowing UNKNOWN in a caller must not permit a clean drain', async () => {
  const f = fixture({ commitFails: true });
  await assert.rejects(
    f.coordinator.run(async (repo) => {
      try {
        await repo.transaction((c) => c.execute());
      } catch {
        /* adversarial */
      }
    }),
    /MYSQL_COMMIT_UNKNOWN/,
  );
  assert.equal((await f.coordinator.drain({ timeoutMs: 100 })).state, 'BLOCKED');
});

test('escaped connection capability is revoked and has no lifecycle or pool methods', async () => {
  const f = fixture();
  let escaped;
  await f.coordinator.run((repo) =>
    repo.transaction((connection) => {
      escaped = connection;
    }),
  );
  assert.equal(Object.isFrozen(escaped), true);
  for (const method of ['commit', 'rollback', 'release', 'destroy', 'getConnection', 'pool'])
    assert.equal(escaped[method], undefined);
  assert.throws(() => escaped.execute(), /REPOSITORY_SCOPE_CLOSED/);
  assert.equal(f.events.includes('source-write'), false);
});

test('unawaited SQL settles before COMMIT and transaction release', async () => {
  const query = deferred();
  const f = fixture({ query });
  const work = f.coordinator.run((repo) => {
    void repo.transaction((connection) => {
      void connection.execute();
    });
  });
  while (!f.events.includes('source-write')) await Promise.resolve();
  assert.equal(f.events.includes('commit'), false);
  assert.equal(f.coordinator.snapshot().inFlight, 1);
  const draining = f.coordinator.drain({ timeoutMs: 1000 });
  query.resolve();
  await work;
  assert.equal((await draining).state, 'DRAINED');
  assert.equal(f.events.at(-1), 'release-end');
});

test('swallowed SQL rejection still rolls back and blocks the enclosing operation', async () => {
  const f = fixture({ writeFails: true });
  await assert.rejects(
    f.coordinator.run((repo) =>
      repo.transaction(async (connection) => {
        try {
          await connection.execute();
        } catch {
          /* adversarial */
        }
      }),
    ),
    (error) => error.outcome === 'ROLLED_BACK',
  );
  assert.equal(f.events.includes('commit'), false);
  assert.equal(f.coordinator.snapshot().state, 'BLOCKED');
});

test('UNKNOWN cleanup stays in flight while asynchronous destroy is unfinished', async () => {
  const destroy = deferred();
  const f = fixture({ destroy, commitFails: true });
  const work = assert.rejects(f.write(), /MYSQL_COMMIT_UNKNOWN/);
  while (!f.events.includes('destroy')) await Promise.resolve();
  const draining = f.coordinator.drain({ timeoutMs: 1000 });
  assert.equal(f.coordinator.snapshot().state, 'BLOCKED');
  assert.equal(f.coordinator.snapshot().inFlight, 1);
  destroy.resolve();
  await work;
  assert.equal((await draining).state, 'BLOCKED');
  assert.equal(f.coordinator.snapshot().inFlight, 0);
});

for (const phase of ['acquireFails', 'beginFails']) {
  test(`${phase}: no callback write or retry and later admission is closed`, async () => {
    const f = fixture({ [phase]: true });
    await assert.rejects(f.write(), (error) => error.outcome === 'NOT_STARTED');
    assert.equal(f.events.includes('source-write'), false);
    assert.equal(f.events.includes('commit'), false);
    assert.equal(f.coordinator.snapshot().state, 'BLOCKED');
    assert.equal(f.coordinator.snapshot().inFlight, 0);
    await assert.rejects(f.write(), /REPOSITORY_ADMISSION_CLOSED/);
    assert.equal(f.events.filter((event) => event === 'acquire').length, 1);
  });
}

function outboxBatch(deliveryStore, publisher) {
  return new OutboxDispatcher({
    deliveryStore,
    publisher,
    outbox: {
      pendingActive: () => [{ eventId: 'synthetic-event' }],
      pendingDeadLetter: () => [],
      markPublished() {},
      recordDeliveryStateAttempt() {},
    },
  }).drain();
}

test('actual outbox dispatcher batch and foreground transaction use the same admission gate', async () => {
  const f = fixture();
  const publishing = deferred();
  const entered = deferred();
  const batch = f.coordinator.run((repo) =>
    outboxBatch(repo, {
      async publish() {
        entered.resolve();
        await publishing.promise;
      },
    }),
  );
  await entered.promise;
  await f.write();
  const draining = f.coordinator.drain({ timeoutMs: 1000 });
  assert.equal(f.coordinator.snapshot().inFlight, 1);
  await assert.rejects(
    f.coordinator.run((repo) =>
      outboxBatch(repo, {
        publish() {
          assert.fail('not admitted');
        },
      }),
    ),
    /REPOSITORY_ADMISSION_CLOSED/,
  );
  publishing.resolve();
  assert.equal((await batch)[0].status, 'PUBLISHED');
  assert.equal((await draining).state, 'DRAINED');
  assert.equal(f.events.filter((event) => event === 'commit').length, 2);
});

test('outbox dispatcher swallowing durable UNKNOWN cannot report a clean batch/drain or retry DB', async () => {
  const f = fixture({ commitFails: true });
  await assert.rejects(
    f.coordinator.run((repo) => outboxBatch(repo, { async publish() {} })),
    /MYSQL_COMMIT_UNKNOWN/,
  );
  assert.equal((await f.coordinator.drain({ timeoutMs: 100 })).state, 'BLOCKED');
  assert.equal(f.coordinator.snapshot().unresolvedOperations, 1);
  assert.equal(f.events.filter((event) => event === 'acquire').length, 1);
  assert.equal(f.events.filter((event) => event === 'commit').length, 1);
});

test('failure in one batch prevents later repository work from another already admitted batch', async () => {
  const f = fixture({ commitFails: true });
  const hold = deferred();
  const active = f.coordinator.run(async (repo) => {
    await hold.promise;
    await repo.transaction((c) => c.execute());
  });
  const blocked = assert.rejects(active, /REPOSITORY_SCOPE_CLOSED/);
  await assert.rejects(f.write(), /MYSQL_COMMIT_UNKNOWN/);
  hold.resolve();
  await blocked;
  assert.equal(f.events.filter((event) => event === 'acquire').length, 1);
});

test('full durable command and actual outbox batch share the gate before command side effects', async () => {
  const f = fixture();
  const hold = deferred();
  const entered = deferred();
  const runtime = createSyntheticRuntime();
  const dualControl = new DualControlQueue();
  let authorizations = 0;
  const command = () =>
    f.coordinator.run((repo) =>
      new DurableOracleControlPlane({
        repository: repo,
        runtime,
        dualControl,
        controlPlane: {
          authorizeCommand() {
            authorizations += 1;
          },
          async bindToken() {
            entered.resolve();
            await hold.promise;
            return {
              result: {
                assetId: 'synthetic-asset',
                chainId: 1,
                contract: 'synthetic-contract',
                tokenId: 'synthetic-token',
              },
            };
          },
        },
      }).bindToken({ actorId: 'synthetic-operator', idempotencyKey: 'synthetic-command' }),
    );
  const foreground = command();
  await entered.promise;
  await f.coordinator.run((repo) => outboxBatch(repo, { async publish() {} }));
  const draining = f.coordinator.drain({ timeoutMs: 1000 });
  assert.equal(f.coordinator.snapshot().inFlight, 1);
  await assert.rejects(command(), /REPOSITORY_ADMISSION_CLOSED/);
  assert.equal(authorizations, 1);
  hold.resolve();
  await foreground;
  assert.equal((await draining).state, 'DRAINED');
  assert.equal(f.events.filter((event) => event === 'commit').length, 2);
});

test('restricted repository rejects a caller-supplied read connection', async () => {
  const f = fixture();
  let foreignCalls = 0;
  await assert.rejects(
    f.coordinator.run((repo) =>
      repo.getAsset('synthetic', {
        async execute() {
          foreignCalls += 1;
          return [[]];
        },
      }),
    ),
    /REPOSITORY_ARGUMENTS_INVALID/,
  );
  assert.equal(foreignCalls, 0);
  assert.deepEqual(f.events, []);
});

test('review regression: timeout blocks a new SQL on an already issued connection facade', async () => {
  const f = fixture();
  const entered = deferred();
  const hold = deferred();
  const work = f.coordinator.run((repo) =>
    repo.transaction(async (connection) => {
      entered.resolve();
      await hold.promise;
      await connection.execute();
    }),
  );
  const outcome = work.then(
    () => null,
    (error) => error,
  );
  await entered.promise;
  assert.equal((await f.coordinator.drain({ timeoutMs: 5 })).state, 'BLOCKED');
  hold.resolve();
  await outcome;
  assert.equal(f.events.filter((event) => event === 'source-write').length, 0);
  assert.equal(f.events.includes('commit'), false);
  assert.equal(f.events.includes('rollback'), true);
  assert.equal(f.events.at(-1), 'release-end');
});

test('review regression: another batch UNKNOWN blocks new SQL on an existing connection', async () => {
  const f = fixture({ commitFails: true });
  const entered = deferred();
  const hold = deferred();
  const active = f.coordinator.run((repo) =>
    repo.transaction(async (connection) => {
      entered.resolve();
      await hold.promise;
      await connection.execute();
    }),
  );
  const outcome = active.then(
    () => null,
    (error) => error,
  );
  await entered.promise;
  await assert.rejects(f.write(), /MYSQL_COMMIT_UNKNOWN/);
  const writesBefore = f.events.filter((event) => event === 'source-write').length;
  hold.resolve();
  await outcome;
  assert.equal(f.events.filter((event) => event === 'source-write').length, writesBefore);
  assert.equal(f.events.filter((event) => event === 'commit').length, 1);
});

test('review regression: outer callback throw blocks immediately while a child is releasing', async () => {
  const release = deferred();
  const f = fixture({ release });
  const failure = new Error('synthetic-callback-failed');
  const work = f.coordinator.run((repo) => {
    void repo.transaction((c) => c.execute());
    throw failure;
  });
  const outcome = work.then(
    () => null,
    (error) => error,
  );
  try {
    while (!f.events.includes('release-start')) await Promise.resolve();
    assert.equal(f.coordinator.snapshot().state, 'BLOCKED');
    assert.equal(f.coordinator.snapshot().inFlight, 1);
    await assert.rejects(f.write(), /REPOSITORY_ADMISSION_CLOSED/);
  } finally {
    release.resolve();
    assert.equal(await outcome, failure);
  }
});

test('review regression: transaction callback throw blocks while already issued SQL finishes', async () => {
  const query = deferred();
  const f = fixture({ query });
  const work = f.coordinator.run((repo) =>
    repo.transaction((connection) => {
      void connection.execute();
      throw new Error('synthetic-callback-failed');
    }),
  );
  const outcome = work.then(
    () => null,
    (error) => error,
  );
  try {
    while (!f.events.includes('source-write')) await Promise.resolve();
    await Promise.resolve();
    assert.equal(f.coordinator.snapshot().state, 'BLOCKED');
    assert.equal(f.coordinator.snapshot().inFlight, 1);
    assert.equal(f.events.includes('rollback'), false);
    await assert.rejects(f.write(), /REPOSITORY_ADMISSION_CLOSED/);
  } finally {
    query.resolve();
    await outcome;
  }
  assert.equal(f.events.includes('rollback'), true);
  assert.equal(f.events.includes('commit'), false);
  assert.equal(f.events.at(-1), 'release-end');
});

test('review regression: internal repository SQL sequence also stops after timeout', async () => {
  const query = deferred();
  const f = fixture({ query });
  const work = f.coordinator.run((repo) =>
    repo.persistRecoveryState({
      method: 'synthetic',
      idempotencyKey: 'synthetic',
      commandHash: 'synthetic',
      stateSnapshot: { state: { synthetic: true }, stateHash: 'synthetic' },
    }),
  );
  const outcome = work.then(
    () => null,
    (error) => error,
  );
  while (!f.events.includes('source-write')) await Promise.resolve();
  await f.coordinator.drain({ timeoutMs: 5 });
  query.resolve();
  await outcome;
  assert.equal(f.events.filter((event) => event === 'source-write').length, 1);
  assert.equal(f.events.includes('commit'), false);
  assert.equal(f.events.includes('rollback'), true);
});

test('review regression: finishing an issued SQL after timeout does not issue a new COMMIT', async () => {
  const query = deferred();
  const f = fixture({ query });
  const work = f.write();
  const outcome = work.then(
    () => null,
    (error) => error,
  );
  while (!f.events.includes('source-write')) await Promise.resolve();
  await f.coordinator.drain({ timeoutMs: 5 });
  assert.equal(f.events.includes('rollback'), false);
  query.resolve();
  await outcome;
  assert.equal(f.events.filter((event) => event === 'source-write').length, 1);
  assert.equal(f.events.includes('commit'), false);
  assert.equal(f.events.includes('rollback'), true);
  assert.equal(f.events.at(-1), 'release-end');
});

for (const phase of ['internal SQL', 'COMMIT']) {
  test(`driver failure regression: ${phase} rejection closes admission before cleanup settles`, async () => {
    const cleanup = deferred();
    const hold = deferred();
    const entered = deferred();
    const f = fixture(
      phase === 'internal SQL'
        ? { writeFails: true, rollback: cleanup }
        : { commitFails: true, destroy: cleanup },
    );
    const existing = f.coordinator.run((repo) =>
      repo.transaction(async (connection) => {
        entered.resolve();
        await hold.promise;
        await connection.execute();
      }),
    );
    const existingOutcome = existing.then(
      () => null,
      (error) => error,
    );
    await entered.promise;
    const failing =
      phase === 'internal SQL'
        ? f.coordinator.run((repo) =>
            repo.persistRecoveryState({
              method: 'synthetic',
              idempotencyKey: 'synthetic',
              commandHash: 'synthetic',
              stateSnapshot: { state: { synthetic: true }, stateHash: 'synthetic' },
            }),
          )
        : f.write();
    const failureOutcome = failing.then(
      () => null,
      (error) => error,
    );
    try {
      while (!f.events.includes(phase === 'internal SQL' ? 'rollback' : 'destroy'))
        await Promise.resolve();
      assert.equal(f.coordinator.snapshot().state, 'BLOCKED');
      assert.equal(f.coordinator.snapshot().inFlight, 2);
      assert.ok(f.coordinator.snapshot().blockers.includes('DRIVER_OPERATION_FAILED'));
      await assert.rejects(
        f.coordinator.run((repo) => repo.getAsset('synthetic')),
        /REPOSITORY_ADMISSION_CLOSED/,
      );
      assert.equal(f.events.includes('read'), false);
    } finally {
      hold.resolve();
      cleanup.resolve();
      await existingOutcome;
      await failureOutcome;
    }
    assert.equal(f.events.filter((event) => event === 'source-write').length, 1);
    assert.equal(f.coordinator.snapshot().state, 'BLOCKED');
    assert.equal(f.coordinator.snapshot().inFlight, 0);
    assert.equal(
      (await failureOutcome).outcome,
      phase === 'internal SQL' ? 'ROLLED_BACK' : 'COMMIT_UNKNOWN',
    );
  });
}

for (const phase of ['execute', 'commit', 'release']) {
  test(`synchronous driver ${phase} throw closes admission while cleanup is pending`, async () => {
    const cleanup = deferred();
    const entered = deferred();
    const events = [];
    const failure = new Error('synthetic-sync-driver-error');
    const gate = new RepositoryDrainCoordinator({
      pool: {
        execute() {
          events.push('read');
          return [[]];
        },
        getConnection() {
          return {
            beginTransaction() {},
            execute() {
              events.push('execute');
              if (phase === 'execute') throw failure;
            },
            commit() {
              events.push('commit');
              if (phase === 'commit') throw failure;
            },
            rollback() {
              events.push('rollback');
              if (phase === 'execute') {
                entered.resolve();
                return cleanup.promise;
              }
            },
            release() {
              events.push('release');
              if (phase === 'release') throw failure;
            },
            destroy() {
              events.push('destroy');
              entered.resolve();
              return cleanup.promise;
            },
          };
        },
      },
    });
    const work = gate.run((repo) => repo.transaction((connection) => connection.execute()));
    const outcome = work.then(
      () => null,
      (error) => error,
    );
    try {
      await entered.promise;
      assert.equal(gate.snapshot().state, 'BLOCKED');
      assert.equal(gate.snapshot().inFlight, 1);
      await assert.rejects(
        gate.run((repo) => repo.getAsset('synthetic')),
        /REPOSITORY_ADMISSION_CLOSED/,
      );
      assert.equal(events.includes('read'), false);
    } finally {
      cleanup.resolve();
      await outcome;
    }
    assert.equal(
      (await outcome).outcome,
      phase === 'execute' ? 'ROLLED_BACK' : phase === 'commit' ? 'COMMIT_UNKNOWN' : 'COMMITTED',
    );
    assert.equal(gate.snapshot().inFlight, 0);
    assert.equal(events.filter((event) => event === 'execute').length, 1);
    assert.equal(events.filter((event) => event === 'commit').length, phase === 'execute' ? 0 : 1);
    assert.equal(gate.snapshot().unresolvedOperations, phase === 'commit' ? 1 : 0);
  });
}
