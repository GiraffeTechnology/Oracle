import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  FAIL_CLOSED_STATUS,
  ORACLE_STATUSES,
  TRANSFER_BLOCKING_STATUSES,
  blocksTransfer,
  isOracleStatus,
  listOracleStatuses,
} from './oracle-status.ts';

describe('oracle status vocabulary (ORACLE-002)', () => {
  it('exposes exactly the eight PRD statuses', () => {
    assert.deepEqual(
      [...ORACLE_STATUSES],
      [
        'VALID',
        'INVALID',
        'TRANSFER_PENDING',
        'FROZEN',
        'REVOKED',
        'EXPIRED',
        'REVIEW_REQUIRED',
        'NOT_VERIFIED',
      ],
    );
  });

  it('rejects any status outside the closed vocabulary', () => {
    for (const value of ['valid', 'PRICED', 'OK', '', null, undefined, 42, {}]) {
      assert.equal(isOracleStatus(value), false, `expected ${String(value)} to be rejected`);
    }
  });

  it('fails closed to NOT_VERIFIED', () => {
    assert.equal(FAIL_CLOSED_STATUS, 'NOT_VERIFIED');
    assert.equal(blocksTransfer(FAIL_CLOSED_STATUS), true);
  });

  it('clears a transfer gate only on VALID', () => {
    assert.equal(blocksTransfer('VALID'), false);
    assert.equal(TRANSFER_BLOCKING_STATUSES.includes('VALID'), false);
    assert.equal(TRANSFER_BLOCKING_STATUSES.length, ORACLE_STATUSES.length - 1);
    for (const status of TRANSFER_BLOCKING_STATUSES) {
      assert.equal(blocksTransfer(status), true, `${status} must block transfer`);
    }
  });

  it('describes every status', () => {
    const descriptors = listOracleStatuses();
    assert.equal(descriptors.length, ORACLE_STATUSES.length);
    for (const descriptor of descriptors) {
      assert.equal(isOracleStatus(descriptor.status), true);
      assert.ok(descriptor.description.length > 0, `${descriptor.status} needs a description`);
    }
  });
});
