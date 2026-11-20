/**
 * Motor de señales 24/7 — NovaDrive Trading.
 *
 * Cada 15 minutos:
 *   1. Descarga velas de 1h y 4h de Binance y usa SOLO las velas cerradas.
 *   2. Clasifica el régimen con la estrategia compartida (lib/estrategia.ts).
 *   3. Gestiona la señal activa: la cierra si tocó Stop / TP2 o si terminó la
 *      tendencia, guarda el resultado en la tabla Signal y avisa por Telegram.
 *   4. Si el mercado ENTRA en tendencia, crea una señal nueva (tabla Signal) y
 *      la envía por Telegram.
 *   5. Guarda el régimen en MarketRegimeRecord (sirve de "latido" al dashboard).
 *
 * El filtro anti-spam ya no vive en memoria: el régimen anterior se lee de la
 * base de datos, así que un reinicio del servidor no repite alertas.
 */

import http from 'http';
import { PrismaClient } from '@prisma/client';
import { descargarHistorial, descargarVelas, SIMBOLO } from './lib/binance';
import {
    calcularNiveles,
    calcularValores,
    clasificarRegimen,
    CONFIG,
    direccionDeRegimen,
    NOMBRE_ESTRATEGIA,
    resultadoEnR,
    buscarSalida,
    type Direccion,
    type MotivoCierre,
    type Regimen,
} from './lib/estrategia';
import { enviarTelegram } from './lib/telegram';

const MINUTOS_ENTRE_CICLOS = 15;
const ERRORES_PARA_AVISAR = 3;

const prisma = new PrismaClient();

let corriendo = false;
let erroresSeguidos = 0;
let ultimoCicloOk: Date | null = null;

// === Servidor HTTP (Render exige un puerto abierto) ===
// GET /health devuelve el estado; úsalo con un monitor externo (p. ej. UptimeRobot
// o cron-job.org) que lo llame cada 5-10 min para que el plan gratis no se duerma.
const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/health')) {
        const sano = ultimoCicloOk !== null && Date.now() - ultimoCicloOk.getTime() < 2 * MINUTOS_ENTRE_CICLOS * 60_000;
        res.writeHead(sano ? 200 : 503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ estado: sano ? 'ok' : 'degradado', ultimoCicloOk, erroresSeguidos }));
        return;
    }
    res.end('Motor NovaDrive activo');
});
server.listen(Number(process.env.PORT) || 3000, () => console.log('🌐 Servidor HTTP escuchando (Render).'));

const formato = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ENLACE_TESTNET = '👉 <a href="https://testnet.binancefuture.com/en/futures/BTCUSDT">Abrir Binance Testnet</a>';

function regimenDeDireccion(direccion: Direccion): Regimen {
    return direccion === 'LONG' ? 'TREND_BULL' : 'TREND_BEAR';
}

async function registrarSalud(status: 'OK' | 'ERROR', message: string) {
    try {
        await prisma.systemHealth.create({ data: { component: 'engine', status, message: message.slice(0, 1000) } });
    } catch (error) {
        console.error('❌ No se pudo guardar SystemHealth:', error);
    }
}

async function cerrarSenal(
    senal: { id: string; direction: string; entryPrice: number; stopLoss: number; generatedAt: Date },
    precioSalida: number,
    motivo: MotivoCierre,
) {
    const direccion = senal.direction as Direccion;
    const riesgo = Math.abs(senal.entryPrice - senal.stopLoss);
    const pnlR = resultadoEnR(direccion, senal.entryPrice, precioSalida, riesgo);

    await prisma.signal.update({
        where: { id: senal.id },
        data: { status: `CLOSED_${motivo}`, closedAt: new Date(), pnlNet: pnlR },
    });

    const icono = pnlR >= 0 ? '✅' : '🛑';
    const textoMotivo = { STOP_LOSS: 'Stop Loss alcanzado', TAKE_PROFIT: 'Take Profit alcanzado', FIN_DE_REGIMEN: 'Terminó la tendencia' }[motivo];
    console.log(`${icono} Señal ${direccion} cerrada: ${textoMotivo} (${pnlR.toFixed(2)}R)`);
    await enviarTelegram(
        `${icono} <b>CERRAR ${direccion}</b>\n\n` +
        `📌 <b>Motivo:</b> ${textoMotivo}\n` +
        `💰 <b>Entrada:</b> $${formato(senal.entryPrice)}\n` +
        `🏁 <b>Salida:</b> $${formato(precioSalida)}\n` +
        `📈 <b>Resultado neto:</b> ${pnlR >= 0 ? '+' : ''}${pnlR.toFixed(2)}R\n\n${ENLACE_TESTNET}`,
    );
}

