import { AsyncLocalStorage } from 'node:async_hooks';
import { MySqlOracleRepository } from '../adapters/mysql-repository.js';
import { RepositoryDrainCoordinator } from './repository-drain-coordinator.js';

const METHODS = Object.freeze([
  'transaction',
  'getAsset',
  'getCommand',
  'loadStateSnapshot',
  'persistMutation',
  'persistRecoveryState',
  'recordOutboxAttempt',
  'recordOutboxDeliveryStateAttempt',
  'recordOutboxDeadLetterAttempt',
  'recordOutboxDeadLetterStateAttempt',
  'markOutboxPublished',
  'markOutboxDeadLettered',
]);

// Only assembly-owned code gets this object, never request data.
export function createRepositoryExecutionScope({ repository, isCompromised }) {
  if (
    Object.getPrototypeOf(repository ?? {}) !== MySqlOracleRepository.prototype ||
    typeof isCompromised !== 'function'
  )
    throw new Error('REPOSITORY_LIFECYCLE_DEPENDENCY_INVALID');
  const coordinator = new RepositoryDrainCoordinator({ pool: repository.pool });
  const context = new AsyncLocalStorage();
  const forwarding = Object.freeze(
    Object.fromEntries(
      METHODS.map((method) => [
        method,
        (...args) => {
          const scope = context.getStore();
          if (!scope?.active) throw new Error('REPOSITORY_EXECUTION_SCOPE_REQUIRED');
          return scope.repository[method](...args);
        },
      ]),
    ),
  );
  let recoveryReadsInFlight = 0;
  // A read-only getCommand capability, independent of write admission. This
  // deliberately does NOT grant permission to close the pool after write drain.
  const readCommand = repository.getCommand.bind(repository);
  const recoveryRepository = Object.freeze({
    async getCommand(key) {
      recoveryReadsInFlight += 1;
      try {
        return await readCommand(key);
      } finally {
        recoveryReadsInFlight -= 1;
      }
    },
    persistMutation() {
      throw new Error('RECOVERY_WRITE_DISABLED');
    },
  });
  return Object.freeze({
    repository: forwarding,
    recoveryRepository,
    guardSideEffect(operation) {
      const scope = context.getStore();
      if (!scope?.active) throw new Error('REPOSITORY_EXECUTION_SCOPE_REQUIRED');
      if (coordinator.snapshot().state === 'BLOCKED')
        throw new Error('REPOSITORY_ADMISSION_CLOSED');
      const result = operation();
      if (result && typeof result.then === 'function') {
        const promise = Promise.resolve(result);
        scope.pending.add(promise);
        promise.then(
          () => scope.pending.delete(promise),
          () => scope.pending.delete(promise),
        );
        return promise;
      }
      return result;
    },
    async run(operation) {
      const outcome = await coordinator.run((repository) => {
        const scope = { repository, active: true, pending: new Set() };
        return context.run(scope, async () => {
          try {
            return { ok: true, result: await operation() };
          } catch (error) {
            if (isCompromised()) throw error;
            // Not a code-based exemption: the coordinator independently observes
            // every repository/driver failure even if this callback catches it.
            return { ok: false, error };
          } finally {
            scope.active = false;
            // Promise.all can reject while sibling source requests still run.
            // Keep every accepted child visible to drain until it settles.
            await Promise.allSettled([...scope.pending]);
          }
        });
      });
      if (!outcome.ok) throw outcome.error;
      return outcome.result;
    },
    drain: (options) => coordinator.drain(options),
    snapshot: () =>
      Object.freeze({
        ...coordinator.snapshot(),
        recoveryReadsInFlight,
        poolCloseAllowed: false,
        scope: 'APPLICATION_WRITES_AND_BACKGROUND',
      }),
  });
}
