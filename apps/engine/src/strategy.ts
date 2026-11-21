import { ADX, ATR, EMA } from 'technicalindicators';
import type { CostParams, StrategyParams } from './config';
import type { Candle, Direction, ExitReason, Regime } from './types';

/**
 * Estrategia de seguimiento de tendencia 1h/4h.
 * TODO lo que decide una señal vive aquí, y lo usan tanto `index.ts` (en vivo)
 * como `backtester.ts`. Si cambias una regla, el backtest la prueba automáticamente.
 */

export interface Evaluation {
    regime: Regime;
    /** Cierre de la última vela de 1h CERRADA. */
    price: number;
    adx: number;
    pdi: number;
    mdi: number;
    atr: number;
    emaFast1h: number;
    emaSlow1h: number;
    emaTrend4h: number;
    /** Pendiente de la EMA de 4h en % por vela de 4h. */
    emaSlope4h: number;
    /** Hora de cierre de la vela de 1h evaluada. */
    candleCloseTime: number;
}

const last = <T>(arr: T[]): T | undefined => arr[arr.length - 1];

/**
 * Evalúa el régimen con velas YA CERRADAS. Devuelve null si no hay historia suficiente.
 * Ambos arrays deben terminar en la última vela cerrada disponible en ese instante.
 */
export function evaluate(c1h: Candle[], c4h: Candle[], p: StrategyParams): Evaluation | null {
    const need1h = Math.max(p.emaSlow1h, p.adxPeriod * 2 + 1, p.atrPeriod + 1);
    const need4h = p.emaTrend4h + p.emaSlopeLookback;
    if (c1h.length < need1h || c4h.length < need4h) return null;

    const high = c1h.map(c => c.high);
    const low = c1h.map(c => c.low);
    const close = c1h.map(c => c.close);
    const close4h = c4h.map(c => c.close);

    const emaFast = last(EMA.calculate({ period: p.emaFast1h, values: close }));
    const emaSlow = last(EMA.calculate({ period: p.emaSlow1h, values: close }));
    const ema4hSeries = EMA.calculate({ period: p.emaTrend4h, values: close4h });
    const emaTrend = last(ema4hSeries);
    const adx = last(ADX.calculate({ high, low, close, period: p.adxPeriod }));
    const atr = last(ATR.calculate({ high, low, close, period: p.atrPeriod }));
    if (emaFast === undefined || emaSlow === undefined || emaTrend === undefined || !adx || atr === undefined) return null;

    const emaPrev = ema4hSeries[ema4hSeries.length - 1 - p.emaSlopeLookback];
    const emaSlope4h = emaPrev ? ((emaTrend - emaPrev) / emaPrev / p.emaSlopeLookback) * 100 : 0;

    const price = close[close.length - 1];
    let regime: Regime = 'TRANSITION_CHOP';
    if (price > emaTrend && emaFast > emaSlow && adx.adx >= p.adxTrendMin && adx.pdi > adx.mdi) {
        regime = 'TREND_BULL';
    } else if (price < emaTrend && emaFast < emaSlow && adx.adx >= p.adxTrendMin && adx.mdi > adx.pdi) {
        regime = 'TREND_BEAR';
    } else if (adx.adx < p.adxRangeMax) {
        regime = 'RANGE_COMPRESSION';
    }

    return {
        regime,
        price,
        adx: adx.adx,
        pdi: adx.pdi,
        mdi: adx.mdi,
        atr,
        emaFast1h: emaFast,
        emaSlow1h: emaSlow,
        emaTrend4h: emaTrend,
        emaSlope4h,
        candleCloseTime: c1h[c1h.length - 1].closeTime,
    };
}

export function regimeDirection(regime: Regime): Direction | null {
    if (regime === 'TREND_BULL') return 'LONG';
    if (regime === 'TREND_BEAR') return 'SHORT';
    return null;
}

/**
 * Señal de SALIDA: la estructura de tendencia se rompió.
 * No depende del ADX a propósito: que el ADX baje de 22 a 21 no es motivo para salir.
 */