async function cicloMaestro() {
    if (corriendo) {
        console.log('⏳ El ciclo anterior sigue en curso; se omite este.');
        return;
    }
    corriendo = true;

    try {
        console.log(`\n📥 [${new Date().toISOString()}] Evaluando ${SIMBOLO}...`);

        const [velas1h, velas4h] = await Promise.all([descargarVelas('1h', 400), descargarVelas('4h', 400)]);
        const cerradas1h = velas1h.filter(v => v.cerrada);
        const cerradas4h = velas4h.filter(v => v.cerrada);
        if (cerradas1h.length < CONFIG.minimoVelas1h || cerradas4h.length < CONFIG.minimoVelas4h) {
            throw new Error(`Historial insuficiente (${cerradas1h.length} velas 1h, ${cerradas4h.length} velas 4h).`);
        }

        // Precio de referencia para entradas y cierres a mercado: último precio negociado.
        const precioActual = velas1h[velas1h.length - 1].close;

        const valores = calcularValores(cerradas1h, cerradas4h).at(-1);
        if (!valores) throw new Error('No se pudieron calcular los indicadores.');

        const ultimoRegistro = await prisma.marketRegimeRecord.findFirst({ orderBy: { timestamp: 'desc' } });
        const regimenPrevio = ultimoRegistro?.regime ?? null;
        const regimen = clasificarRegimen(valores, regimenPrevio);
        console.log(`🎯 Régimen: ${regimen} (anterior: ${regimenPrevio ?? 'ninguno'}) | ADX ${valores.adx.toFixed(1)} | ATR ${valores.atr.toFixed(1)}`);

        // === 1. Gestionar la señal activa ===
        let haySenalAbierta = false;
        const activa = await prisma.signal.findFirst({
            where: { status: 'ACTIVE', strategy: NOMBRE_ESTRATEGIA },
            orderBy: { generatedAt: 'desc' },
        });

        if (activa) {
            const direccion = activa.direction as Direccion;
            const velasDesdeEntrada = await descargarHistorial('15m', activa.generatedAt.getTime(), Date.now());
            const salida = buscarSalida(
                { direccion, stopLoss: activa.stopLoss, takeProfit2: activa.takeProfit2 },
                velasDesdeEntrada,
            );

            if (salida) {
                await cerrarSenal(activa, salida.precio, salida.motivo);
            } else if (regimen !== regimenDeDireccion(direccion)) {
                await cerrarSenal(activa, precioActual, 'FIN_DE_REGIMEN');
            } else {
                haySenalAbierta = true;
                console.log(`📌 Señal ${direccion} sigue abierta (entrada $${formato(activa.entryPrice)}).`);
            }
        }

        // === 2. ¿Nueva señal? Solo al ENTRAR en tendencia (anti-spam persistente) ===
        const direccion = direccionDeRegimen(regimen);
        if (direccion && regimen !== regimenPrevio && !haySenalAbierta) {
            const niveles = calcularNiveles(direccion, precioActual, valores.atr);
            const config = await prisma.strategyConfig.findUnique({ where: { strategyName: NOMBRE_ESTRATEGIA } });

            if (config && !config.isActive) {
                await prisma.rejectedSignal.create({
                    data: { strategy: NOMBRE_ESTRATEGIA, direction: direccion, reason: 'Estrategia desactivada en StrategyConfig', riskRewardNet: niveles.riskRewardNet },
                });
                console.log('🚫 Señal descartada: la estrategia está desactivada.');
            } else {
                await prisma.signal.create({
                    data: {
                        symbol: SIMBOLO,
                        strategy: NOMBRE_ESTRATEGIA,
                        direction: direccion,
                        entryPrice: niveles.entrada,
                        stopLoss: niveles.stopLoss,
                        takeProfit1: niveles.takeProfit1,
                        takeProfit2: niveles.takeProfit2,
                        riskRewardNet: niveles.riskRewardNet,
                    },
                });

                const riesgoMax = config?.maxRiskPerTrade ?? 0.75;
                const distanciaStopPct = (niveles.riesgoPorUnidad / niveles.entrada) * 100;
                const tamanoPct = (riesgoMax / distanciaStopPct) * 100; // tamaño de posición como % del capital

                const icono = direccion === 'LONG' ? '🟢' : '🔴';
                console.log(`${icono} NUEVA SEÑAL ${direccion} a $${formato(niveles.entrada)}`);
                await enviarTelegram(
                    `${icono} <b>NUEVA SEÑAL: ${direccion === 'LONG' ? 'LONG (COMPRA)' : 'SHORT (VENTA)'}</b>\n\n` +
                    `🎯 <b>Régimen:</b> ${regimen}\n` +
                    `📊 <b>ADX 1H:</b> ${valores.adx.toFixed(2)}\n` +
                    `💰 <b>Entrada:</b> $${formato(niveles.entrada)}\n\n` +
                    `🛡️ <b>Gestión de riesgo:</b>\n` +
                    `🛑 <b>Stop Loss:</b> $${formato(niveles.stopLoss)} (${distanciaStopPct.toFixed(2)}%)\n` +
                    `🎯 <b>TP1 (1R):</b> $${formato(niveles.takeProfit1)}\n` +
                    `🎯 <b>TP2 (2R):</b> $${formato(niveles.takeProfit2)}\n` +
                    `⚖️ <b>R:R neto:</b> ${niveles.riskRewardNet.toFixed(2)}\n` +
                    `📐 <b>Tamaño sugerido:</b> ${tamanoPct.toFixed(0)}% del capital (riesgo ${riesgoMax}%)\n\n` +
                    `ℹ️ Si la tendencia termina antes, llegará una alerta de cierre.\n\n${ENLACE_TESTNET}`,
                );
            }
        }

        // === 3. Registro del régimen (también es el "latido" que ve el dashboard) ===
        const registro = await prisma.marketRegimeRecord.create({
            data: { regime: regimen, adx1h: valores.adx, emaSlope4h: valores.pendienteEma4h },
        });
        console.log(`✅ Ciclo finalizado. Registro ${registro.id}`);

        if (erroresSeguidos >= ERRORES_PARA_AVISAR) {
            await enviarTelegram('✅ <b>Motor recuperado</b>: vuelve a funcionar con normalidad.');
        }
        erroresSeguidos = 0;
        ultimoCicloOk = new Date();
    } catch (error) {
        erroresSeguidos++;
        const mensaje = error instanceof Error ? error.message : String(error);
        console.error(`❌ Error en el ciclo (${erroresSeguidos} seguidos):`, error);
        await registrarSalud('ERROR', mensaje);
        if (erroresSeguidos === ERRORES_PARA_AVISAR) {
            await enviarTelegram(`⚠️ <b>Motor con errores</b>: ${erroresSeguidos} ciclos seguidos fallando.\n<code>${mensaje.slice(0, 300).replace(/[<>&]/g, '')}</code>`);
        }
    } finally {
        corriendo = false;
    }
}

console.log('===================================================');
console.log(`🤖 MOTOR NOVADRIVE — estrategia ${NOMBRE_ESTRATEGIA}`);
console.log('===================================================');

void registrarSalud('OK', 'Motor iniciado');
void cicloMaestro();
const intervalo = setInterval(() => void cicloMaestro(), MINUTOS_ENTRE_CICLOS * 60 * 1000);

async function apagar(senal: string) {
    console.log(`\n👋 ${senal} recibido, cerrando...`);
    clearInterval(intervalo);
    server.close();
    await prisma.$disconnect();
    process.exit(0);
}
process.on('SIGTERM', () => void apagar('SIGTERM'));
process.on('SIGINT', () => void apagar('SIGINT'));
