import test from 'node:test';
import assert from 'node:assert/strict';
import { nextDailyReset, storageQuotaResponse } from '../server/cloud-quota.mjs';
test('Daily storage quota becomes a retryable response without leaking the exception', async () => {
  const time = Date.parse('2026-09-09T23:50:00Z');
  assert.equal(new Date(nextDailyReset(time)).toISOString(), '2026-09-10T00:01:00.000Z');
  const response = storageQuotaResponse(new Error('Exceeded allowed rows read in Durable Objects free tier.'), time);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Retry-After'), '660');
  assert.equal((await response.json()).code, 'DAILY_STORAGE_QUOTA');
  assert.equal(storageQuotaResponse(new Error('unrelated')), null);
});