export function trendBroken(ev: Evaluation, direction: Direction): boolean {
    if (direction === 'LONG') return ev.emaFast1h < ev.emaSlow1h || ev.price < ev.emaTrend4h;
    return ev.emaFast1h > ev.emaSlow1h || ev.price > ev.emaTrend4h;
}

// ---------------------------------------------------------------------------
// Plan de trade y costes
// ---------------------------------------------------------------------------

export interface TradePlan {
    direction: Direction;
    entry: number;
    stopLoss: number;
    takeProfit: number;
    stopDistance: number;
    /** Tamaño nocional como múltiplo del balance (p. ej. 1.5 = posición de 1.5× el capital). */
    leverage: number;
    /** Riesgo real en % del balance (puede ser < riskPct si el apalancamiento quedó topado). */
    effectiveRiskPct: number;
    /** Coste estimado de ida y vuelta (comisiones + slippage) expresado en R. */
    costR: number;
    rrGross: number;
    /** R:R neto: (objetivo − costes) / (stop + costes). */
    rrNet: number;
}

/** Coste de ida y vuelta como fracción del precio (comisión en ambos lados + slippage). */
export function roundTripCostFraction(c: CostParams): number {
    return 2 * c.takerFee + (2 * c.slippageBps) / 10_000;
}

export function buildTradePlan(
    direction: Direction,
    entry: number,
    atr: number,
    p: StrategyParams,
    c: CostParams,
): TradePlan {
    const sign = direction === 'LONG' ? 1 : -1;
    const stopDistance = atr * p.atrStopMult;
    const stopPct = stopDistance / entry;
    const leverage = Math.min((c.riskPct / 100) / stopPct, c.maxLeverage);
    const costR = (roundTripCostFraction(c) * entry) / stopDistance;
    return {
        direction,
        entry,
        stopLoss: entry - sign * stopDistance,
        takeProfit: entry + sign * stopDistance * p.rrTarget,
        stopDistance,
        leverage,
        effectiveRiskPct: leverage * stopPct * 100,
        costR,
        rrGross: p.rrTarget,
        rrNet: (p.rrTarget - costR) / (1 + costR),
    };
}

export interface ExitHit {
    price: number;
    reason: Extract<ExitReason, 'SL' | 'TP'>;
}

/**
 * Comprueba si una vela toca el stop o el objetivo.
 * Si toca ambos en la misma vela se asume el STOP (conservador: con OHLC no se sabe qué fue primero).
 * Si la vela abre más allá del stop (gap), se ejecuta en la apertura.
 */
export function checkExitOnCandle(
    trade: { direction: Direction; stopLoss: number; takeProfit: number },
    candle: Candle,
): ExitHit | null {
    if (trade.direction === 'LONG') {
        if (candle.low <= trade.stopLoss) return { price: Math.min(candle.open, trade.stopLoss), reason: 'SL' };
        if (candle.high >= trade.takeProfit) return { price: trade.takeProfit, reason: 'TP' };
    } else {
        if (candle.high >= trade.stopLoss) return { price: Math.max(candle.open, trade.stopLoss), reason: 'SL' };
        if (candle.low <= trade.takeProfit) return { price: trade.takeProfit, reason: 'TP' };
    }
    return null;
}

export interface TradeResult {
    entryFill: number;
    exitFill: number;
    /** Resultado neto (comisiones + slippage incluidos) en múltiplos del riesgo inicial. */
    rNet: number;
    /** Resultado neto como fracción del balance antes de la operación. */
    balanceReturn: number;
    /** Comisiones pagadas como fracción del balance. */
    feesFraction: number;
}

/**
 * Resultado neto de una operación. La comisión se cobra sobre el NOCIONAL en la entrada y en la salida,
 * se gane o se pierda, y el slippage se aplica en ambos lados (peor en los stops).
 */
