import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_COSTS } from '../src/config';
import { resolveSignal, signalPnlR } from '../src/lifecycle';
import type { Candle } from '../src/types';
import { HOUR, makeEv } from './helpers';

const T0 = Date.UTC(2025, 0, 1, 10);
const sig = { direction: 'LONG' as const, entryPrice: 100_000, stopLoss: 99_000, takeProfit: 102_000, generatedAt: T0 + 20_000 };
const candle = (i: number, low: number, high: number): Candle => ({
    openTime: T0 + i * HOUR, closeTime: T0 + (i + 1) * HOUR - 1, open: 100_000, high, low, close: 100_000,
});

test('resolveSignal ignora velas anteriores a la señal', () => {
    const before: Candle = { ...candle(-1, 98_000, 100_500) };
    assert.equal(resolveSignal(sig, [before], null), null);
});

test('resolveSignal detecta TP y SL en velas posteriores', () => {
    assert.deepEqual(resolveSignal(sig, [candle(0, 99_500, 100_500), candle(1, 99_800, 102_100)], null),
        { price: 102_000, reason: 'TP', time: candle(1, 0, 0).closeTime });
    assert.equal(resolveSignal(sig, [candle(0, 98_900, 102_100)], null)?.reason, 'SL');
});

test('resolveSignal emite señal de salida cuando la tendencia se rompe', () => {
    const ev = makeEv({ price: 100_300, emaFast1h: 98_000, candleCloseTime: T0 + 2 * HOUR - 1 });
    const exit = resolveSignal(sig, [candle(0, 99_500, 100_500), candle(1, 99_500, 100_500)], ev);
    assert.deepEqual(exit, { price: 100_300, reason: 'EXIT_SIGNAL', time: ev.candleCloseTime });
});

test('resolveSignal no sale con la misma vela que generó la señal', () => {
    const ev = makeEv({ emaFast1h: 98_000, candleCloseTime: T0 - 1 });
    assert.equal(resolveSignal(sig, [], ev), null);
});

test('signalPnlR descuenta comisiones: un TP de 2R brutos queda por debajo de 2R', () => {
    const r = signalPnlR(sig, { price: 102_000, reason: 'TP', time: 0 }, DEFAULT_COSTS);
    assert.ok(r > 1.7 && r < 2, `R neto = ${r}`);
});
