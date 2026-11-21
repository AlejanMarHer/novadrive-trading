import fs from 'fs';
import path from 'path';
import { closedOnly, fetchKlines } from '../binance';
import type { Candle } from '../types';

const INTERVAL_MS: Record<string, number> = {
    '15m': 15 * 60_000,
    '1h': 60 * 60_000,
    '4h': 4 * 60 * 60_000,
};

const CACHE_DIR = path.join(__dirname, '..', '..', '.cache');

/**
 * Descarga historial largo paginando de 1000 en 1000 (el límite de Binance por petición).
 * Guarda el resultado en apps/engine/.cache para no volver a descargarlo en cada ejecución.
 */
export async function fetchHistory(
    symbol: string,
    interval: string,
    startTime: number,
    endTime: number,
    { useCache = true }: { useCache?: boolean } = {},
): Promise<Candle[]> {
    const step = INTERVAL_MS[interval];
    if (!step) throw new Error(`Intervalo no soportado: ${interval}`);

    // Redondeamos a la hora para que ejecuciones cercanas compartan caché.
    const start = Math.floor(startTime / 3_600_000) * 3_600_000;
    const end = Math.floor(endTime / 3_600_000) * 3_600_000;
    const cacheFile = path.join(CACHE_DIR, `${symbol}-${interval}-${start}-${end}.json`);
    if (useCache && fs.existsSync(cacheFile)) {
        return JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as Candle[];
    }

    const out: Candle[] = [];
    let cursor = start;
    while (cursor < end) {
        const batch = await fetchKlines(symbol, interval, { startTime: cursor, endTime: end, limit: 1000 });
        if (batch.length === 0) break;
        out.push(...batch);
        cursor = batch[batch.length - 1].openTime + step;
        process.stdout.write(`\r   ${interval}: ${out.length} velas descargadas...`);
        await new Promise(r => setTimeout(r, 150)); // respetar el rate limit
    }
    process.stdout.write('\n');

    const candles = dedupe(closedOnly(out, Date.now()));
    if (useCache) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        fs.writeFileSync(cacheFile, JSON.stringify(candles));
    }
    return candles;
}

function dedupe(candles: Candle[]): Candle[] {
    const seen = new Set<number>();
    return candles
        .filter(c => (seen.has(c.openTime) ? false : (seen.add(c.openTime), true)))
        .sort((a, b) => a.openTime - b.openTime);
}
