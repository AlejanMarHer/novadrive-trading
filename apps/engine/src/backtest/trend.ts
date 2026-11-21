import type { CostParams, StrategyParams } from '../config';
import { STRATEGY_NAME } from '../config';
import {
    checkExitOnCandle,
    computeTradeResult,
    decide,
    evaluate,
    INITIAL_STATE,
    lastClosedIndex,
    trendBroken,
    type SignalState,
    type TradePlan,
} from '../strategy';
import type { Candle, ExitReason } from '../types';
import type { BacktestResult, BacktestTrade } from './types';

/**
 * Backtest de la estrategia QUE CORRE EN VIVO (index.ts), usando las mismas funciones
 * `evaluate`, `decide`, `trendBroken` y `checkExitOnCandle`.
 *
 * Se recorre cada cierre de vela de 1h (las únicas horas en que la decisión del motor puede cambiar,
 * porque el motor solo usa velas cerradas). En cada instante t solo se usan:
 *   - velas de 1h con closeTime <= t
 *   - velas de 4h con closeTime <= t   (sin look-ahead: la vela de 4h en curso NO se usa)
 */
export function runTrendBacktest(
    c1h: Candle[],
    c4h: Candle[],
    p: StrategyParams,
    c: CostParams,
    initialCapital = 10_000,
    /** Solo para tests: recibe las ventanas de datos usadas en cada instante t. */
    onWindow?: (t: number, windows: Candle[][]) => void,
): BacktestResult {
    const trades: BacktestTrade[] = [];
    const rejected: BacktestResult['rejected'] = [];
    let balance = initialCapital;
    let state: SignalState = { ...INITIAL_STATE };
    let open: (TradePlan & { entryTime: number; entryIndex: number }) | null = null;
    let j4 = 0;

    const close = (exitPrice: number, reason: ExitReason, time: number) => {
        if (!open) return;
        const r = computeTradeResult(open, exitPrice, reason, c);
        balance *= 1 + r.balanceReturn;
        trades.push({
            direction: open.direction,
            entryTime: open.entryTime,
            exitTime: time,
            entry: open.entry,
            exit: exitPrice,
            stopLoss: open.stopLoss,
            takeProfit: open.takeProfit,
            exitReason: reason,
            leverage: open.leverage,
            rNet: r.rNet,
            balanceReturn: r.balanceReturn,
            feesFraction: r.feesFraction,
            balanceAfter: balance,
        });
        open = null;
    };

    for (let i = p.lookback1h - 1; i < c1h.length; i++) {
        const candle = c1h[i];
        const t = candle.closeTime;

        // 1) Gestión de la posición abierta con la vela que acaba de cerrar
        if (open && i > open.entryIndex) {
            const hit = checkExitOnCandle(open, candle);
            if (hit) close(hit.price, hit.reason, t);
        }

        j4 = lastClosedIndex(c4h, t, j4);
        if (j4 < p.lookback4h - 1) continue;

        const w1h = c1h.slice(i - p.lookback1h + 1, i + 1);
        const w4h = c4h.slice(j4 - p.lookback4h + 1, j4 + 1);
        onWindow?.(t, [w1h, w4h]);
        const ev = evaluate(w1h, w4h, p);
        if (!ev) continue;

        // 2) Señal de salida (tendencia rota) → cierre al precio de cierre
        if (open && trendBroken(ev, open.direction)) close(ev.price, 'EXIT_SIGNAL', t);

        // 3) Señal de entrada
        const d = decide(ev, state, { activeDirection: open?.direction ?? null, strategyActive: true }, p, c);
        state = d.state;
        if (d.action === 'ENTER' && !open) {
            open = { ...d.plan, entryTime: t, entryIndex: i };
        } else if (d.action === 'REJECT') {
            rejected.push({ time: t, direction: d.direction, reason: d.reason });
        }
    }

    const lastCandle = c1h[c1h.length - 1];
    if (open && lastCandle) close(lastCandle.close, 'END', lastCandle.closeTime);

    return {
        strategy: STRATEGY_NAME,
        from: c1h[p.lookback1h - 1]?.closeTime ?? 0,
        to: lastCandle?.closeTime ?? 0,
        initialCapital,
        trades,
        rejected,
    };
}
