import { ADX, ATR } from 'technicalindicators';
import type { CostParams } from '../config';
import { checkExitOnCandle, computeTradeResult, lastClosedIndex } from '../strategy';
import type { Candle, ExitReason } from '../types';
import type { BacktestResult, BacktestTrade } from './types';

/**
 * Estrategia ANTIGUA de barrido de liquidez en 15m (la que tenía backtester.ts).
 * NO es la que corre en vivo; se conserva solo para comparar. Correcciones respecto a la versión anterior:
 *  - Sin look-ahead: el filtro de ADX usa solo velas de 1h con closeTime <= cierre de la vela de 15m
 *    (antes comparaba horas de APERTURA y usaba la vela de 1h aún abierta).
 *  - Comisiones sobre el nocional en entrada y salida, se gane o se pierda.
 *  - Slippage en la entrada y en la salida.
 *  - Los cierres por tiempo liquidan al precio de cierre (con su ganancia o pérdida real).
 *  - No hay operaciones solapadas: se busca la siguiente señal después de cerrar la anterior.
 */
export const SWEEP_PARAMS = {
    atrPeriod: 14,
    lookbackLevels: 20,
    sweepAtr: 0.15,
    stopAtr: 0.35,
    rrTarget: 1.6,
    maxBars: 15,
    adxPeriod: 14,
    adxMax: 20,
    adxLookback1h: 100,
};

export function runSweepBacktest(
    c15: Candle[],
    c1h: Candle[],
    c: CostParams,
    initialCapital = 10_000,
    sp = SWEEP_PARAMS,
    /** Solo para tests: recibe las ventanas de datos usadas en cada instante t. */
    onWindow?: (t: number, windows: Candle[][]) => void,
): BacktestResult {
    const trades: BacktestTrade[] = [];
    const rejected: BacktestResult['rejected'] = [];
    let balance = initialCapital;

    const atr = ATR.calculate({
        high: c15.map(v => v.high),
        low: c15.map(v => v.low),
        close: c15.map(v => v.close),
        period: sp.atrPeriod,
    });
    // ATR.calculate devuelve n - period valores; atr[k] corresponde a la vela k + period.
    const atrAt = (i: number) => atr[i - sp.atrPeriod];

    let j1 = 0;
    for (let i = Math.max(sp.lookbackLevels, sp.atrPeriod); i < c15.length - 1; i++) {
        const bar = c15[i];
        const a = atrAt(i);
        if (a === undefined) continue;

        const prev = c15.slice(i - sp.lookbackLevels, i);
        const support = Math.min(...prev.map(v => v.low));
        if (!(bar.low <= support - sp.sweepAtr * a && bar.close > support)) continue;

        // Filtro de régimen con velas de 1h YA CERRADAS en el cierre de esta vela de 15m
        j1 = lastClosedIndex(c1h, bar.closeTime, j1);
        if (j1 < sp.adxPeriod * 2) continue;
        const w = c1h.slice(Math.max(0, j1 - sp.adxLookback1h + 1), j1 + 1);
        onWindow?.(bar.closeTime, [c15.slice(i - sp.lookbackLevels, i + 1), w]);
        const adx = ADX.calculate({ high: w.map(v => v.high), low: w.map(v => v.low), close: w.map(v => v.close), period: sp.adxPeriod }).pop();
        if (!adx) continue;
        if (adx.adx >= sp.adxMax) {
            rejected.push({ time: bar.closeTime, direction: 'LONG', reason: `ADX_1H_${adx.adx.toFixed(1)}` });
            continue;
        }

        const entry = bar.close;
        const stopLoss = bar.low - sp.stopAtr * a;
        const stopDistance = entry - stopLoss;
        const takeProfit = entry + stopDistance * sp.rrTarget;
        const leverage = Math.min((c.riskPct / 100) / (stopDistance / entry), c.maxLeverage);
        const trade = { direction: 'LONG' as const, entry, stopLoss, takeProfit, stopDistance, leverage };

        let exitPrice = 0;
        let exitReason: ExitReason = 'TIME';
        let exitIndex = Math.min(i + sp.maxBars, c15.length - 1);
        for (let k = i + 1; k <= exitIndex; k++) {
            const hit = checkExitOnCandle(trade, c15[k]);
            if (hit) {
                exitPrice = hit.price;
                exitReason = hit.reason;
                exitIndex = k;
                break;
            }
        }
        if (!exitPrice) exitPrice = c15[exitIndex].close; // cierre por tiempo: se liquida a mercado

        const r = computeTradeResult(trade, exitPrice, exitReason, c);
        balance *= 1 + r.balanceReturn;
        trades.push({
            direction: 'LONG',
            entryTime: bar.closeTime,
            exitTime: c15[exitIndex].closeTime,
            entry,
            exit: exitPrice,
            stopLoss,
            takeProfit,
            exitReason,
            leverage,
            rNet: r.rNet,
            balanceReturn: r.balanceReturn,
            feesFraction: r.feesFraction,
            balanceAfter: balance,
        });
        i = exitIndex; // sin solapamiento
    }

    return {
        strategy: 'LIQUIDITY_SWEEP_15M (legacy)',
        from: c15[0]?.closeTime ?? 0,
        to: c15[c15.length - 1]?.closeTime ?? 0,
        initialCapital,
        trades,
        rejected,
    };
}
