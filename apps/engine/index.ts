import http from 'http';
import ccxt from 'ccxt';
import { EMA, ADX } from 'technicalindicators';
import { PrismaClient } from '@prisma/client';

const server = http.createServer((req, res) => res.end('Motor Cuantitativo 24/7 Activo'));
server.listen(process.env.PORT || 3000, () => console.log('Escuchando puerto para Render'));

const prisma = new PrismaClient();

// === CONFIGURACIÓN DEL EXCHANGE ===
const exchange = new ccxt.binance({
    apiKey: process.env.BINANCE_API_KEY,
    secret: process.env.BINANCE_SECRET,
    enableRateLimit: true,
    options: {
        defaultType: 'future', // Operar en futuros
    }
});

// 🛡️ EL BYPASS: Engañamos a CCXT inyectando las URLs de la nueva Testnet manualmente
exchange.urls.api.fapiPublic = 'https://testnet.binancefuture.com/fapi/v1';
exchange.urls.api.fapiPrivate = 'https://testnet.binancefuture.com/fapi/v1';
exchange.urls.api.fapiPrivateV2 = 'https://testnet.binancefuture.com/fapi/v2';

console.log('===================================================');
console.log('🤖 MOTOR CUANTITATIVO: FASE DE EJECUCIÓN (TESTNET)');
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
        console.log('\n📥 1. Evaluando el mercado...');
        
        if (process.env.BINANCE_API_KEY) {
            const balance = await exchange.fetchBalance();
            console.log(`🏦 Saldo Demo Disponible: ${balance.USDT?.free?.toFixed(2) || '0.00'} USDT ficticios`);
        } else {
            console.log('⚠️ Llaves de API no detectadas.');
        }

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

        // === 🚀 EL GATILLO: EJECUCIÓN DE ÓRDENES EN LA TESTNET ===
        // Configuramos la orden. CCXT usa la barra inclinada estándar.
        const simboloCCXT = 'BTC/USDT';
        // 0.005 BTC son aproximadamente $400 USD. Tamaño conservador para pruebas.
        const cantidadBTC = 0.005; 

        if (regimenActual === 'TREND_BULL') {
            console.log('🚀 SEÑAL CONFIRMADA: Disparando LONG al mercado...');
            // exchange.createMarketBuyOrder(PAR, TAMAÑO) lanza la orden de compra inmediata
            const orden = await exchange.createMarketBuyOrder(simboloCCXT, cantidadBTC);
            console.log(`✅ LONG EJECUTADO: ID ${orden.id} a precio $${orden.average || orden.price}`);
        } else if (regimenActual === 'TREND_BEAR') {
            console.log('🩸 SEÑAL CONFIRMADA: Disparando SHORT al mercado...');
            // exchange.createMarketSellOrder(PAR, TAMAÑO) lanza la orden de venta (cortos)
            const orden = await exchange.createMarketSellOrder(simboloCCXT, cantidadBTC);
            console.log(`✅ SHORT EJECUTADO: ID ${orden.id} a precio $${orden.average || orden.price}`);
        } else {
            console.log('⏳ SEÑAL: Mercado lateral. El gatillo se mantiene bloqueado para proteger capital.');
        }

        console.log('💾 2. Guardando registro en Supabase...');
        const registro = await prisma.marketRegimeRecord.create({
            data: { regime: regimenActual, adx1h: adxResult.adx, emaSlope4h: 0 }
        });
        console.log(`✅ Registro guardado con ID: ${registro.id}`);
        console.log('===================================================');

    } catch (error) {
        console.error('❌ Error en el ciclo maestro o en el exchange:', error);
    } finally {
        await prisma.$disconnect();
    }
}

// Ejecución inicial y bucle
cicloMaestro();
const MINUTOS = 15;
setInterval(() => {
    console.log(`\n⏳ [RELOJ] Iniciando nuevo análisis...`);
    cicloMaestro();
}, MINUTOS * 60 * 1000);