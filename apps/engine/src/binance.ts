import { BINANCE_API_URL } from './config';
import { fetchJson } from './http';
import type { Candle } from './types';

type RawKline = [number, string, string, string, string, string, number, ...unknown[]];

export function parseKlines(data: unknown): Candle[] {
    if (!Array.isArray(data)) throw new Error(`Respuesta inesperada de Binance: ${JSON.stringify(data).slice(0, 300)}`);
    return (data as RawKline[]).map(k => ({
        openTime: Number(k[0]),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        closeTime: Number(k[6]),
    }));
}

/**
 * Binance devuelve la vela EN CURSO como la última del array. Esta función la descarta:
 * solo se quedan las velas cuyo cierre ya ocurrió, para que las señales no aparezcan
 * y desaparezcan dentro de la misma vela.
 */
export function closedOnly(candles: Candle[], now: number = Date.now()): Candle[] {
    return candles.filter(c => c.closeTime < now);
}

export async function fetchKlines(
    symbol: string,
    interval: string,
    opts: { limit?: number; startTime?: number; endTime?: number } = {},
): Promise<Candle[]> {
    const params = new URLSearchParams({ symbol, interval, limit: String(opts.limit ?? 500) });
    if (opts.startTime !== undefined) params.set('startTime', String(opts.startTime));
    if (opts.endTime !== undefined) params.set('endTime', String(opts.endTime));
    const data = await fetchJson(`${BINANCE_API_URL}/api/v3/klines?${params}`);
    return parseKlines(data);
}

/** Descarga las últimas `count` velas CERRADAS. */
export async function fetchClosedKlines(symbol: string, interval: string, count: number): Promise<Candle[]> {
    // Pedimos una más porque la última (en curso) se descarta.
    const candles = closedOnly(await fetchKlines(symbol, interval, { limit: Math.min(count + 1, 1000) }));
    return candles.slice(-count);
}
