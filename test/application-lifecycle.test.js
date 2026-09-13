import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { EventEmitter, once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { startApplication } from '../src/main.js';
import { loadConfig } from '../src/config.js';
import { bootstrapProductionApplication } from '../src/config/production-bootstrap.js';
import { createApp, createRequestHandler } from '../src/app.js';
import { SourceRegistry } from '../src/domain/source-registry.js';

const config = {
  environment: 'production',
  host: 'localhost',
  port: 0,
  externalWritesEnabled: false,
  processLifecycleEnabled: true,
  shutdownTimeoutMs: 2000,
};
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('runtime HTTP server failure proactively marks failed and quiesces without snapshot polling', async () => {
  const f = fixture();
  await f.app.ready;
  try {
    f.app.server.emit('error', new Error('private-runtime-server-error'));
    f.app.server.emit('error', new Error('private-runtime-server-error-repeated'));
    await tick();
    // Do not call snapshot before these assertions: observation must not drive safety.
    assert.equal(f.calls.filter(([name]) => name === 'failed').length, 1);
    assert.equal(f.calls.filter(([name]) => name === 'quiesce').length, 1);
    assert.equal(f.app.server.listening, false);
    assert.equal(f.repositoryLifecycle.snapshot().state, 'DRAINED');
    assert.equal((await f.app.shutdown()).state, 'BLOCKED');
    f.signals.emit('SIGTERM');
    await tick();
    assert.equal(f.calls.filter(([name]) => name === 'quiesce').length, 1);
    assert.doesNotMatch(JSON.stringify(f.reports), /private-runtime/);
  } finally {
    if (f.app.server.listening) {
      f.app.server.close();
      await once(f.app.server, 'close');
    }
  }
});

test('background repository block proactively marks failed and drains without snapshot polling', async () => {
  const f = fixture({ workerBlock: true });
  await f.app.ready;
  try {
    await tick();
    await tick();
    // Do not call snapshot before these assertions: the worker callback drives safety.
    assert.equal(f.calls.filter(([name]) => name === 'failed').length, 1);
    assert.equal(f.calls.filter(([name]) => name === 'quiesce').length, 1);
    assert.equal(f.app.server.listening, false);
    const stopped = await f.app.shutdown();
    assert.equal(stopped.state, 'BLOCKED');
    assert.ok(stopped.blockers.includes('APPLICATION_REPOSITORY_BLOCKED'));
    assert.ok(
      f.reports.some(
        ({ event, errorCode }) =>
          event === 'server.failed' && errorCode === 'APPLICATION_REPOSITORY_BLOCKED',
      ),
    );
  } finally {
    if (f.app.server.listening) {
      f.app.server.close();
      await once(f.app.server, 'close');
    }
  }
});

test('actual async request-handler failure proactively closes admission without reading snapshot', async () => {
  const f = fixture();
  await f.app.ready;
  try {
    const result = await request(f.app.server, 'http://['); // actual handler URL parsing rejects
    assert.equal(result.status, 500);
    assert.equal(result.body.errorCode, 'HTTP_HANDLER_FAILED');
    await tick();
    assert.equal(f.calls.filter(([name]) => name === 'failed').length, 1);
    assert.equal(f.calls.filter(([name]) => name === 'quiesce').length, 1);
    assert.equal(f.app.server.listening, false);
    assert.equal((await f.app.shutdown()).state, 'BLOCKED');
  } finally {
    if (f.app.server.listening) {
      f.app.server.close();
      await once(f.app.server, 'close');
    }
  }
});

test('HTTP failure at listening boundary prevents background worker start', async (t) => {
  const original = http.Server.prototype.emit;
  t.mock.method(http.Server.prototype, 'emit', function (event, ...args) {
    const result = original.call(this, event, ...args);
    if (event === 'listening')
      original.call(this, 'error', new Error('synthetic-listening-boundary-error'));
    return result;
  });
  const f = fixture();
  try {
    await f.app.ready.catch(() => {});
    await tick();
    assert.equal(
      f.calls.some(([name]) => name === 'worker'),
      false,
    );
    assert.equal(
      f.reports.some(({ event }) => event === 'server.started'),
      false,
    );
    assert.equal(f.calls.filter(([name]) => name === 'quiesce').length, 1);
    assert.equal(f.app.server.listening, false);
  } finally {
    if (f.app.server.listening) {
      f.app.server.close();
      await once(f.app.server, 'close');
    }
  }
});
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture({ bootstrapGate, bootstrapFailure, readiness, workerFailure, workerBlock, lifecycle } = {}) {
  let repositoryState = 'ACCEPTING';
  const calls = [],
    reports = [],
    signals = new EventEmitter();
  const repositoryLifecycle = lifecycle ?? {
    snapshot: () => ({
      state: repositoryState,
      inFlight: 0,
      poolCloseAllowed: false,
      writeResumptionAllowed: false,
    }),
    async quiesce({ timeoutMs }) {
      calls.push(['quiesce', timeoutMs]);
      repositoryState = 'DRAINED';
      return this.snapshot();
    },
  };
  const app = startApplication({
    config,
    signalSource: signals,
    markFailed: () => calls.push(['failed']),
    report: (event) => reports.push(event),
    bootstrapProduction: async () => {
      if (bootstrapGate) await bootstrapGate.promise;
      if (bootstrapFailure) throw new Error('sensitive://raw-bootstrap-detail');
      return {
        repositoryLifecycle,
        sourceRegistry: new SourceRegistry(),
        readinessCheck: readiness,
        startBackgroundWorkers({ onBlocked } = {}) {
          calls.push(['worker']);
          if (workerFailure) throw new Error('private-worker-error');
          if (workerBlock) setImmediate(onBlocked);
        },
      };
    },
  });
  return { app, calls, reports, signals, repositoryLifecycle };
}
function request(server, pathname = '/healthz') {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: 'localhost', port: server.address().port, path: pathname, agent: false },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
      },
    );
    req.on('error', reject);
  });
}

