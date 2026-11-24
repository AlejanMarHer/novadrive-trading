/**
 * Endpoints públicos de Binance para el navegador, en orden de preferencia.
 * Los *.binance.vision son los oficiales de solo datos de mercado y no tienen bloqueo geográfico;
 * si uno falla, se prueba el siguiente.
 */
export const BINANCE_REST_HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com'];
const WS_HOSTS = ['wss://stream.binance.com:9443', 'wss://data-stream.binance.vision'];

export type StreamStatus = 'conectando' | 'conectado' | 'desconectado';

/** Descarga velas probando cada host hasta que uno responda bien. */
export async function fetchKlinesBrowser(symbol: string, interval: string, limit: number): Promise<(string | number)[][]> {
  let lastError: unknown;
  for (const host of BINANCE_REST_HOSTS) {
    try {
      const res = await fetch(`${host}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (Array.isArray(data)) return data;
      throw new Error('respuesta inesperada');
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

/**
 * Abre un stream de Binance con reconexión automática (backoff exponencial) y rotación de host.
 * Devuelve una función para cerrarlo.
 */
export function openBinanceStream(
  stream: string,
  onMessage: (data: unknown) => void,
  onStatus: (s: StreamStatus) => void = () => undefined,
): () => void {
  let ws: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let attempts = 0;
  let hostIdx = 0;
  let closed = false;

  const connect = () => {
    onStatus('conectando');
    ws = new WebSocket(`${WS_HOSTS[hostIdx]}/ws/${stream}`);
    let opened = false;
    ws.onopen = () => {
      opened = true;
      attempts = 0;
      onStatus('conectado');
    };
    ws.onmessage = ev => onMessage(JSON.parse(ev.data));
    ws.onclose = () => {
      if (closed) return;
      if (!opened) hostIdx = (hostIdx + 1) % WS_HOSTS.length; // no llegó a conectar: probar el otro host
      onStatus('desconectado');
      timer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** attempts++));
    };
    ws.onerror = () => ws?.close();
  };
  connect();

  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
    ws?.close();
  };
}
