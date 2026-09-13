// Synthetic ports only. No driver, network endpoint, signer, or credential.
import { MySqlOracleRepository } from '../../src/adapters/mysql-repository.js';
import { SignerSetPolicy } from '../../src/domain/signer-set-policy.js';

export const settlementConfiguration = Object.freeze({
  profileId: 'giraffe-settlement/production-v1',
  businessCalendarRef: 'synthetic-calendar',
  targetBusinessDays: 5,
  timeZone: 'Asia/Shanghai',
});
export function createDeploymentResolver({ events = [], readiness, commit, authenticate } = {}) {
  const forbidden = () => {
    throw new Error('SYNTHETIC_PORT_MUST_NOT_DISPATCH');
  };
  const commands = new Map();
  const repository = new MySqlOracleRepository({
    pool: {
      async execute(sql, args) {
        events.push('read');
        const row = sql.includes('FROM command_journal') ? commands.get(args[0]) : null;
        return [row ? [row] : []];
      },
      async getConnection() {
        events.push('acquire');
        const pending = new Map();
        return {
          async beginTransaction() {
            events.push('begin');
          },
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
            await commit?.();
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
      end: forbidden,
    },
  });
  const signer = {
    signerSetId: 'synthetic-signers',
    signerPolicy: new SignerSetPolicy({
      signerSetId: 'synthetic-signers',
      threshold: 1,
      signers: ['synthetic-signer'],
      environment: 'production',
    }),
    signBytes: forbidden,
    verifyBytes: forbidden,
    verifyHistoricalBytes: forbidden,
    rotate: forbidden,
    reconcile: forbidden,
    activateRuntime: forbidden,
  };
  return {
    async resolve(_ref, kind) {
      if (kind === 'repository') return repository;
      if (kind === 'signer') return signer;
      if (kind === 'source') return { fetchByFixedReference: forbidden };
      if (kind === 'event-publisher') return { publish: forbidden, publishDeadLetter: forbidden };
      if (kind === 'admin-authenticator')
        return {
          async authenticate(request) {
            events.push('authenticate');
            if (authenticate) return authenticate(request);
            return { actorId: 'synthetic-security', roles: ['SECURITY_OFFICER'] };
          },
        };
      if (kind === 'monitoring')
        return {
          async checkReadiness() {
            events.push('readiness');
            return readiness ? readiness() : { ok: true };
          },
        };
      if (kind === 'alerting')
        return {
          async reportFailure() {
            events.push('alert');
          },
          async reportEvent() {
            events.push('alert');
          },
        };
      return Object.freeze({ synthetic: true });
    },
  };
}
