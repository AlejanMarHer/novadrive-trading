import http from 'http';
import { EMA, ADX, ATR } from 'technicalindicators'; // Importamos ATR
import { PrismaClient } from '@prisma/client';

const server = http.createServer((req, res) => res.end('Motor Cuantitativo 24/7 Activo (Señales Dinámicas)'));
server.listen(process.env.PORT || 3000, () => console.log('Escuchando puerto para Render'));

const prisma = new PrismaClient();

console.log('===================================================');
console.log('🤖 MOTOR CUANTITATIVO: MODO GENERADOR DE SEÑALES + TELEGRAM + GESTIÓN DE RIESGO');
console.log('===================================================');

interface Vela { high: number; low: number; close: number; }

// === PUENTE DE COMUNICACIÓN CON TELEGRAM ===
async function enviarTelegram(mensaje: string) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;
    
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    try {
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: mensaje, parse_mode: 'HTML', disable_web_page_preview: true })
        });
        console.log('📱 ¡Alerta enviada a Telegram exitosamente!');
    } catch (error) {
        console.error('❌ Error enviando a Telegram:', error);
    }
}

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

        // NUEVO: Cálculo del ATR para gestión de riesgo dinámica
        const inputATR = {
            high: velas1h.map(v => v.high),
            low: velas1h.map(v => v.low),
            close: velas1h.map(v => v.close),
            period: 14
        };
        const atrValue = ATR.calculate(inputATR).pop()!;

        let regimenActual = 'TRANSITION_CHOP';
        if (precioActual > ema50_4h && ema21_1h > ema55_1h && adxResult.adx >= 22 && adxResult.pdi > adxResult.mdi) {
            regimenActual = 'TREND_BULL';
        } else if (precioActual < ema50_4h && ema21_1h < ema55_1h && adxResult.adx >= 22 && adxResult.mdi > adxResult.pdi) {
            regimenActual = 'TREND_BEAR';
        } else if (adxResult.adx < 20) {
            regimenActual = 'RANGE_COMPRESSION';
        }

        console.log(`🎯 Régimen Detectado: ${regimenActual}`);

        // === GENERADOR DE SEÑALES CON GESTIÓN DE RIESGO (SL/TP) ===
        let senalRecomendada = 'ESPERAR';
        let mensajeTelegram = '';

        // Multiplicador del ATR (Distancia de seguridad)
        const atrMultiplier = 1.5; 
        const volatilidad = atrValue * atrMultiplier;

        if (regimenActual === 'TREND_BULL') {
            senalRecomendada = 'COMPRAR (LONG)';
            console.log(`🟢 SEÑAL DE TRADING: ${senalRecomendada}`);
            
            const stopLoss = precioActual - volatilidad;
            const takeProfit = precioActual + (volatilidad * 2); // R/B 1:2

            mensajeTelegram = `🟢 <b>NUEVA SEÑAL: LONG (COMPRA)</b>\n\n🎯 <b>Régimen:</b> ${regimenActual}\n📊 <b>ADX 1H:</b> ${adxResult.adx.toFixed(2)}\n💰 <b>Precio de Entrada:</b> $${precioActual.toFixed(2)}\n\n🛡️ <b>Gestión de Riesgo Sugerida:</b>\n🛑 <b>Stop Loss:</b> $${stopLoss.toFixed(2)}\n🎯 <b>Take Profit:</b> $${takeProfit.toFixed(2)}\n\n👉 <a href="https://testnet.binancefuture.com/en/futures/BTCUSDT">Abrir Binance Testnet</a>`;
            
        } else if (regimenActual === 'TREND_BEAR') {
            senalRecomendada = 'VENDER (SHORT)';
            console.log(`🔴 SEÑAL DE TRADING: ${senalRecomendada}`);
            
            const stopLoss = precioActual + volatilidad;
            const takeProfit = precioActual - (volatilidad * 2); // R/B 1:2

             mensajeTelegram = `🔴 <b>NUEVA SEÑAL: SHORT (VENTA)</b>\n\n🎯 <b>Régimen:</b> ${regimenActual}\n📊 <b>ADX 1H:</b> ${adxResult.adx.toFixed(2)}\n💰 <b>Precio de Entrada:</b> $${precioActual.toFixed(2)}\n\n🛡️ <b>Gestión de Riesgo Sugerida:</b>\n🛑 <b>Stop Loss:</b> $${stopLoss.toFixed(2)}\n🎯 <b>Take Profit:</b> $${takeProfit.toFixed(2)}\n\n👉 <a href="https://testnet.binancefuture.com/en/futures/BTCUSDT">Abrir Binance Testnet</a>`;
             
        } else {
            console.log(`🟡 SEÑAL DE TRADING: ESPERAR -> Mercado lateral. Protege tu capital.`);
        }

        // Enviar la señal al celular
        if (mensajeTelegram !== '') {
            await enviarTelegram(mensajeTelegram);
        }

        console.log('💾 2. Guardando registro en Supabase...');
        const registro = await prisma.marketRegimeRecord.create({
            data: { regime: regimenActual, adx1h: adxResult.adx, emaSlope4h: 0 }
        });
        
        console.log(`✅ Ciclo finalizado. Registro ID: ${registro.id}`);
        console.log('===================================================');

    } catch (error) {
        console.error('❌ Error en el ciclo maestro:', error);
    } finally {
        await prisma.$disconnect();
    }
}

cicloMaestro();
const MINUTOS = 15;
setInterval(() => {
    console.log(`\n⏳ [RELOJ] Iniciando escaneo...`);
    cicloMaestro();
}, MINUTOS * 60 * 1000);