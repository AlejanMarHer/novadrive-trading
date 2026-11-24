import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_STRATEGY as P } from '../src/config';
import { explainNoSignal, missingConditions } from '../src/explain';
import { INITIAL_STATE } from '../src/strategy';
import { makeEv } from './helpers';

test('rango: explica que el ADX está por debajo del umbral', () => {
    const msg = explainNoSignal(makeEv({ regime: 'RANGE_COMPRESSION', adx: 15.2 }), INITIAL_STATE, null, P);
    assert.match(msg, /rango/);
    assert.match(msg, /15\.2 < 20/);
});

test('transición: lista lo que falta para la dirección más cercana', () => {
    const ev = makeEv({ regime: 'TRANSITION_CHOP', adx: 21 }); // alcista en todo salvo el ADX
    assert.deepEqual(missingConditions(ev, 'LONG', P), ['ADX ≥ 22 (está en 21.0)']);
    assert.match(explainNoSignal(ev, INITIAL_STATE, null, P), /Para LONG falta: ADX ≥ 22/);
});

test('tendencia ya alertada: lo dice explícitamente (anti-spam)', () => {
    const msg = explainNoSignal(makeEv(), { disarmed: 'LONG', lastCandleCloseTime: null }, null, P);
    assert.match(msg, /ya se emitió/);
});

test('señal activa: lo indica', () => {
    assert.match(explainNoSignal(makeEv(), INITIAL_STATE, 'SHORT', P), /señal SHORT activa/);
});
