import assert from 'node:assert/strict';
import { MySqlReceiptJournal } from '../../src/adapters/mysql-receipt-journal.js';
import { MySqlOracleRepository } from '../../src/adapters/mysql-repository.js';

const asHex = (value) => Buffer.from(value).toString('hex');
const same = (left, right) => left != null && right != null && asHex(left) === asHex(right);

/**
 * SQL-capture driver with shared committed rows and transaction-scoped locks.
 * This is NOT a live MySQL run or proof of MySQL isolation/DDL behavior. It
 * exercises the journal's SQL/API contract against the actual repository's
 * transaction/outcome implementation without a database, network or signer.
 */
export function sqlFixture() {
  const database = { rows: new Map(), locks: new Set() };
  const log = [];
  const held = new Map();
  const waiting = new Map();
  let nextConnection = 0;
  let commitFault = null;
  let commitPause = null;
  let nextUpdateConflict = false;
  const acquire = async (key, connection) => {
    if (held.get(key) === connection) return;
    if (held.has(key)) {
      await new Promise((resolve) => {
        const queue = waiting.get(key) ?? [];
        queue.push({ connection, resolve });
        waiting.set(key, queue);
      });
    } else held.set(key, connection);
    connection.held.add(key);
  };
  const release = (connection) => {
    for (const key of connection.held) {
      assert.equal(held.get(key), connection);
      const queue = waiting.get(key) ?? [];
      const next = queue.shift();
      if (next) {
        held.set(key, next.connection);
        next.resolve();
      } else held.delete(key);
      if (queue.length === 0) waiting.delete(key);
    }
    connection.held.clear();
  };
  const pool = {
    async getConnection() {
      const connection = {
        id: ++nextConnection,
        held: new Set(),
        writes: new Map(),
        locks: new Set(),
        ended: false,
        async beginTransaction() {
          log.push({ id: this.id, event: 'begin' });
        },
        async execute(sql, parameters = []) {
          const statement = sql.replace(/\s+/g, ' ').trim();
          log.push({ id: this.id, event: 'execute', sql: statement, parameters });
          const allRows = () => [...new Map([...database.rows, ...this.writes]).values()];
          if (statement.startsWith('INSERT INTO source_receipt_journal_locks ')) {
            const key = asHex(parameters[0]);
            await acquire(`lock:${key}`, this);
            this.locks.add(key);
            return [{ affectedRows: 1 }];
          }
          if (statement.startsWith('SELECT lock_hash FROM source_receipt_journal_locks ')) {
            const key = asHex(parameters[0]);
            assert.equal(
              held.get(`lock:${key}`),
              this,
              'lock must be acquired before SELECT FOR UPDATE',
            );
            return [
              [
                ...(this.locks.has(key) || database.locks.has(key)
                  ? [{ lock_hash: parameters[0] }]
                  : []),
              ],
            ];
          }
          if (
            statement.startsWith('SELECT ') &&
            statement.includes(' FROM source_receipt_journal WHERE ')
          ) {
            let rows;
            if (statement.includes('WHERE lane_hash = ?')) {
              rows = allRows().filter(
                (row) =>
                  same(row.lane_hash, parameters[0]) &&
                  !['CONFIRMED', 'FAILED', 'OBSOLETE'].includes(row.state) &&
                  !same(row.intent_hash, parameters[1]),
              );
            } else if (statement.includes(' OR (source_id = ?')) {
              const [id, source, key, nonceSource, nonce, chain, contract, segment] = parameters;
              rows = allRows().filter(
                (row) =>
                  same(row.intent_hash, id) ||
                  (same(row.source_id, source) && same(row.idempotency_key, key)) ||
                  (same(row.source_id, nonceSource) && same(row.nonce_hash, nonce)) ||
                  (same(row.chain_id, chain) &&
                    same(row.contract_address, contract) &&
                    same(row.segment_digest, segment)),
              );
            } else rows = allRows().filter((row) => same(row.intent_hash, parameters[0]));
            if (statement.endsWith('FOR UPDATE'))
              for (const row of rows) await acquire(`row:${asHex(row.intent_hash)}`, this);
            return [rows.map((row) => structuredClone(row))];
          }
          if (statement.startsWith('INSERT INTO source_receipt_journal ')) {
            const names = [
              'intent_hash',
              'execution_reference',
              'source_id',
              'idempotency_key',
              'nonce_hash',
              'chain_id',
              'contract_address',
              'register_id',
              'token_id',
              'lane_hash',
              'segment_digest',
              'intent_json',
            ];
            const row = Object.fromEntries(names.map((name, index) => [name, parameters[index]]));
            const duplicate = allRows().some(
              (prior) =>
                same(prior.intent_hash, row.intent_hash) ||
                same(prior.execution_reference, row.execution_reference) ||
                (same(prior.source_id, row.source_id) &&
                  (same(prior.idempotency_key, row.idempotency_key) ||
                    same(prior.nonce_hash, row.nonce_hash))) ||
                (same(prior.chain_id, row.chain_id) &&
                  same(prior.contract_address, row.contract_address) &&
                  same(prior.segment_digest, row.segment_digest)),
            );
            if (duplicate)
              throw Object.assign(new Error('synthetic-duplicate-key'), { code: 'ER_DUP_ENTRY' });
            Object.assign(row, {
              state: 'PREPARED',
              transaction_hash: null,
              block_hash: null,
              block_number: null,
              projection_version: null,
              reason: null,
              revision: 0,
            });
            this.writes.set(asHex(row.intent_hash), row);
            return [{ affectedRows: 1 }];
          }
          if (statement.startsWith('UPDATE source_receipt_journal SET ')) {
            const [
              state,
              transactionHash,
              blockHash,
              blockNumber,
              version,
              reason,
              id,
              revision,
              previousState,
            ] = parameters;
            const current = allRows().find((row) => same(row.intent_hash, id));
            assert.equal(
              held.get(`row:${asHex(id)}`),
              this,
              'update requires the journal row lock',
            );
            if (nextUpdateConflict) {
              nextUpdateConflict = false;
              return [{ affectedRows: 0 }];
            }
            if (!current || current.revision !== revision || current.state !== previousState)
              return [{ affectedRows: 0 }];
            this.writes.set(asHex(id), {
              ...current,
              state,
              transaction_hash: transactionHash,
              block_hash: blockHash,
              block_number: blockNumber,
              projection_version: version,
              reason,
              revision: revision + 1,
            });
            return [{ affectedRows: 1 }];
          }
          throw new Error(`UNEXPECTED_SQL:${statement}`);
        },
        async commit() {
          log.push({ id: this.id, event: 'commit' });
          const pause = commitPause;
          commitPause = null;
          if (pause) {
            pause.entered();
            await pause.resume;
          }
          const fault = commitFault;
          commitFault = null;
          if (!fault || fault.persisted) {
            for (const [key, value] of this.writes) database.rows.set(key, structuredClone(value));
            for (const key of this.locks) database.locks.add(key);
          }
          this.ended = true;
          release(this);
          if (fault) throw fault.error;
        },
        async rollback() {
          log.push({ id: this.id, event: 'rollback' });
          this.writes.clear();
          this.ended = true;
          release(this);
        },
        async release() {
          log.push({ id: this.id, event: 'release' });
          assert.equal(this.held.size, 0);
        },
        async destroy() {
          log.push({ id: this.id, event: 'destroy' });
          release(this);
        },
      };
      return connection;
    },
  };
  const repository = new MySqlOracleRepository({ pool });
  return {
    repository,
    database,
    log,
    journal: () => new MySqlReceiptJournal({ repository }),
    failCommit(persisted = true) {
      commitFault = { persisted, error: new Error('synthetic-lost-commit-ack') };
    },
    pauseCommit() {
      let entered;
      let resume;
      const ready = new Promise((resolve) => {
        entered = resolve;
      });
      const pending = new Promise((resolve) => {
        resume = resolve;
      });
      commitPause = { entered, resume: pending };
      return { ready, resume };
    },
    failUpdate() {
      nextUpdateConflict = true;
    },
  };
}
