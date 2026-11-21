/**
 * Parámetros de la estrategia y del modelo de costes.
 * El motor en vivo y el backtester leen EXACTAMENTE estos valores, para que lo que
 * se prueba sea lo mismo que se opera.
 */
export interface StrategyParams {
    /** Velas de 1h que se usan para calcular indicadores en cada evaluación. */
    lookback1h: number;
    /** Velas de 4h que se usan para calcular indicadores en cada evaluación. */
    lookback4h: number;
    adxPeriod: number;
    atrPeriod: number;
    emaFast1h: number;
    emaSlow1h: number;
    emaTrend4h: number;
    /** Velas de 4h sobre las que se mide la pendiente de la EMA de tendencia. */
    emaSlopeLookback: number;
    /** ADX mínimo para considerar tendencia. */
    adxTrendMin: number;
    /** ADX por debajo del cual el mercado está en rango (y se rearma el anti-spam). */
    adxRangeMax: number;
    /** Distancia del stop en múltiplos de ATR(1h). */
    atrStopMult: number;
    /** Objetivo en múltiplos del riesgo (R). */
    rrTarget: number;
    /** R:R neto mínimo (descontando comisiones y slippage) para emitir una señal. */
    minRrNet: number;
}

export interface CostParams {
    /** Riesgo por operación, en % del balance. */
    riskPct: number;
    /** Apalancamiento máximo (tamaño nocional / balance). */
    maxLeverage: number;
    /** Comisión taker por lado, sobre el NOCIONAL de la posición (0.0005 = 0.05%). */
    takerFee: number;
    /** Slippage en puntos básicos para entradas y salidas a mercado. */
    slippageBps: number;
    /** Slippage en puntos básicos cuando salta el stop (suele ser peor). */
    stopSlippageBps: number;
}

export const STRATEGY_NAME = 'TREND_1H4H_V1';

export const DEFAULT_STRATEGY: StrategyParams = {
    lookback1h: 300,
    lookback4h: 200,
    adxPeriod: 14,
    atrPeriod: 14,
    emaFast1h: 21,
    emaSlow1h: 55,
    emaTrend4h: 50,
    emaSlopeLookback: 3,
    adxTrendMin: 22,
    adxRangeMax: 20,
    atrStopMult: 1.5,
    rrTarget: 2,
    minRrNet: 1.5,
};

export const DEFAULT_COSTS: CostParams = {
    riskPct: 0.75,
    maxLeverage: 3,
    takerFee: 0.0005,
    slippageBps: 2,
    stopSlippageBps: 5,
};

export const SYMBOL = process.env.SYMBOL ?? 'BTCUSDT';

/** Base de la API pública de Binance. En regiones bloqueadas se puede usar https://data-api.binance.vision */
export const BINANCE_API_URL = process.env.BINANCE_API_URL ?? 'https://api.binance.com';

export const HTTP_TIMEOUT_MS = 10_000;
export const CYCLE_MINUTES = 15;