test('lifecycle config is explicit production-only with strict bounded timeout; default shape unchanged', () => {
  const base = {
    GIRAFFE_ORACLE_ENV: 'production',
    GIRAFFE_ORACLE_PRODUCTION_ACK: 'l2-l3-profile-locked',
  };
  assert.equal('processLifecycleEnabled' in loadConfig(base), false);
  assert.deepEqual(loadConfig({ GIRAFFE_ORACLE_PROCESS_LIFECYCLE: 'false' }), loadConfig({}));
  const opted = { ...base, GIRAFFE_ORACLE_PROCESS_LIFECYCLE: 'true' };
  assert.equal(loadConfig(opted).shutdownTimeoutMs, 30000);
  assert.equal(
    loadConfig({ ...opted, GIRAFFE_ORACLE_SHUTDOWN_TIMEOUT_MS: '1' }).shutdownTimeoutMs,
    1,
  );
  for (const value of ['0', '-1', '1.5', '5ms', ' 1', '01', '2147483648', 'Infinity', ''])
    assert.throws(
      () => loadConfig({ ...opted, GIRAFFE_ORACLE_SHUTDOWN_TIMEOUT_MS: value }),
      /TIMEOUT_INVALID/,
    );
  assert.throws(
    () => loadConfig({ GIRAFFE_ORACLE_PROCESS_LIFECYCLE: 'true' }),
    /REQUIRES_PRODUCTION/,
  );
  assert.throws(
    () => loadConfig({ ...base, GIRAFFE_ORACLE_PROCESS_LIFECYCLE: 'TRUE' }),
    /LIFECYCLE_INVALID/,
  );
  assert.throws(
    () => loadConfig({ GIRAFFE_ORACLE_SHUTDOWN_TIMEOUT_MS: '5' }),
    /REQUIRES_LIFECYCLE/,
  );
  assert.throws(
    () => startApplication({ config: { ...config, shutdownTimeoutMs: 0 } }),
    /CONFIG_INVALID/,
  );
});

test('actual pinned bootstrap forwards opt-in to the same assembly lifecycle, default remains null', async () => {
  const modulePath = fileURLToPath(
    new URL('./fixtures/application-deployment.mjs', import.meta.url),
  );
  const env = {
    GIRAFFE_ORACLE_DEPLOYMENT_MODULE: modulePath,
    GIRAFFE_ORACLE_DEPLOYMENT_MODULE_SHA256: createHash('sha256')
      .update(await readFile(modulePath))
      .digest('hex'),
  };
  const base = loadConfig({
    GIRAFFE_ORACLE_ENV: 'production',
    GIRAFFE_ORACLE_PRODUCTION_ACK: 'l2-l3-profile-locked',
  });
  const plain = await bootstrapProductionApplication({ config: base, env });
  assert.equal(plain.repositoryLifecycle, null);
  const managed = await bootstrapProductionApplication({
    config: { ...base, processLifecycleEnabled: true },
    env,
  });
  assert.equal(managed.repositoryLifecycle.snapshot().state, 'ACCEPTING');
  assert.equal((await managed.repositoryLifecycle.quiesce({ timeoutMs: 1000 })).state, 'DRAINED');
  assert.deepEqual(await managed.readinessCheck(), { ok: false });
});

