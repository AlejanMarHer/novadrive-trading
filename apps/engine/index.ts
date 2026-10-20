import http from 'http';
// Servidor "latido" para engañar a Render y usar la capa gratuita
const server = http.createServer((req, res) => res.end('Motor Cuantitativo 24/7 Activo'));
server.listen(process.env.PORT || 3000, () => console.log('Escuchando puerto para Render'));

import { EMA, ADX } from 'technicalindicators';
import { PrismaClient } from '@prisma/client';

// Inicializamos la conexión a la base de datos (Supabase)
const prisma = new PrismaClient();

console.log('===================================================');
console.log('🤖 MOTOR CUANTITATIVO: UNIFICACIÓN Y BASE DE DATOS');
console.log('===================================================');

async function descargarVelas(intervalo: string, limite: number) {
    const url = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${intervalo}&limit=${limite}`;
    const respuesta = await fetch(url);
    const datos = await respuesta.json();
    return datos.map((vela: any) => ({
        high: parseFloat(vela[2]),
        low: parseFloat(vela[3]),
        close: parseFloat(vela[4])
    }));
}

async function cicloMaestro() {
    try {
        console.log('📥 1. Evaluando el mercado...');
        
        // Descargamos 1H y 4H para el Régimen
        const velas1h = await descargarVelas('1h', 100);
        const velas4h = await descargarVelas('4h', 100);

        const cierres4h = velas4h.map(v => v.close);
        const cierres1h = velas1h.map(v => v.close);
        
        const ema50_4h = EMA.calculate({ period: 50, values: cierres4h }).pop()!;
        const precioActual = cierres4h[cierres4h.length - 1];
        const ema21_1h = EMA.calculate({ period: 21, values: cierres1h }).pop()!;
        const ema55_1h = EMA.calculate({ period: 55, values: cierres1h }).pop()!;
        
        const inputADX = {
            high: velas1h.map(v => v.high),
            low: velas1h.map(v => v.low),
            close: velas1h.map(v => v.close),
            period: 14
        };
        const adxResult = ADX.calculate(inputADX).pop()!;

        // Clasificador matemático
        let regimenActual = 'TRANSITION_CHOP';
        if (precioActual > ema50_4h && ema21_1h > ema55_1h && adxResult.adx >= 22 && adxResult.pdi > adxResult.mdi) {
            regimenActual = 'TREND_BULL';
        } else if (precioActual < ema50_4h && ema21_1h < ema55_1h && adxResult.adx >= 22 && adxResult.mdi > adxResult.pdi) {
            regimenActual = 'TREND_BEAR';
        } else if (adxResult.adx < 20) {
            regimenActual = 'RANGE_COMPRESSION';
        }

        console.log(`🎯 Régimen Detectado: ${regimenActual}`);
        console.log('💾 2. Guardando registro en Supabase (Base de Datos)...');

        // === MAGIA DE BASE DE DATOS ===
        // Le ordenamos a Prisma que guarde este dato en la tabla MarketRegimeRecord
        const registro = await prisma.marketRegimeRecord.create({
            data: {
                regime: regimenActual,
                adx1h: adxResult.adx,
                // Como simplificación temporal, no guardamos la pendiente 4H para no alargar el código
                emaSlope4h: 0 
            }
        });

        console.log(`✅ ¡ÉXITO! Registro guardado en la nube con ID: ${registro.id}`);
        console.log(`   (ADX guardado: ${registro.adx1h?.toFixed(2)})`);
        console.log('===================================================');

    } catch (error) {
        console.error('❌ Error crítico en el ciclo maestro:', error);
    } finally {
        // Desconectamos la base de datos limpiamente
        await prisma.$disconnect();
    }
}

cicloMaestro();