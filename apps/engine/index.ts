import http from 'http';
import { CYCLE_MINUTES, STRATEGY_NAME, SYMBOL } from './src/config';
import { runCycle } from './src/cycle';
import { logHealth, prisma } from './src/db';

console.log('===================================================');
console.log(`🤖 MOTOR CUANTITATIVO ${STRATEGY_NAME} | ${SYMBOL}`);
console.log('===================================================');

const startedAt = Date.now();
let lastSuccessAt: number | null = null;
let lastError: string | null = null;
let running = false;

// --- Servidor HTTP (Render exige un puerto abierto) + endpoint de salud ---
const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/health')) {
        const reference = lastSuccessAt ?? startedAt;
        const healthy = Date.now() - reference < 2 * CYCLE_MINUTES * 60_000;
        res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: healthy ? 'ok' : 'stale',
            strategy: STRATEGY_NAME,
            lastSuccessAt: lastSuccessAt ? new Date(lastSuccessAt).toISOString() : null,
            lastError,
            uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
        }));
        return;
    }
    res.end('Motor Cuantitativo 24/7 Activo');
});
server.listen(process.env.PORT || 3000, () => console.log(`🌐 Escuchando en el puerto ${process.env.PORT || 3000}`));

async function cicloMaestro() {
    if (running) {
        console.warn('⚠️ El ciclo anterior sigue en curso; se omite este disparo.');
        return;
    }
    running = true;
    console.log(`\n⏱️ [${new Date().toISOString()}] Iniciando ciclo...`);
    try {
        await runCycle();
        lastSuccessAt = Date.now();
        lastError = null;
        console.log('✅ Ciclo finalizado.');
    } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        console.error('❌ Error en el ciclo maestro:', lastError);
        await logHealth('ENGINE', 'ERROR', lastError);
    } finally {
        running = false;
    }
}

/**
 * Programa el siguiente ciclo alineado a los cuartos de hora (+20 s), para evaluar
 * poco después de que cierre cada vela, en vez de a una hora arbitraria.
 */
function programarSiguiente() {
    const periodo = CYCLE_MINUTES * 60_000;
    const espera = periodo - (Date.now() % periodo) + 20_000;
    setTimeout(async () => {
        await cicloMaestro();
        programarSiguiente();
    }, espera);
}

/**
 * Keep-alive opcional para el plan gratuito de Render, que duerme el servicio tras ~15 min sin
 * tráfico ENTRANTE (el temporizador interno no cuenta). Se hace ping a la URL pública del servicio.
 * Lo más fiable sigue siendo un monitor externo (p. ej. UptimeRobot) contra /health, o un plan de pago.
 */
function iniciarKeepAlive() {
    const url = process.env.KEEPALIVE_URL ?? process.env.RENDER_EXTERNAL_URL;
    if (!url || process.env.KEEPALIVE === 'off') return;
    const target = `${url.replace(/\/$/, '')}/health`;
    console.log(`💓 Keep-alive activo contra ${target} cada 10 min`);
    setInterval(() => {
        fetch(target, { signal: AbortSignal.timeout(10_000) }).catch(err =>
            console.warn('⚠️ Keep-alive falló:', err instanceof Error ? err.message : err),
        );
    }, 10 * 60_000);
}

async function shutdown(signal: string) {
    console.log(`\n🛑 ${signal} recibido, cerrando...`);
    server.close();
    await prisma.$disconnect().catch(() => undefined);
    process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

(async () => {
    await logHealth('ENGINE', 'STARTED', `${STRATEGY_NAME} ${SYMBOL}`);
    await cicloMaestro();
    programarSiguiente();
    iniciarKeepAlive();
})();