test('default entry keeps unmanaged HTTP behavior and installs no signal handlers', async () => {
  const signals = new EventEmitter();
  const app = startApplication({
    config: {
      environment: 'development',
      host: 'localhost',
      port: 0,
      externalWritesEnabled: false,
    },
    signalSource: signals,
    report() {},
  });
  await app.ready;
  try {
    assert.equal(app.snapshot().state, 'UNMANAGED');
    assert.equal(signals.listenerCount('SIGTERM'), 0);
    assert.equal((await request(app.server)).status, 200);
    await assert.rejects(() => app.shutdown(), /LIFECYCLE_DISABLED/);
  } finally {
    app.server.close();
    await once(app.server, 'close');
  }
});

test('request handler seam returns complete awaited business promise; createApp remains compatible', async () => {
  const gate = deferred(),
    entered = deferred();
  const options = {
    config,
    sourceRegistry: new SourceRegistry(),
    readinessCheck: async () => {
      entered.resolve();
      await gate.promise;
      return { ok: true };
    },
  };
  const handler = createRequestHandler(options);
  const headers = [],
    response = { writeHead: (...args) => headers.push(args), end() {} };
  let done = false;
  const operation = handler({ url: '/readyz', method: 'GET', headers: {} }, response).then(() => {
    done = true;
  });
  await entered.promise;
  assert.equal(done, false);
  gate.resolve();
  await operation;
  assert.equal(headers[0][0], 200);
  const legacy = createApp(options);
  assert.equal(legacy.listeners('request').length, 1);
  assert.equal(legacy.listening, false);
});

test('SIGTERM during bootstrap latches before listen and worker start', async () => {
  const gate = deferred();
  const f = fixture({ bootstrapGate: gate });
  f.signals.emit('SIGTERM');
  f.signals.emit('SIGINT');
  assert.equal(f.app.snapshot().initializing, true);
  assert.equal(f.app.snapshot().stopping, true);
  gate.resolve();
  await f.app.ready;
  const result = await f.app.shutdown();
  await tick();
  assert.equal(result.state, 'DRAINED');
  assert.equal(f.app.server.listening, false);
  assert.equal(f.calls.filter(([name]) => name === 'worker').length, 0);
  assert.equal(f.calls.filter(([name]) => name === 'quiesce').length, 1);
  assert.equal(f.reports.filter(({ event }) => event === 'server.started').length, 0);
  assert.equal(f.reports.filter(({ event }) => event === 'server.shutdown').length, 1);
});

test('bootstrap timeout is sticky and late completion never listens or starts workers', async () => {
  const gate = deferred();
  const f = fixture({ bootstrapGate: gate });
  const result = await f.app.shutdown({ timeoutMs: 10 });
  assert.equal(result.state, 'BLOCKED');
  assert.equal(result.initializing, true);
  assert.equal(result.http, null);
  gate.resolve();
  await f.app.ready;
  await tick();
  assert.equal(f.app.snapshot().state, 'BLOCKED');
  assert.equal(f.app.server.listening, false);
  assert.equal(
    f.calls.some(([name]) => name === 'worker'),
    false,
  );
  assert.equal(f.calls.filter(([name]) => name === 'quiesce').length, 1);
  assert.equal(f.calls.filter(([name]) => name === 'failed').length, 1);
});

test('real readiness promise and open response keep shutdown pending after repository drained', async () => {
  const gate = deferred(),
    entered = deferred();
  const f = fixture({
    readiness: async () => {
      entered.resolve();
      await gate.promise;
      return { ok: true };
    },
  });
  await f.app.ready;
  const response = request(f.app.server, '/readyz');
  await entered.promise;
  const stopped = f.app.shutdown();
  await tick();
  assert.equal(f.app.snapshot().state, 'DRAINING');
  assert.equal(f.app.snapshot().http.businessInFlight, 1);
  assert.equal(f.app.snapshot().http.repositoryState, 'DRAINED');
  gate.resolve();
  assert.equal((await response).status, 200);
  assert.equal((await stopped).state, 'DRAINED');
});

