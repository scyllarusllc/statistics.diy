import test from 'node:test';
import assert from 'node:assert/strict';
import {dayStart, localDay} from '../src/timezone.mjs';

test('local day boundaries follow daylight saving changes', () => {
  assert.equal(dayStart('2026-03-08', 'America/New_York').toISOString(), '2026-03-08T05:00:00.000Z');
  assert.equal(dayStart('2026-03-09', 'America/New_York').toISOString(), '2026-03-09T04:00:00.000Z');
  assert.equal(dayStart('2026-11-02', 'America/New_York').toISOString(), '2026-11-02T05:00:00.000Z');
  assert.equal(localDay(new Date('2026-11-14T14:30:00Z'), 'Pacific/Saipan'), '2026-11-15');
});
