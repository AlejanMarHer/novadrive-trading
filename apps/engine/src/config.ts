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

/**
 * Bases de la API pública de Binance, en orden de preferencia.
 * data-api.binance.vision es el endpoint oficial SOLO de datos de mercado: no tiene bloqueo geográfico
 * (api.binance.com responde 451 desde EE. UU., donde están Render-Oregon/Ohio y GitHub Actions).
 * Se puede sobrescribir con BINANCE_API_URL (una o varias URLs separadas por comas).
 */
export const BINANCE_API_URLS: string[] = (process.env.BINANCE_API_URL ?? 'https://data-api.binance.vision,https://api.binance.com')
    .split(',')
    .map(u => u.trim().replace(/\/$/, ''))
    .filter(Boolean);

export const HTTP_TIMEOUT_MS = 10_000;
export const CYCLE_MINUTES = 15;

/** Hora UTC del informe diario por Telegram (DAILY_REPORT_HOUR_UTC=off para desactivarlo). */
export const DAILY_REPORT_HOUR_UTC: number | null = (() => {
    const v = process.env.DAILY_REPORT_HOUR_UTC ?? '12';
    if (v === 'off') return null;
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 && n <= 23 ? n : 12;
})();

/** Si entre dos ciclos pasan más de estos minutos, se avisa por Telegram de que el motor estuvo caído. */
export const DOWNTIME_ALERT_MINUTES = 90;

/** Ciclos fallidos seguidos a partir de los cuales se avisa por Telegram. */
export const FAILURE_ALERT_STREAK = 3;
