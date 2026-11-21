import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatAge, isStale, minutesSince } from './freshness';

const NOW = Date.UTC(2025, 0, 1, 12, 0);
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

test('isStale: un registro de hace 10 min está fresco y uno de hace 31 min no', () => {
    assert.equal(isStale(ago(10), NOW), false);
    assert.equal(isStale(ago(30), NOW), false);
    assert.equal(isStale(ago(31), NOW), true);
});

test('isStale: sin registro o fecha inválida se considera desactualizado', () => {
    assert.equal(isStale(null, NOW), true);
    assert.equal(isStale('no-es-fecha', NOW), true);
});

test('minutesSince y formatAge', () => {
    assert.equal(minutesSince(ago(5), NOW), 5);
    assert.equal(formatAge(0.5), 'hace menos de 1 min');
    assert.equal(formatAge(12.7), 'hace 12 min');
    assert.equal(formatAge(125), 'hace 2 h 5 min');
    assert.equal(formatAge(60 * 72), 'hace 3 días');
    assert.equal(formatAge(null), 'nunca');
});
