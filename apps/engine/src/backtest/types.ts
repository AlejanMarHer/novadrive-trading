import type { Direction, ExitReason } from '../types';

export interface BacktestTrade {
    direction: Direction;
    entryTime: number;
    exitTime: number;
    entry: number;
    exit: number;
    stopLoss: number;
    takeProfit: number;
    exitReason: ExitReason;
    leverage: number;
    rNet: number;
    /** Ganancia/pérdida neta como fracción del balance previo. */
    balanceReturn: number;
    feesFraction: number;
    balanceAfter: number;
}

export interface BacktestResult {
    strategy: string;
    from: number;
    to: number;
    initialCapital: number;
    trades: BacktestTrade[];
    rejected: { time: number; direction: Direction; reason: string }[];
}
