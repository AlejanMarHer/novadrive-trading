import type { Evaluation } from '../src/strategy';
import type { Candle } from '../src/types';

/** PRNG determinista (mulberry32) para que los tests sean reproducibles. */
export function rng(seed: number) {
    return () => {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Serie sintética con tramos de tendencia alcista, bajista y rango.
 * `drifts` es la deriva por vela de cada tramo (en fracción del precio).
 */
export function syntheticCandles(
    stepMs: number,
    count: number,
    { seed = 1, start = Date.UTC(2024, 0, 1), price = 50_000, vol = 0.004, drifts = [0.0015, 0, -0.0015, 0] } = {},
): Candle[] {
    const rand = rng(seed);
    const segment = Math.ceil(count / drifts.length);
    const out: Candle[] = [];
    let p = price;
    for (let i = 0; i < count; i++) {
        const drift = drifts[Math.floor(i / segment)];
        const open = p;
        const close = open * (1 + drift + (rand() - 0.5) * 2 * vol);
        const high = Math.max(open, close) * (1 + rand() * vol);
        const low = Math.min(open, close) * (1 - rand() * vol);
        const openTime = start + i * stepMs;
        out.push({ openTime, closeTime: openTime + stepMs - 1, open, high, low, close });
        p = close;
    }
    return out;
}

/** Agrega velas a un marco temporal mayor (p. ej. 1h → 4h), como hace Binance. */
export function aggregate(candles: Candle[], factor: number): Candle[] {
    const out: Candle[] = [];
    for (let i = 0; i + factor <= candles.length; i += factor) {
        const g = candles.slice(i, i + factor);
        out.push({
            openTime: g[0].openTime,
            closeTime: g[g.length - 1].closeTime,
            open: g[0].open,
            high: Math.max(...g.map(c => c.high)),
            low: Math.min(...g.map(c => c.low)),
            close: g[g.length - 1].close,
        });
    }
    return out;
}

export const HOUR = 3_600_000;

export function makeEv(overrides: Partial<Evaluation> = {}): Evaluation {
    return {
        regime: 'TREND_BULL',
        price: 100_000,
        adx: 25,
        pdi: 30,
        mdi: 15,
        atr: 800,
        emaFast1h: 99_500,
        emaSlow1h: 99_000,
        emaTrend4h: 97_000,
        emaSlope4h: 0.1,
        candleCloseTime: Date.UTC(2025, 0, 1, 10) - 1,
        ...overrides,
    };
}
