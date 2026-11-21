import type { CostParams } from './config';
import { checkExitOnCandle, computeTradeResult, trendBroken, type Evaluation } from './strategy';
import type { Candle, Direction, ExitReason } from './types';

export interface ActiveSignalLike {
    direction: Direction;
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    generatedAt: number;
}

export interface SignalExit {
    price: number;
    reason: Extract<ExitReason, 'SL' | 'TP' | 'EXIT_SIGNAL'>;
    time: number;
}

/**
 * Determina si una señal activa ya terminó, con la misma lógica que el backtest:
 *  1. Recorre las velas de 1h cerradas DESPUÉS de emitir la señal buscando SL/TP.
 *  2. Si no se tocaron, comprueba la señal de salida (estructura de tendencia rota).
 */
export function resolveSignal(sig: ActiveSignalLike, closed1h: Candle[], ev: Evaluation | null): SignalExit | null {
    for (const c of closed1h) {
        if (c.closeTime <= sig.generatedAt) continue;
        const hit = checkExitOnCandle(sig, c);
        if (hit) return { price: hit.price, reason: hit.reason, time: c.closeTime };
    }
    if (ev && ev.candleCloseTime > sig.generatedAt && trendBroken(ev, sig.direction)) {
        return { price: ev.price, reason: 'EXIT_SIGNAL', time: ev.candleCloseTime };
    }
    return null;
}

/** Resultado neto en R de una señal cerrada (comisiones sobre el nocional y slippage incluidos). */
export function signalPnlR(sig: ActiveSignalLike, exit: SignalExit, c: CostParams): number {
    const stopDistance = Math.abs(sig.entryPrice - sig.stopLoss);
    return computeTradeResult(
        { direction: sig.direction, entry: sig.entryPrice, stopDistance, leverage: 1 },
        exit.price,
        exit.reason,
        c,
    ).rNet;
}

export const STATUS_BY_REASON: Record<SignalExit['reason'], string> = {
    TP: 'CLOSED_TP',
    SL: 'CLOSED_SL',
    EXIT_SIGNAL: 'CLOSED_EXIT',
};
