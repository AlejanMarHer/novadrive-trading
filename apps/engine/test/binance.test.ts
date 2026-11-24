import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closedOnly, parseKlines } from '../src/binance';

const raw = [
    [1000, '1', '2', '0.5', '1.5', '10', 1999, '0', 0, '0', '0', '0'],
    [2000, '1.5', '3', '1', '2.5', '10', 2999, '0', 0, '0', '0', '0'],
];

test('parseKlines conserva hora de apertura y de cierre', () => {
    const c = parseKlines(raw);
    assert.equal(c.length, 2);
    assert.deepEqual(c[0], { openTime: 1000, open: 1, high: 2, low: 0.5, close: 1.5, closeTime: 1999 });
});

test('parseKlines lanza si Binance devuelve un error en vez de un array', () => {
    assert.throws(() => parseKlines({ code: -1003, msg: 'Too many requests' }), /Respuesta inesperada/);
});

test('closedOnly descarta la vela en curso (la última que devuelve Binance)', () => {
    const c = parseKlines(raw);
    // A t=2500 la segunda vela (2000–2999) aún no ha cerrado
    assert.deepEqual(closedOnly(c, 2500).map(x => x.openTime), [1000]);
    // A t=3000 ya cerró
    assert.deepEqual(closedOnly(c, 3000).map(x => x.openTime), [1000, 2000]);
});

test('banUntilFromError lee la hora de fin del baneo de Binance (418)', async () => {
    const { banUntilFromError } = await import('../src/binance');
    const { HttpError } = await import('../src/http');
    const msg = 'HTTP 418 en x: {"code":-1003,"msg":"Way too much request weight used; IP banned until 1795537139870. Please use WebSocket Streams"}';
    assert.equal(banUntilFromError(new HttpError(msg, 418)), 1795537139870);
    assert.equal(banUntilFromError(new HttpError('HTTP 429 en x: {}', 429), 1000), 1000 + 2 * 60_000);
    assert.equal(banUntilFromError(new HttpError('HTTP 400', 400)), null);
    assert.equal(banUntilFromError(new Error('red')), null);
});
