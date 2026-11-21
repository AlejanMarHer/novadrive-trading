import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeStats } from '../src/backtest/stats';
import { runSweepBacktest } from '../src/backtest/sweep';
import { runTrendBacktest } from '../src/backtest/trend';
import { DEFAULT_COSTS, DEFAULT_STRATEGY } from '../src/config';
import type { Candle } from '../src/types';
import { aggregate, HOUR, syntheticCandles } from './helpers';

const P = DEFAULT_STRATEGY;
const C = DEFAULT_COSTS;

/** Altera radicalmente todas las velas a partir de `fromTime` (el "futuro"). */
function perturbFuture(candles: Candle[], fromTime: number): Candle[] {
    return candles.map(c =>
        c.openTime >= fromTime ? { ...c, open: c.open * 0.7, high: c.high * 1.3, low: c.low * 0.6, close: c.close * 1.25 } : c,
    );
}

const c1h = syntheticCandles(HOUR, 3000, { seed: 7, drifts: [0.0012, -0.0003, -0.0012, 0.0001, 0.001, -0.001] });
const c4h = aggregate(c1h, 4);

test('backtest de tendencia produce operaciones LONG y SHORT con costes', () => {
    const r = runTrendBacktest(c1h, c4h, P, C);
    assert.ok(r.trades.length > 0, 'debe haber operaciones');
    assert.ok(r.trades.some(t => t.direction === 'LONG'));
    assert.ok(r.trades.some(t => t.direction === 'SHORT'));
    assert.ok(r.trades.every(t => t.feesFraction > 0), 'todas las operaciones pagan comisión');
    for (let i = 1; i < r.trades.length; i++) {
        assert.ok(r.trades[i].entryTime >= r.trades[i - 1].exitTime, 'sin operaciones solapadas');
    }
    const s = computeStats(r);
    assert.equal(s.trades, r.trades.length);
});

test('backtest de tendencia NO mira el futuro: cambiar velas futuras no altera operaciones pasadas', () => {
    const base = runTrendBacktest(c1h, c4h, P, C);
    // Cortamos a mitad de una vela de 4h para probar también que la vela de 4h en curso no se usa.
    const cut = c4h[500].openTime + 2 * HOUR;
    const p1h = perturbFuture(c1h, cut);
    const p4h = aggregate(p1h, 4); // la vela de 4h que contiene `cut` cambia: si se usara antes de cerrar, habría diferencia
    const perturbed = runTrendBacktest(p1h, p4h, P, C);

    const before = (r: typeof base) => r.trades.filter(t => t.exitTime < cut).map(t => JSON.stringify(t));
    assert.ok(before(base).length > 0, 'debe haber operaciones cerradas antes del corte');
    assert.deepEqual(before(perturbed), before(base));
});

test('backtest de tendencia: en cada instante t solo usa velas (1h y 4h) con closeTime <= t', () => {
    let checks = 0;
    runTrendBacktest(c1h, c4h, P, C, 10_000, (t, windows) => {
        for (const w of windows) {
            const lastClose = w[w.length - 1].closeTime;
            assert.ok(lastClose <= t, `vela con cierre ${lastClose} usada en t=${t} (look-ahead)`);
        }
        checks++;
    });
    assert.ok(checks > 1000);
});

test('backtest de barrido (legacy) NO mira el futuro y cobra comisiones también al perder', () => {
    const c15 = syntheticCandles(15 * 60_000, 8000, { seed: 3, vol: 0.003, drifts: [0, 0.0002, 0, -0.0002] });
    const h1 = aggregate(c15, 4);
    let checks = 0;
    const base = runSweepBacktest(c15, h1, C, 10_000, undefined, (t, windows) => {
        for (const w of windows) assert.ok(w[w.length - 1].closeTime <= t, 'look-ahead en el filtro de 1h');
        checks++;
    });
    assert.ok(checks > 0);
    assert.ok(base.trades.length > 0, 'debe haber operaciones');
    assert.ok(base.trades.filter(t => t.rNet < 0).every(t => t.feesFraction > 0));
    assert.ok(base.trades.filter(t => t.exitReason === 'SL').every(t => t.rNet < -1), 'un stop cuesta más de 1R con costes');

    const cut = h1[1000].openTime + 30 * 60_000; // a mitad de una vela de 1h
    const p15 = perturbFuture(c15, cut);
    const perturbed = runSweepBacktest(p15, aggregate(p15, 4), C);
    const before = (r: typeof base) => r.trades.filter(t => t.exitTime < cut).map(t => JSON.stringify(t));
    assert.ok(before(base).length > 0);
    assert.deepEqual(before(perturbed), before(base));
});

test('computeStats: win rate, expectativa y drawdown', () => {
    const mk = (rNet: number, balanceAfter: number) => ({
        direction: 'LONG' as const, entryTime: 0, exitTime: HOUR, entry: 1, exit: 1, stopLoss: 0, takeProfit: 2,
        exitReason: 'TP' as const, leverage: 1, rNet, balanceReturn: rNet * 0.0075, feesFraction: 0.001, balanceAfter,
    });
    const s = computeStats({
        strategy: 'x', from: 0, to: 1, initialCapital: 100, rejected: [],
        trades: [mk(2, 110), mk(-1, 99), mk(-1, 88), mk(2, 120)],
    });
    assert.equal(s.trades, 4);
    assert.equal(s.winRate, 0.5);
    assert.equal(s.avgR, 0.5);
    assert.ok(Math.abs(s.maxDrawdownPct - 20) < 1e-9); // de 110 a 88
    assert.ok(Math.abs(s.totalReturnPct - 20) < 1e-9);
});
