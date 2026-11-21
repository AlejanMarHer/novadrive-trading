/** Vela OHLC con hora de apertura y de cierre (milisegundos epoch, igual que Binance). */
export interface Candle {
    openTime: number;
    closeTime: number;
    open: number;
    high: number;
    low: number;
    close: number;
}

export type Direction = 'LONG' | 'SHORT';

export type Regime = 'TREND_BULL' | 'TREND_BEAR' | 'RANGE_COMPRESSION' | 'TRANSITION_CHOP';

export type ExitReason = 'SL' | 'TP' | 'EXIT_SIGNAL' | 'TIME' | 'END';