export function computeTradeResult(
    trade: { direction: Direction; entry: number; stopDistance: number; leverage: number },
    exitPrice: number,
    exitReason: ExitReason,
    c: CostParams,
): TradeResult {
    const sign = trade.direction === 'LONG' ? 1 : -1;
    const exitSlipBps = exitReason === 'SL' ? c.stopSlippageBps : c.slippageBps;
    const entryFill = trade.entry * (1 + (sign * c.slippageBps) / 10_000);
    const exitFill = exitPrice * (1 - (sign * exitSlipBps) / 10_000);

    // Por unidad del activo
    const grossPerUnit = (exitFill - entryFill) * sign;
    const feesPerUnit = c.takerFee * (entryFill + exitFill);
    const netPerUnit = grossPerUnit - feesPerUnit;

    // Cantidad = (balance × apalancamiento) / precio de entrada  → por unidad de balance:
    const qtyPerBalance = trade.leverage / entryFill;
    return {
        entryFill,
        exitFill,
        rNet: netPerUnit / trade.stopDistance,
        balanceReturn: netPerUnit * qtyPerBalance,
        feesFraction: feesPerUnit * qtyPerBalance,
    };
}

// ---------------------------------------------------------------------------
// Anti-spam: máquina de estados con histéresis (persistida en BD por el motor)
// ---------------------------------------------------------------------------

export interface SignalState {
    /** Dirección ya alertada. No se vuelve a alertar en esa dirección hasta que se "rearme". */
    disarmed: Direction | null;
    /** Cierre de la última vela de 1h procesada (para no procesar dos veces la misma vela). */
    lastCandleCloseTime: number | null;
}

export const INITIAL_STATE: SignalState = { disarmed: null, lastCandleCloseTime: null };

export type Decision =
    | { action: 'NONE'; state: SignalState }
    | { action: 'ENTER'; direction: Direction; plan: TradePlan; state: SignalState }
    | { action: 'REJECT'; direction: Direction; reason: string; plan: TradePlan; state: SignalState };

/**
 * Decide si hay que emitir una señal de entrada.
 *
 * Histéresis: tras alertar un LONG, el lado LONG queda "desarmado". Solo se rearma si
 *  - el mercado entra en rango (ADX < adxRangeMax), o
 *  - la estructura de tendencia se rompe (misma condición que la señal de salida).
 * Así, si el ADX oscila entre 20 y 22, NO se repite la misma señal.
 */
export function decide(
    ev: Evaluation,
    state: SignalState,
    opts: { activeDirection: Direction | null; strategyActive: boolean },
    p: StrategyParams,
    c: CostParams,
): Decision {
    let disarmed = state.disarmed;
    if (ev.regime === 'RANGE_COMPRESSION') disarmed = null;
    if (disarmed && trendBroken(ev, disarmed)) disarmed = null;

    const base: SignalState = { disarmed, lastCandleCloseTime: ev.candleCloseTime };
    const direction = regimeDirection(ev.regime);
    if (!direction || disarmed === direction) return { action: 'NONE', state: base };

    // Hay un disparo nuevo. A partir de aquí, pase lo que pase, se desarma esa dirección
    // para no repetir el mismo disparo (o el mismo rechazo) en cada ciclo.
    const plan = buildTradePlan(direction, ev.price, ev.atr, p, c);
    const state2: SignalState = { ...base, disarmed: direction };

    if (!opts.strategyActive) return { action: 'REJECT', direction, reason: 'ESTRATEGIA_DESACTIVADA', plan, state: state2 };
    if (opts.activeDirection === direction) {
        return { action: 'REJECT', direction, reason: 'YA_HAY_SEÑAL_ACTIVA', plan, state: state2 };
    }
    if (plan.rrNet < p.minRrNet) {
        return { action: 'REJECT', direction, reason: `RR_NETO_INSUFICIENTE (${plan.rrNet.toFixed(2)} < ${p.minRrNet})`, plan, state: state2 };
    }
    return { action: 'ENTER', direction, plan, state: state2 };
}

/** Índice de la última vela cuyo CIERRE es <= t (o -1). Las velas deben estar ordenadas. */
export function lastClosedIndex(candles: Candle[], t: number, startHint = 0): number {
    let i = Math.max(-1, startHint - 1);
    while (i + 1 < candles.length && candles[i + 1].closeTime <= t) i++;
    return i;
}
