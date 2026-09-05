import { MySqlOracleRepository, MySqlTransactionError } from '../adapters/mysql-repository.js';

// Process-local, one-way admission gate for a single pinned repository.
// Every foreground/background operation must enter run() BEFORE doing work.
// Production bootstrap does not enable this component. It cannot fence other
// processes, cancel transactions, shut down a pool, or authorize promotion.
// The deployment owner must not retain/use the raw pool outside it. This owns
// a MySqlOracleRepository instance; arbitrary repository subclasses are not wrapped.
// Callbacks receive revocable capabilities, never the raw repository or driver.
const REPOSITORY_METHODS = Object.freeze({
  getAsset: 1,
  getCommand: 1,
  loadStateSnapshot: 0,
  persistMutation: 1,
  persistRecoveryState: 1,
  recordOutboxAttempt: 2,
  recordOutboxDeliveryStateAttempt: 2,
  recordOutboxDeadLetterAttempt: 2,
  recordOutboxDeadLetterStateAttempt: 2,
  markOutboxPublished: 2,
  markOutboxDeadLettered: 2,
});

// All repository-owned SQL paths (including persistMutation/outbox helpers)
// must use the same connection-level gate, not just callback-visible execute.
class GuardedRepository extends MySqlOracleRepository {
  #assertActive;

  constructor(pool, assertActive, onDriverFailure) {
    const invokeDriver = (operation, admissionRequired = true) => {
      if (admissionRequired) assertActive();
      try {
        return Promise.resolve(operation()).catch((error) => {
          onDriverFailure();
          throw error;
        });
      } catch (error) {
        onDriverFailure();
        throw error;
      }
    };
    super({
      pool: {
        execute: (...args) => invokeDriver(() => pool.execute(...args)),
        async getConnection() {
          const connection = await invokeDriver(() => pool.getConnection());
          return {
            beginTransaction: () => invokeDriver(() => connection.beginTransaction()),
            execute: (...args) => invokeDriver(() => connection.execute(...args)),
            commit: () => invokeDriver(() => connection.commit()),
            // Cleanup is never blocked, even after a timeout or failed operation.
            rollback: () => invokeDriver(() => connection.rollback(), false),
            release: () => invokeDriver(() => connection.release(), false),
            destroy:
              typeof connection.destroy === 'function'
                ? () => invokeDriver(() => connection.destroy(), false)
                : undefined,
          };
        },
      },
    });
    this.#assertActive = assertActive;
  }

  transaction(operation) {
    return super.transaction(async (connection) => {
      const result = await operation(connection);
      // Reject here before the base adapter enters COMMIT. The commit hook
      // checks again at dispatch: a later race keeps the base adapter's
      // conservative UNKNOWN classification rather than sending a new COMMIT.
      this.#assertActive();
      return result;
    });
  }
}

async function scopedOperations(operation, methods, onError = () => {}) {
  let active = true;
  const pending = new Set();
  const failures = [];
  const facade = Object.freeze(
    Object.fromEntries(
      Object.entries(methods).map(([name, invoke]) => [
        name,
        (...args) => {
          if (!active || failures.length) throw new Error('REPOSITORY_SCOPE_CLOSED');
          let promise;
          try {
            promise = Promise.resolve(invoke(...args));
          } catch (error) {
            promise = Promise.reject(error);
          }
          pending.add(promise);
          // Own the rejection even if the caller forgets await or catches it. Only
          // the first failure is retained; no raw errors are placed in snapshots.
          promise.then(
            () => pending.delete(promise),
            (error) => {
              pending.delete(promise);
              if (!failures.length) failures.push(error);
              onError(error);
            },
          );
          return promise;
        },
      ]),
    ),
  );
  let result;
  try {
    result = await operation(facade);
  } catch (error) {
    if (!failures.length) {
      failures.push(error);
      // Close admission now, not after an unawaited child/cleanup completes.
      onError(error);
    }
  } finally {
    // Revoke escaped handles before waiting for children. Previously accepted
    // child operations still complete, including rollback/release/destroy.
    active = false;
    await Promise.allSettled([...pending]);
  }
  if (failures.length) throw failures[0];
  return result;
}
export class RepositoryDrainCoordinator {
  #repository;
  #closed = false;
  #inFlight = 0;
  #unresolvedOperations = 0;
  #blockers = new Set();
  #waiters = new Set();

