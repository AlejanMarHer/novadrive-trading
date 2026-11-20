/**
 * Descarga de velas públicas de Binance (spot BTCUSDT).
 *
 * - Usa primero `data-api.binance.vision` (endpoint público de solo datos de
 *   mercado de Binance) y, si falla, `api.binance.com`. Se puede forzar otra URL
 *   con la variable de entorno BINANCE_DATA_URL.
 * - Cada petición tiene timeout y se valida el código HTTP.
 * - Cada vela indica si ya está cerrada: la estrategia solo debe usar velas
 *   cerradas para no "repintar" señales.
 */

export interface Vela {
    openTime: number;  // ms
    closeTime: number; // ms (último milisegundo de la vela)
    open: number;
    high: number;
    low: number;
    close: number;
    cerrada: boolean;
}

export const SIMBOLO = 'BTCUSDT';
const TIMEOUT_MS = 10_000;

function urlsBase(): string[] {
    const personalizada = process.env.BINANCE_DATA_URL;
    if (personalizada) return [personalizada.replace(/\/$/, '')];
    return ['https://data-api.binance.vision', 'https://api.binance.com'];
}

function convertir(fila: unknown[], ahora: number): Vela {
    const closeTime = Number(fila[6]);
    return {
        openTime: Number(fila[0]),
        open: parseFloat(String(fila[1])),
        high: parseFloat(String(fila[2])),
        low: parseFloat(String(fila[3])),
        close: parseFloat(String(fila[4])),
        closeTime,
        cerrada: closeTime < ahora,
    };
}

async function pedirKlines(parametros: URLSearchParams): Promise<unknown[][]> {
    let ultimoError: unknown = null;
    for (const base of urlsBase()) {
        const url = `${base}/api/v3/klines?${parametros.toString()}`;
        try {
            const respuesta = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
            if (!respuesta.ok) {
                const cuerpo = await respuesta.text().catch(() => '');
                throw new Error(`HTTP ${respuesta.status} en ${base}: ${cuerpo.slice(0, 200)}`);
            }
            const datos: unknown = await respuesta.json();
            if (!Array.isArray(datos)) throw new Error(`Respuesta inesperada de ${base}: ${JSON.stringify(datos).slice(0, 200)}`);
            return datos as unknown[][];
        } catch (error) {
            ultimoError = error;
        }
    }
    throw ultimoError instanceof Error ? ultimoError : new Error(String(ultimoError));
}

/** Últimas `limite` velas (máx. 1000). La última normalmente sigue abierta. */
export async function descargarVelas(intervalo: string, limite: number, simbolo = SIMBOLO): Promise<Vela[]> {
    const parametros = new URLSearchParams({ symbol: simbolo, interval: intervalo, limit: String(Math.min(limite, 1000)) });
    const ahora = Date.now();
    return (await pedirKlines(parametros)).map(fila => convertir(fila, ahora));
}

/** Historial largo paginado entre dos fechas (solo velas cerradas). */
export async function descargarHistorial(intervalo: string, desde: number, hasta: number, simbolo = SIMBOLO): Promise<Vela[]> {
    const resultado: Vela[] = [];
    let inicio = desde;
    while (inicio < hasta) {
        const parametros = new URLSearchParams({
            symbol: simbolo,
            interval: intervalo,
            startTime: String(inicio),
            endTime: String(hasta),
            limit: '1000',
        });
        const ahora = Date.now();
        const lote = (await pedirKlines(parametros)).map(fila => convertir(fila, ahora));
        if (lote.length === 0) break;
        resultado.push(...lote);
        inicio = lote[lote.length - 1].closeTime + 1;
        if (lote.length < 1000) break;
    }
    return resultado.filter(v => v.cerrada);
}
