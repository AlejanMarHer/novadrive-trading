import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_COSTS, DEFAULT_STRATEGY } from '../src/config';
import {
    buildTradePlan,
    checkExitOnCandle,
    computeTradeResult,
    evaluate,
    lastClosedIndex,
    trendBroken,
} from '../src/strategy';
import { aggregate, HOUR, makeEv, syntheticCandles } from './helpers';

const P = DEFAULT_STRATEGY;
const C = DEFAULT_COSTS;

test('evaluate detecta TREND_BULL en una subida sostenida y TREND_BEAR en una caída', () => {
    const up1h = syntheticCandles(HOUR, 1200, { drifts: [0.002], vol: 0.002 });
    const up = evaluate(up1h.slice(-P.lookback1h), aggregate(up1h, 4).slice(-P.lookback4h), P);
    assert.equal(up?.regime, 'TREND_BULL');
    assert.ok(up!.emaSlope4h > 0, 'la pendiente de la EMA de 4h debe ser positiva');

    const down1h = syntheticCandles(HOUR, 1200, { drifts: [-0.002], vol: 0.002 });
    const down = evaluate(down1h.slice(-P.lookback1h), aggregate(down1h, 4).slice(-P.lookback4h), P);
    assert.equal(down?.regime, 'TREND_BEAR');
    assert.ok(down!.emaSlope4h < 0);
});

test('evaluate devuelve null si no hay historia suficiente', () => {
    const c = syntheticCandles(HOUR, 40);
    assert.equal(evaluate(c, aggregate(c, 4), P), null);
});

test('lastClosedIndex NO incluye una vela de 4h que aún no ha cerrado (sin look-ahead)', () => {
    const c4h = aggregate(syntheticCandles(HOUR, 48), 4); // 12 velas de 4h
    const t = c4h[5].openTime + 2 * HOUR; // a mitad de la vela 5
    assert.equal(lastClosedIndex(c4h, t), 4);
    assert.equal(lastClosedIndex(c4h, c4h[5].closeTime), 5);
    assert.equal(lastClosedIndex(c4h, c4h[0].openTime), -1);
});

test('buildTradePlan: stop 1.5×ATR, objetivo 2R y apalancamiento según riesgo', () => {
    const plan = buildTradePlan('LONG', 100_000, 400, P, C); // stop = 600 = 0.6%
    assert.equal(plan.stopLoss, 99_400);
    assert.equal(plan.takeProfit, 101_200);
    assert.ok(Math.abs(plan.leverage - 0.0075 / 0.006) < 1e-12); // 1.25×
    assert.ok(Math.abs(plan.effectiveRiskPct - 0.75) < 1e-9);
    assert.ok(plan.rrNet < plan.rrGross, 'el R:R neto debe ser menor que el bruto');

    const short = buildTradePlan('SHORT', 100_000, 400, P, C);
    assert.equal(short.stopLoss, 100_600);
    assert.equal(short.takeProfit, 98_800);
});

test('buildTradePlan topa el apalancamiento cuando el stop es muy estrecho', () => {
    const plan = buildTradePlan('LONG', 100_000, 10, P, C); // stop 0.015%
    assert.equal(plan.leverage, C.maxLeverage);
    assert.ok(plan.effectiveRiskPct < C.riskPct);
});

test('comisiones sobre el nocional: stop 0.5% + riesgo 0.75% ⇒ posición 1.5× y ~0.15% del balance en comisiones', () => {
    const noSlip = { ...C, slippageBps: 0, stopSlippageBps: 0 };
    const trade = { direction: 'LONG' as const, entry: 100, stopDistance: 0.5, leverage: 1.5 };
    const r = computeTradeResult(trade, 100, 'TIME', noSlip); // sale al mismo precio
    assert.ok(Math.abs(r.feesFraction - 0.0015) < 1e-9, `comisiones = ${r.feesFraction}`);
    assert.ok(Math.abs(r.balanceReturn + 0.0015) < 1e-9, 'salir a la par pierde exactamente las comisiones');
    assert.ok(Math.abs(r.rNet + 0.2) < 1e-9, '0.15% / 0.75% = 0.2 R de coste');
});

test('las comisiones también se cobran al perder, y el slippage del stop empeora la salida', () => {
    const trade = { direction: 'LONG' as const, entry: 100, stopDistance: 0.5, leverage: 1.5 };
    const loss = computeTradeResult(trade, 99.5, 'SL', C);
    assert.ok(loss.rNet < -1.2, `una pérdida en el stop debe costar más de 1R (fue ${loss.rNet})`);
    assert.ok(loss.feesFraction > 0);

    const win = computeTradeResult(trade, 101, 'TP', C);
    assert.ok(win.rNet < 2 && win.rNet > 1.6, `una ganancia de 2R bruto queda por debajo de 2R neto (fue ${win.rNet})`);
});

test('checkExitOnCandle: si la vela toca SL y TP, se asume el SL', () => {
    const t = { direction: 'LONG' as const, stopLoss: 99, takeProfit: 102 };
    const candle = { openTime: 0, closeTime: 1, open: 100, high: 103, low: 98, close: 101 };
    assert.deepEqual(checkExitOnCandle(t, candle), { price: 99, reason: 'SL' });
});

test('checkExitOnCandle: gap por debajo del stop se ejecuta en la apertura', () => {
    const t = { direction: 'LONG' as const, stopLoss: 99, takeProfit: 102 };
    const candle = { openTime: 0, closeTime: 1, open: 97, high: 98, low: 96, close: 97.5 };
    assert.deepEqual(checkExitOnCandle(t, candle), { price: 97, reason: 'SL' });
});

test('checkExitOnCandle: SHORT', () => {
    const t = { direction: 'SHORT' as const, stopLoss: 101, takeProfit: 98 };
    assert.deepEqual(checkExitOnCandle(t, { openTime: 0, closeTime: 1, open: 100, high: 100.5, low: 97.5, close: 98 }), { price: 98, reason: 'TP' });
    assert.equal(checkExitOnCandle(t, { openTime: 0, closeTime: 1, open: 100, high: 100.5, low: 99, close: 100 }), null);
});

test('trendBroken: el ADX por sí solo NO provoca salida; romper la estructura sí', () => {
    assert.equal(trendBroken(makeEv({ adx: 19 }), 'LONG'), false);
    assert.equal(trendBroken(makeEv({ emaFast1h: 98_000 }), 'LONG'), true); // EMA21 < EMA55
    assert.equal(trendBroken(makeEv({ price: 96_000 }), 'LONG'), true); // precio < EMA50 4h
    assert.equal(trendBroken(makeEv(), 'SHORT'), true);
});
