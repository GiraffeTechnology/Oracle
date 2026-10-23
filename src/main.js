import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createApp, createRequestHandler } from './app.js';
import { loadConfig } from './config.js';
import { assembleApplicationProjection } from './config/application-projection.js';
import { SourceRegistry } from './domain/source-registry.js';
import { assembleIsolatedTestApplication } from './config/test-assembly.js';
import { bootstrapProductionApplication } from './config/production-bootstrap.js';
import { createHttpShutdownCoordinator } from './services/http-shutdown-coordinator.js';

// Code opt-in is not deployment authorization. Injection is for synthetic tests;
// the CLI always uses the pinned production bootstrap and the real process.
export function startApplication({
  config = loadConfig(),
  bootstrapProduction = bootstrapProductionApplication,
  signalSource = process,
  report = (event) => process.stdout.write(`${JSON.stringify(event)}\n`),
  markFailed = () => {
    process.exitCode = 1;
  },
} = {}) {
  const enabled = config.processLifecycleEnabled === true;
  const defaultTimeout = config.shutdownTimeoutMs;
  const validTimeout = (value) => Number.isInteger(value) && value >= 1 && value <= 2147483647;
  if (enabled && (config.environment !== 'production' || !validTimeout(defaultTimeout)))
    throw new Error('APPLICATION_LIFECYCLE_CONFIG_INVALID');
  let assembly;
  let server;
  let coordinator;
  let initializing = true;
  let stopping = false;
  let deadline = Infinity;
  let timer;
  let signalReported = false;
  let failureMarked = false;
  let drainStarted = false;
  const blockers = new Set();
  const waiters = new Set();
  const fail = () => {
    if (failureMarked) return;
    failureMarked = true;
    markFailed(); // exit status only: never force exit, cancel work, or close a pool
  };
  const snapshot = () => {
    const http = coordinator?.snapshot() ?? null;
    return Object.freeze({
      state:
        blockers.size || http?.state === 'BLOCKED'
          ? 'BLOCKED'
          : !enabled
            ? 'UNMANAGED'
            : initializing
              ? stopping
                ? 'DRAINING'
                : 'STARTING'
              : stopping
                ? http?.state === 'DRAINED'
                  ? 'DRAINED'
                  : 'DRAINING'
                : 'ACCEPTING',
      initializing,
      stopping,
      blockers: Object.freeze([...blockers]),
      http,
      poolCloseAllowed: false,
      writeResumptionAllowed: false,
    });
  };
  const settle = () => {
    const value = snapshot();
    if (!stopping || !['DRAINED', 'BLOCKED'].includes(value.state)) return;
    clearTimeout(timer);
    if (value.state === 'BLOCKED') fail();
    for (const resolve of waiters) resolve(value);
    waiters.clear();
  };
  const emit = (event) => {
    try {
      report(event);
    } catch {
      blockers.add('APPLICATION_REPORT_FAILED');
      fail();
    }
  };
  const drain = () => {
    if (!coordinator || initializing) return;
    // After initialization the HTTP/repository coordinator owns timeout state;
    // do not race a second outer timer against its admission fence.
    clearTimeout(timer);
    if (performance.now() >= deadline) blockers.add('APPLICATION_SHUTDOWN_TIMEOUT');
    drainStarted = true;
    // Late bootstrap completion still closes admission; a prior timeout remains
    // sticky in the outer process result. This is cleanup, not a recovery retry.
    void coordinator
      .shutdown({ timeoutMs: Math.max(1, Math.ceil(deadline - performance.now())) })
      .then(settle, () => {
        blockers.add('APPLICATION_DRAIN_FAILED');
        settle();
      });
  };
  const shutdown = async ({ timeoutMs = defaultTimeout } = {}) => {
    if (!enabled) throw new Error('APPLICATION_LIFECYCLE_DISABLED');
    if (!validTimeout(timeoutMs)) throw new Error('APPLICATION_SHUTDOWN_TIMEOUT_INVALID');
    if (stopping && ['DRAINED', 'BLOCKED'].includes(snapshot().state)) return snapshot();
    const earlier = performance.now() + timeoutMs;
    const shortened = earlier < deadline;
    stopping = true;
    const result = new Promise((resolve) => waiters.add(resolve));
    if (shortened) {
      deadline = earlier;
      clearTimeout(timer);
      timer = setTimeout(
        () => {
          blockers.add('APPLICATION_SHUTDOWN_TIMEOUT');
          settle();
        },
        Math.max(0, deadline - performance.now()),
      );
    }
    if (!drainStarted || shortened) drain();
    settle();
    return result;
  };
  const onSignal = () => {
    const result = shutdown(); // latch before any awaited bootstrap/listen work
    if (signalReported) return;
    signalReported = true;
    void result.then(
      (value) => emit({ event: 'server.shutdown', ...value }),
      () => {
        blockers.add('APPLICATION_SIGNAL_FAILED');
        fail();
      },
    );
  };
  const onHttpBlocked = () => {
    blockers.add('APPLICATION_HTTP_BLOCKED');
    fail();
    // The coordinator invokes this once. shutdown closes the same admission
    // gate and stops workers even if nobody ever reads an application snapshot.
    void shutdown().then(
      () => emit({ event: 'server.failed', errorCode: 'APPLICATION_HTTP_BLOCKED' }),
      () => {
        blockers.add('APPLICATION_DRAIN_FAILED');
        fail();
      },
    );
  };
  if (enabled) {
    signalSource.on('SIGTERM', onSignal);
    signalSource.on('SIGINT', onSignal);
  }
  const ready = (async () => {
    try {
      assembly =
        config.environment === 'production'
          ? await bootstrapProduction({ config })
          : config.environment === 'test'
            ? assembleIsolatedTestApplication({ config })
            : null;
      const options = {
        config,
        ...assembleApplicationProjection(config.applicationProjection),
        positionSource: assembly?.positionSource,
        receiptProjectionSource: assembly?.receiptProjectionSource,
        sourceRegistry: assembly?.sourceRegistry ?? new SourceRegistry(),
        runtime: assembly?.runtime ?? null,
        controlPlane: assembly?.controlPlane,
        adminOperations: assembly?.adminOperations,
        authenticateAdmin: assembly?.authenticateAdmin,
        readinessCheck: assembly?.readinessCheck,
        l2Profile: assembly?.l2 ?? null,
        protocolProfile: assembly?.l3 ?? null,
      };
      if (enabled) {
        coordinator = createHttpShutdownCoordinator({
          requestHandler: createRequestHandler(options),
          repositoryLifecycle: assembly?.repositoryLifecycle,
          onBlocked: onHttpBlocked,
        });
        if (coordinator.snapshot().state !== 'ACCEPTING') throw new Error();
        server = coordinator.server;
      } else server = createApp(options);
      if (!stopping) {
        await new Promise((resolve, reject) => {
          const failed = (error) => {
            server.off('listening', listened);
            reject(error);
          };
          const listened = () => {
            server.off('error', failed);
            resolve();
          };
          server.once('error', failed);
          server.once('listening', listened);
          server.listen(config.port, config.host);
        });
        // A signal during DNS/listen must not start a worker or emit started.
        if (!stopping) {
          if (enabled && coordinator.snapshot().state !== 'ACCEPTING') throw new Error();
          assembly?.startBackgroundWorkers?.();
          emit({
            event: 'server.started',
            service: 'giraffe-rwa-oracle',
            environment: config.environment,
            externalWritesEnabled: config.externalWritesEnabled,
          });
          if (enabled && blockers.size) throw new Error('APPLICATION_START_FAILED');
        }
      }
      initializing = false;
      if (stopping) drain();
      return snapshot();
    } catch {
      initializing = false;
      blockers.add('APPLICATION_START_FAILED');
      fail();
      if (enabled) {
        stopping = true;
        if (deadline === Infinity) deadline = performance.now() + defaultTimeout;
        drain();
        settle();
      }
      emit({ event: 'server.start.failed', errorCode: 'APPLICATION_START_FAILED' });
      throw new Error('APPLICATION_START_FAILED');
    }
  })();
  // Own startup rejection even when a signal arrives before a caller awaits ready.
  void ready.catch(() => {});
  return Object.freeze({
    ready,
    shutdown,
    snapshot,
    get server() {
      return server;
    },
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startApplication();
}
