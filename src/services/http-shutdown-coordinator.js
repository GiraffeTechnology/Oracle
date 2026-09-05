import http from 'node:http';
import { performance } from 'node:perf_hooks';

// Process-local component. The owner must return/await handler work or
// register child operations with track BEFORE dispatch. Unregistered detached
// work, upgraded protocols, cross-process fencing and pool closure are not proven.
export function createHttpShutdownCoordinator({
  requestHandler,
  repositoryLifecycle,
  onBlocked = () => {},
} = {}) {
  if (
    typeof requestHandler !== 'function' ||
    typeof repositoryLifecycle?.quiesce !== 'function' ||
    typeof repositoryLifecycle.snapshot !== 'function' ||
    typeof onBlocked !== 'function'
  )
    throw new Error('HTTP_SHUTDOWN_DEPENDENCY_INVALID');
  let started = false;
  let serverClosed = false;
  let deadline = Infinity;
  let timer;
  let httpInFlight = 0;
  let businessInFlight = 0;
  let childOperationsInFlight = 0;
  let quiesceInFlight = 0;
  let idleCleanupInFlight = 0;
  let failureNotified = false;
  const blockers = new Set();
  const sockets = new Set();
  const waiters = new Set();

  const repositorySnapshot = () => {
    try {
      const value = repositoryLifecycle.snapshot();
      if (
        !['ACCEPTING', 'DRAINING', 'DRAINED', 'BLOCKED'].includes(value?.state) ||
        !Number.isInteger(value.inFlight) ||
        value.inFlight < 0 ||
        value.poolCloseAllowed !== false ||
        value.writeResumptionAllowed !== false
      )
        throw new Error();
      if (value.state === 'BLOCKED') blockers.add('REPOSITORY_BLOCKED');
      if (!started && value.state !== 'ACCEPTING') blockers.add('REPOSITORY_NOT_ACCEPTING');
      return value;
    } catch {
      blockers.add('REPOSITORY_LIFECYCLE_INVALID');
      return { state: 'UNKNOWN', inFlight: null };
    }
  };
  const snapshot = () => {
    const repository = repositorySnapshot();
    const clean =
      started &&
      serverClosed &&
      !server.listening &&
      sockets.size === 0 &&
      httpInFlight === 0 &&
      businessInFlight === 0 &&
      childOperationsInFlight === 0 &&
      quiesceInFlight === 0 &&
      idleCleanupInFlight === 0 &&
      repository.state === 'DRAINED' &&
      repository.inFlight === 0;
    return Object.freeze({
      state: blockers.size ? 'BLOCKED' : !started ? 'ACCEPTING' : clean ? 'DRAINED' : 'DRAINING',
      blockers: Object.freeze([...blockers]),
      serverClosed,
      socketsInFlight: sockets.size,
      httpInFlight,
      businessInFlight,
      childOperationsInFlight,
      quiesceInFlight,
      idleCleanupInFlight,
      repositoryState: repository.state,
      repositoryInFlight: repository.inFlight,
      poolCloseAllowed: false,
      writeResumptionAllowed: false,
    });
  };
  const settle = () => {
    let result = snapshot();
    if (result.state === 'BLOCKED' && !failureNotified) {
      // Notify on failure, not on a later observer poll. Mark first because the
      // application callback may synchronously call shutdown and re-enter settle.
      failureNotified = true;
      try {
        onBlocked(result);
      } catch {
        blockers.add('HTTP_FAILURE_OBSERVER_FAILED');
      }
      result = snapshot(); // callback may have started cleanup; retain its counts
    }
    if (!started || !['DRAINED', 'BLOCKED'].includes(result.state)) return;
    clearTimeout(timer);
    for (const resolve of waiters) resolve(result);
    waiters.clear();
  };
  const block = (code) => {
    blockers.add(code);
    settle();
  };
  const respond = (response, statusCode, code) => {
    if (response.destroyed || response.writableEnded) return;
    try {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      response.writeHead(statusCode, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        connection: 'close',
      });
      response.end(JSON.stringify({ errorCode: code }));
    } catch {
      response.destroy();
    }
  };
  const server = http.createServer((request, response) => {
    httpInFlight += 1;
    let responseDone = false;
    const finishResponse = () => {
      if (responseDone) return;
      responseDone = true;
      response.off('finish', finishResponse);
      response.off('close', finishResponse);
      httpInFlight -= 1;
      if (started && !blockers.has('HTTP_IDLE_CLOSE_FAILED')) {
        // A response can become idle after the initial server.close() sweep.
        // Let Node finish its response bookkeeping, then close idle sockets only.
        idleCleanupInFlight += 1;
        setImmediate(() => {
          try {
            if (!blockers.has('HTTP_IDLE_CLOSE_FAILED')) server.closeIdleConnections();
          } catch {
            blockers.add('HTTP_IDLE_CLOSE_FAILED');
          } finally {
            idleCleanupInFlight -= 1;
            settle();
          }
        });
      }
      settle();
    };
    response.once('finish', finishResponse);
    response.once('close', finishResponse);
    if (snapshot().state !== 'ACCEPTING') {
      respond(response, 503, 'HTTP_ADMISSION_CLOSED');
      return;
    }
    businessInFlight += 1;
    let active = true;
    const children = new Set();
    const track = (operation) => {
      if (!active) throw new Error('HTTP_REQUEST_SCOPE_CLOSED');
      if (snapshot().state === 'BLOCKED') throw new Error('HTTP_ADMISSION_CLOSED');
      if (typeof operation !== 'function') throw new Error('HTTP_CHILD_OPERATION_INVALID');
      childOperationsInFlight += 1;
      let result;
      try {
        result = Promise.resolve(operation());
      } catch (error) {
        result = Promise.reject(error);
      }
      children.add(result);
      result.then(
        () => {
          children.delete(result);
          childOperationsInFlight -= 1;
          settle();
        },
        () => {
          children.delete(result);
          childOperationsInFlight -= 1;
          block('HTTP_CHILD_FAILED');
        },
      );
      return result;
    };
    // Own rejection and lifetime independently of response finish/client close.
    void (async () => {
      try {
        await requestHandler(request, response, Object.freeze({ track }));
      } catch {
        block('HTTP_HANDLER_FAILED');
        respond(response, 500, 'HTTP_HANDLER_FAILED');
      } finally {
        active = false;
        await Promise.allSettled([...children]);
        businessInFlight -= 1;
        settle();
      }
    })();
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => {
      sockets.delete(socket);
      settle();
    });
    // No handler was admitted on this newly observed connection.
    if (started || blockers.size) socket.destroy();
  });
  server.on('error', () => block('HTTP_SERVER_FAILED'));

  const quiesce = () => {
    quiesceInFlight += 1;
    let operation;
    try {
      operation = repositoryLifecycle.quiesce({
        timeoutMs: Math.max(1, Math.ceil(deadline - performance.now())),
      });
    } catch (error) {
      operation = Promise.reject(error);
    }
    Promise.resolve(operation).then(
      (result) => {
        quiesceInFlight -= 1;
        if (result?.state !== 'DRAINED')
          block(result?.state === 'BLOCKED' ? 'REPOSITORY_BLOCKED' : 'REPOSITORY_QUIESCE_INVALID');
        else settle();
      },
      () => {
        quiesceInFlight -= 1;
        block('REPOSITORY_QUIESCE_FAILED');
      },
    );
  };
  const shutdown = async ({ timeoutMs } = {}) => {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647)
      throw new Error('HTTP_SHUTDOWN_TIMEOUT_INVALID');
    if (started) {
      const current = snapshot();
      if (['DRAINED', 'BLOCKED'].includes(current.state)) return current;
    }
    const first = !started;
    const nextDeadline = performance.now() + timeoutMs;
    const shortened = nextDeadline < deadline;
    started = true; // synchronous admission closure precedes all awaited work
    if (shortened) deadline = nextDeadline;
    const result = new Promise((resolve) => waiters.add(resolve));
    if (first || shortened) {
      clearTimeout(timer);
      timer = setTimeout(
        () => block('HTTP_SHUTDOWN_TIMEOUT'),
        Math.max(0, deadline - performance.now()),
      );
      // Shorter repeated calls propagate the same earlier deadline into the
      // existing repository lifecycle; no new operation or shutdown generation.
      quiesce();
    }
    if (first) {
      try {
        server.close((error) => {
          if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') block('HTTP_SERVER_CLOSE_FAILED');
          else {
            serverClosed = true;
            settle();
          }
        });
      } catch {
        block('HTTP_SERVER_CLOSE_FAILED');
      }
    }
    settle();
    return result;
  };
  return Object.freeze({ server, snapshot, shutdown });
}
