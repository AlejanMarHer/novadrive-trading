import http from 'http';
import { EMA, ADX } from 'technicalindicators';
import { PrismaClient } from '@prisma/client';

const server = http.createServer((req, res) => res.end('Motor Cuantitativo 24/7 Activo'));
server.listen(process.env.PORT || 3000, () => console.log('Escuchando puerto para Render'));

const prisma = new PrismaClient();

console.log('===================================================');
console.log('🤖 MOTOR CUANTITATIVO: MODO GENERADOR DE SEÑALES');
console.log('===================================================');

interface Vela { high: number; low: number; close: number; }

async function descargarVelas(intervalo: string, limite: number): Promise<Vela[]> {
    const url = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${intervalo}&limit=${limite}`;
    const respuesta = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const datos = await respuesta.json();
    if (!Array.isArray(datos)) throw new Error(`Bloqueo API: ${JSON.stringify(datos)}`);
    return datos.map((vela: any[]) => ({
        high: parseFloat(String(vela[2])),
        low: parseFloat(String(vela[3])),
        close: parseFloat(String(vela[4]))
    }));
}

async function cicloMaestro() {
    try {
        console.log('\n📥 1. Evaluando el mercado global de Binance...');

        const velas1h = await descargarVelas('1h', 100);
        const velas4h = await descargarVelas('4h', 100);

        const cierres4h = velas4h.map(v => v.close);
        const cierres1h = velas1h.map(v => v.close);
        
        const ema50_4h = EMA.calculate({ period: 50, values: cierres4h }).pop()!;
        const precioActual = cierres4h[cierres4h.length - 1];
        const ema21_1h = EMA.calculate({ period: 21, values: cierres1h }).pop()!;
        const ema55_1h = EMA.calculate({ period: 55, values: cierres1h }).pop()!;
        
        const inputADX = {
            high: velas1h.map(v => v.high), low: velas1h.map(v => v.low), close: velas1h.map(v => v.close), period: 14
        };
        const adxResult = ADX.calculate(inputADX).pop()!;

        let regimenActual = 'TRANSITION_CHOP';
        if (precioActual > ema50_4h && ema21_1h > ema55_1h && adxResult.adx >= 22 && adxResult.pdi > adxResult.mdi) {
            regimenActual = 'TREND_BULL';
        } else if (precioActual < ema50_4h && ema21_1h < ema55_1h && adxResult.adx >= 22 && adxResult.mdi > adxResult.pdi) {
            regimenActual = 'TREND_BEAR';
        } else if (adxResult.adx < 20) {
            regimenActual = 'RANGE_COMPRESSION';
        }

        console.log(`🎯 Régimen Detectado: ${regimenActual}`);

        // === GENERADOR DE SEÑALES PARA EJECUCIÓN MANUAL ===
        let senalRecomendada = 'ESPERAR';
        if (regimenActual === 'TREND_BULL') {
            senalRecomendada = 'COMPRAR (LONG)';
            console.log(`🟢 SEÑAL DE TRADING: ${senalRecomendada} -> Entrar al mercado ahora.`);
        } else if (regimenActual === 'TREND_BEAR') {
            senalRecomendada = 'VENDER (SHORT)';
            console.log(`🔴 SEÑAL DE TRADING: ${senalRecomendada} -> Entrar al mercado ahora.`);
        } else {
            console.log(`🟡 SEÑAL DE TRADING: ${senalRecomendada} -> Mercado lateral. Protege tu capital.`);
        }

        console.log('💾 2. Guardando registro y señal en Supabase...');
        const registro = await prisma.marketRegimeRecord.create({
            data: { regime: regimenActual, adx1h: adxResult.adx, emaSlope4h: 0 }
        });
        
        console.log(`✅ Registro exitoso en la nube. ¡Vercel actualizado!`);
        console.log('===================================================');

    } catch (error) {
        console.error('❌ Error en el ciclo maestro:', error);
    } finally {
        await prisma.$disconnect();
    }
}

// Ejecución inicial y bucle
cicloMaestro();
const MINUTOS = 15;
setInterval(() => {
    console.log(`\n⏳ [RELOJ] Iniciando nuevo escaneo del mercado...`);
    cicloMaestro();
}, MINUTOS * 60 * 1000);