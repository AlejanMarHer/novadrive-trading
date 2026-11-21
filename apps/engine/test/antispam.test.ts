import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_COSTS, DEFAULT_STRATEGY } from '../src/config';
import { decide, INITIAL_STATE, type SignalState } from '../src/strategy';
import type { Evaluation } from '../src/strategy';
import { HOUR, makeEv } from './helpers';

const P = DEFAULT_STRATEGY;
const C = DEFAULT_COSTS;
const OPTS = { activeDirection: null, strategyActive: true };

function run(evs: Partial<Evaluation>[], state: SignalState = INITIAL_STATE) {
    const actions: string[] = [];
    let s = state;
    evs.forEach((o, i) => {
        const d = decide(makeEv({ candleCloseTime: i * HOUR, ...o }), s, OPTS, P, C);
        actions.push(d.action === 'NONE' ? 'NONE' : `${d.action}:${d.direction}`);
        s = d.state;
    });
    return { actions, state: s };
}

test('una tendencia alcista genera UNA sola señal LONG', () => {
    const { actions } = run([{}, {}, {}, {}]);
    assert.deepEqual(actions, ['ENTER:LONG', 'NONE', 'NONE', 'NONE']);
});

test('ADX oscilando entre 20 y 22 NO repite la señal', () => {
    const { actions } = run([
        { adx: 23 },
        { adx: 21, regime: 'TRANSITION_CHOP' },
        { adx: 22.5 },
        { adx: 20.5, regime: 'TRANSITION_CHOP' },
        { adx: 23 },
    ]);
    assert.deepEqual(actions, ['ENTER:LONG', 'NONE', 'NONE', 'NONE', 'NONE']);
});

test('entrar en rango (ADX < 20) rearma la señal', () => {
    const { actions } = run([{ adx: 25 }, { adx: 18, regime: 'RANGE_COMPRESSION' }, { adx: 23 }]);
    assert.deepEqual(actions, ['ENTER:LONG', 'NONE', 'ENTER:LONG']);
});

test('romper la estructura de tendencia rearma la señal', () => {
    const { actions } = run([{}, { regime: 'TRANSITION_CHOP', emaFast1h: 98_000 }, {}]);
    assert.deepEqual(actions, ['ENTER:LONG', 'NONE', 'ENTER:LONG']);
});

test('un giro a tendencia bajista genera señal SHORT', () => {
    const bear = { regime: 'TREND_BEAR' as const, price: 95_000, emaFast1h: 96_000, emaSlow1h: 97_000, emaTrend4h: 98_000, pdi: 10, mdi: 30 };
    const { actions } = run([{}, bear, bear]);
    assert.deepEqual(actions, ['ENTER:LONG', 'ENTER:SHORT', 'NONE']);
});

test('el estado persistido evita re-alertar tras un reinicio', () => {
    const first = run([{}]);
    // Simulamos un reinicio: el estado se recarga desde la BD (aquí, el mismo objeto serializado)
    const reloaded = JSON.parse(JSON.stringify(first.state)) as SignalState;
    const second = run([{}, {}], reloaded);
    assert.deepEqual(second.actions, ['NONE', 'NONE']);
});

test('rechaza si ya hay una señal activa en la misma dirección', () => {
    const d = decide(makeEv(), INITIAL_STATE, { activeDirection: 'LONG', strategyActive: true }, P, C);
    assert.equal(d.action, 'REJECT');
    assert.equal(d.action === 'REJECT' && d.reason, 'YA_HAY_SEÑAL_ACTIVA');
    assert.equal(d.state.disarmed, 'LONG', 'el rechazo también desarma para no repetirse');
});

test('rechaza si la estrategia está desactivada en StrategyConfig', () => {
    const d = decide(makeEv(), INITIAL_STATE, { activeDirection: null, strategyActive: false }, P, C);
    assert.equal(d.action === 'REJECT' && d.reason, 'ESTRATEGIA_DESACTIVADA');
});

test('rechaza si el ATR es tan pequeño que las comisiones se comen el R:R', () => {
    const d = decide(makeEv({ atr: 50 }), INITIAL_STATE, OPTS, P, C); // stop de 75 USD sobre 100k
    assert.equal(d.action, 'REJECT');
    assert.match(d.action === 'REJECT' ? d.reason : '', /RR_NETO_INSUFICIENTE/);
});
