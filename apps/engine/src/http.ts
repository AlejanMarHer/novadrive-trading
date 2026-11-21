import { HTTP_TIMEOUT_MS } from './config';

export class HttpError extends Error {
    constructor(message: string, public readonly status?: number) {
        super(message);
        this.name = 'HttpError';
    }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * fetch con timeout, comprobación de `response.ok` y reintentos con backoff
 * para errores de red, 429 y 5xx. Nunca devuelve una respuesta fallida en silencio.
 */
export async function fetchJson<T = unknown>(
    url: string,
    init: RequestInit = {},
    { timeoutMs = HTTP_TIMEOUT_MS, retries = 2 }: { timeoutMs?: number; retries?: number } = {},
): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
            const text = await res.text();
            if (!res.ok) {
                const retryable = res.status === 429 || res.status >= 500;
                const err = new HttpError(`HTTP ${res.status} en ${redact(url)}: ${text.slice(0, 300)}`, res.status);
                if (!retryable) throw err;
                lastError = err;
            } else {
                try {
                    return JSON.parse(text) as T;
                } catch {
                    throw new HttpError(`Respuesta no-JSON de ${redact(url)}: ${text.slice(0, 200)}`, res.status);
                }
            }
        } catch (err) {
            if (err instanceof HttpError && err.status && err.status < 500 && err.status !== 429) throw err;
            lastError = err;
        }
        if (attempt < retries) await sleep(1000 * 2 ** attempt);
    }
    if (lastError instanceof HttpError) throw lastError;
    const cause = lastError instanceof Error ? (lastError.cause instanceof Error ? lastError.cause.message : lastError.message) : String(lastError);
    throw new HttpError(`Fallo de red en ${redact(url)} tras ${retries + 1} intentos: ${cause}`);
}

/** Oculta el token de Telegram (y cualquier otro secreto en la ruta) en los logs. */
export function redact(url: string): string {
    return url.replace(/bot[^/]+\//, 'bot***/');
}
