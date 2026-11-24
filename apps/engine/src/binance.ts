import { BINANCE_API_URLS } from './config';
import { fetchJson, HttpError } from './http';
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

const bannedUntil = new Map<string, number>();

/**
 * Binance responde 418 cuando banea la IP (indica hasta cuándo) y 429 cuando se acerca al límite.
 * En Render gratuito la IP de salida se comparte con otros clientes, así que el baneo puede venir de terceros.
 */
export function banUntilFromError(err: unknown, now = Date.now()): number | null {
    if (!(err instanceof HttpError) || (err.status !== 418 && err.status !== 429)) return null;
    const m = /banned until (\d{12,})/.exec(err.message);
    if (m) return Number(m[1]);
    return now + (err.status === 418 ? 10 : 2) * 60_000;
}

export function _resetBansForTests(): void {
    bannedUntil.clear();
}

export async function fetchKlines(
    symbol: string,
    interval: string,
    opts: { limit?: number; startTime?: number; endTime?: number } = {},
): Promise<Candle[]> {
    const params = new URLSearchParams({ symbol, interval, limit: String(opts.limit ?? 500) });
    if (opts.startTime !== undefined) params.set('startTime', String(opts.startTime));
    if (opts.endTime !== undefined) params.set('endTime', String(opts.endTime));
    const errores: string[] = [];
    for (const base of BINANCE_API_URLS) {
        const until = bannedUntil.get(base) ?? 0;
        if (until > Date.now()) {
            // Insistir mientras Binance tiene la IP baneada puede alargar el baneo.
            errores.push(`${base}: IP baneada por Binance hasta ${new Date(until).toISOString()} (no se reintenta)`);
            continue;
        }
        try {
            return parseKlines(await fetchJson(`${base}/api/v3/klines?${params}`));
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            const ban = banUntilFromError(err);
            if (ban) bannedUntil.set(base, ban);
            errores.push(msg);
            console.warn(`⚠️ Binance falló en ${base}: ${msg}`);
        }
    }
    // Se informan los errores de TODOS los hosts (p. ej. 418 = IP baneada por Binance, 451 = región bloqueada)
    throw new Error(`Binance no respondió en ningún host → ${errores.join(' | ')}`);
}

/** Descarga las últimas `count` velas CERRADAS. */
export async function fetchClosedKlines(symbol: string, interval: string, count: number): Promise<Candle[]> {
    // Pedimos una más porque la última (en curso) se descarta.
    const candles = closedOnly(await fetchKlines(symbol, interval, { limit: Math.min(count + 1, 1000) }));
    return candles.slice(-count);
}