  constructor({ pool }) {
    if (!pool || typeof pool.getConnection !== 'function' || typeof pool.execute !== 'function') {
      throw new Error('REPOSITORY_DRAIN_DEPENDENCY_INVALID');
    }
    this.#repository = new GuardedRepository(
      pool,
      () => {
        if (this.#blockers.size) throw new Error('REPOSITORY_SCOPE_CLOSED');
      },
      () => {
        // Known driver failure closes admission before rollback/destroy settle.
        // This marker does not guess a transaction outcome; the base adapter
        // still owns cleanup and the final typed result.
        this.#closed = true;
        this.#blockers.add('DRIVER_OPERATION_FAILED');
        this.#settleWaiters();
      },
    );
  }

  snapshot() {
    const state = this.#blockers.size
      ? 'BLOCKED'
      : !this.#closed
        ? 'ACCEPTING'
        : this.#inFlight
          ? 'DRAINING'
          : 'DRAINED';
    return Object.freeze({
      state,
      inFlight: this.#inFlight,
      unresolvedOperations: this.#unresolvedOperations,
      blockers: Object.freeze([...this.#blockers]),
      // A successful local drain is NEVER authority to resume or switch DBs.
      writeResumptionAllowed: false,
    });
  }

  async run(operation) {
    if (typeof operation !== 'function') throw new Error('REPOSITORY_OPERATION_INVALID');
    if (this.#closed) throw new Error('REPOSITORY_ADMISSION_CLOSED');
    // Register synchronously, before pool acquisition or any asynchronous work.
    this.#inFlight += 1;
    let observed = false;
    try {
      const methods = {
        transaction: (callback) => {
          if (typeof callback !== 'function') throw new Error('REPOSITORY_OPERATION_INVALID');
          return this.#repository.transaction((connection) =>
            scopedOperations(
              callback,
              {
                execute: (...args) => {
                  if (this.#blockers.size) throw new Error('REPOSITORY_SCOPE_CLOSED');
                  return connection.execute(...args);
                },
              },
              // The repository classifies the final transaction outcome after
              // cleanup. Until then any callback/SQL failure closes admission.
              () => this.#blockOperation(),
            ),
          );
        },
      };
      for (const [method, argumentCount] of Object.entries(REPOSITORY_METHODS)) {
        if (typeof this.#repository[method] !== 'function') continue;
        methods[method] = (...args) => {
          // In particular, never allow callers to inject a connection into reads.
          if (args.length !== argumentCount) throw new Error('REPOSITORY_ARGUMENTS_INVALID');
          return this.#repository[method](...args);
        };
      }
      for (const [method, invoke] of Object.entries(methods)) {
        methods[method] = (...args) => {
          // Already admitted batches may finish a normal drain, but cannot
          // launch further repository operations after any failure/timeout.
          if (this.#blockers.size) throw new Error('REPOSITORY_SCOPE_CLOSED');
          return invoke(...args);
        };
      }
      return await scopedOperations(operation, methods, (error) => {
        observed = true;
        this.#observeFailure(error);
      });
    } catch (error) {
      // Fail closed even for unclassified errors: arbitrary callback failures
      // cannot prove no database mutation occurred. Never retry the callback.
      if (!observed) this.#observeFailure(error);
      throw error;
    } finally {
      // Includes awaited commit/rollback/release/destroy in repository.transaction.
      this.#inFlight -= 1;
      this.#settleWaiters();
    }
  }

  #observeFailure(error) {
    this.#closed = true;
    const unresolved =
      error instanceof MySqlTransactionError &&
      (error.outcome === 'COMMIT_UNKNOWN' ||
        error.outcome === 'ROLLBACK_UNKNOWN' ||
        error.connectionState === 'DISCARD_UNCONFIRMED');
    this.#blockers.add(unresolved ? 'TRANSACTION_UNRESOLVED' : 'OPERATION_FAILED');
    if (unresolved) this.#unresolvedOperations += 1;
    this.#settleWaiters();
  }

  #blockOperation() {
    this.#closed = true;
    this.#blockers.add('OPERATION_FAILED');
    this.#settleWaiters();
  }

  async drain({ timeoutMs } = {}) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647) {
      throw new Error('REPOSITORY_DRAIN_TIMEOUT_INVALID');
    }
    this.#closed = true;
    if (!this.#inFlight || this.#blockers.size) return this.snapshot();
    return new Promise((resolve) => {
      const waiter = { resolve, timer: null };
      waiter.timer = setTimeout(() => {
        // A timeout does not cancel or forget active work. Even if it finishes
        // later, this generation remains blocked; there is no resume/reset API.
        this.#blockers.add('DRAIN_TIMEOUT');
        this.#settleWaiters();
      }, timeoutMs);
      this.#waiters.add(waiter);
    });
  }

  #settleWaiters() {
    if (!this.#closed || (this.#inFlight && !this.#blockers.size)) return;
    const result = this.snapshot();
    for (const waiter of this.#waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve(result);
    }
    this.#waiters.clear();
  }
}