test('shorter concurrent shutdown propagates earliest deadline; late handler cannot erase BLOCKED', async () => {
  const gate = deferred(),
    entered = deferred();
  const f = fixture({
    readiness: async () => {
      entered.resolve();
      await gate.promise;
      return { ok: true };
    },
  });
  await f.app.ready;
  const response = request(f.app.server, '/readyz');
  await entered.promise;
  const first = f.app.shutdown({ timeoutMs: 2000 });
  const second = f.app.shutdown({ timeoutMs: 10 });
  const results = await Promise.all([first, second]);
  assert.ok(results.every(({ state }) => state === 'BLOCKED'));
  assert.equal(f.app.snapshot().http.businessInFlight, 1);
  gate.resolve();
  await response;
  await tick();
  assert.equal(f.app.snapshot().state, 'BLOCKED');
  assert.equal((await f.app.shutdown({ timeoutMs: 1 })).state, 'BLOCKED');
  assert.ok(f.calls.some(([name, timeout]) => name === 'quiesce' && timeout <= 10));
});

test('bootstrap, missing lifecycle, worker and listening failures never emit started or leak errors', async () => {
  for (const options of [{ bootstrapFailure: true }, { lifecycle: {} }, { workerFailure: true }]) {
    const f = fixture(options);
    await assert.rejects(f.app.ready, /^Error: APPLICATION_START_FAILED$/);
    assert.equal(f.app.snapshot().state, 'BLOCKED');
    assert.equal(
      f.reports.some(({ event }) => event === 'server.started'),
      false,
    );
    assert.doesNotMatch(JSON.stringify(f.reports), /sensitive|private-worker/);
    await tick();
    assert.notEqual(f.app.server?.listening, true);
  }
  const occupied = http.createServer();
  occupied.listen(0, 'localhost');
  await once(occupied, 'listening');
  let state = 'ACCEPTING';
  const lifecycle = {
    snapshot: () => ({
      state,
      inFlight: 0,
      poolCloseAllowed: false,
      writeResumptionAllowed: false,
    }),
    async quiesce() {
      state = 'DRAINED';
      return this.snapshot();
    },
  };
  const calls = [];
  const rejected = startApplication({
    config: { ...config, port: occupied.address().port },
    signalSource: new EventEmitter(),
    markFailed() {},
    report: (e) => calls.push(e),
    bootstrapProduction: async () => ({
      sourceRegistry: new SourceRegistry(),
      repositoryLifecycle: lifecycle,
    }),
  });
  try {
    await assert.rejects(rejected.ready, /START_FAILED/);
    assert.equal(rejected.snapshot().state, 'BLOCKED');
  } finally {
    occupied.close();
    await once(occupied, 'close');
  }
});

test('signal inside pending listen prevents started/worker and waits for listener closure', async (t) => {
  const original = http.Server.prototype.listen;
  let f;
  t.mock.method(http.Server.prototype, 'listen', function (...args) {
    f.signals.emit('SIGTERM');
    assert.equal(f.app.snapshot().initializing, true);
    return original.apply(this, args);
  });
  f = fixture();
  await f.app.ready;
  assert.equal((await f.app.shutdown()).state, 'DRAINED');
  assert.equal(f.app.server.listening, false);
  assert.equal(
    f.calls.some(([name]) => name === 'worker'),
    false,
  );
  assert.equal(
    f.reports.some(({ event }) => event === 'server.started'),
    false,
  );
});

test('startup reporting failure closes admission and listener rather than serving while outer state is BLOCKED', async () => {
  let state = 'ACCEPTING',
    failed = 0;
  const lifecycle = {
    snapshot: () => ({
      state,
      inFlight: 0,
      poolCloseAllowed: false,
      writeResumptionAllowed: false,
    }),
    async quiesce() {
      state = 'DRAINED';
      return this.snapshot();
    },
  };
  const app = startApplication({
    config,
    signalSource: new EventEmitter(),
    markFailed: () => {
      failed += 1;
    },
    report() {
      throw new Error('sensitive-report-detail');
    },
    bootstrapProduction: async () => ({
      sourceRegistry: new SourceRegistry(),
      repositoryLifecycle: lifecycle,
    }),
  });
  try {
    await assert.rejects(app.ready, /APPLICATION_START_FAILED/);
    await tick();
    assert.equal(app.snapshot().state, 'BLOCKED');
    assert.equal(state, 'DRAINED');
    assert.equal(app.server.listening, false);
    assert.equal(failed, 1);
  } finally {
    // Test-only cleanup if the assertion finds an open listener.
    if (app.server.listening) {
      app.server.close();
      await once(app.server, 'close');
    }
  }
});
