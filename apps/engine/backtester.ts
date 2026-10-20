import { ADX, ATR } from 'technicalindicators';

console.log('===================================================');
console.log('🔬 MOTOR CUANTITATIVO: BACKTESTING MULTITEMPORAL V2');
console.log('===================================================');

const RIESGO_MAXIMO_PORCENTAJE = 0.75; 
const CAPITAL_INICIAL = 10000;         
const COMISION_TAKER = 0.0005;         
const SLIPPAGE_BASE_BPS = 1.5;         

async function descargarHistorialLargo(intervalo: string, limite: number) {
    const url = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${intervalo}&limit=${limite}`;
    const respuesta = await fetch(url);
    const datos = await respuesta.json();
    return datos.map((vela: any) => ({
        timestamp: new Date(vela[0]),
        open: parseFloat(vela[1]),
        high: parseFloat(vela[2]),
        low: parseFloat(vela[3]),
        close: parseFloat(vela[4])
    }));
}

async function ejecutarBacktestOptimizado() {
    try {
        console.log('📥 1. Descargando datos paralelos (15m y 1h)...');
        
        // Descargamos las velas de 15m (Estrategia) y de 1h (Contexto de Régimen)
        const velas15m = await descargarHistorialLargo('15m', 1000);
        const velas1h = await descargarHistorialLargo('1h', 250); 
        
        console.log(`✅ ¡Se descargaron ${velas15m.length} velas de 15m y ${velas1h.length} velas de 1h!`);

        console.log('⚙️ 2. Calculando estructura matemática base...');
        const inputATR = {
            high: velas15m.map(v => v.high),
            low: velas15m.map(v => v.low),
            close: velas15m.map(v => v.close),
            period: 14
        };
        const arrayATR = ATR.calculate(inputATR);

        let balanceActual = CAPITAL_INICIAL;
        let operacionesTotales = 0;
        let operacionesGanadoras = 0;
        let operacionesPerdedoras = 0;
        let operacionesFiltradas = 0; // El "salvavidas" que cuenta cuántos Stops evitamos

        console.log('⏱️ 3. Iniciando simulación con Filtro de Régimen activado...');
        console.log('---------------------------------------------------\n');

        for (let i = 50; i < velas15m.length - 1; i++) {
            const velaCerrada = velas15m[i];
            const atrActual = arrayATR[i - 14]; 
            
            const ultimas20 = velas15m.slice(i - 20, i);
            const soporte20 = Math.min(...ultimas20.map(v => v.low));
            const resistencia20 = Math.max(...ultimas20.map(v => v.high));

            const filtroBarridoLong = velaCerrada.low <= (soporte20 - 0.15 * atrActual);
            const filtroReclamoLong = velaCerrada.close > soporte20;

            if (filtroBarridoLong && filtroReclamoLong) {
                // === NUEVO: FILTRO DE RÉGIMEN MULTITEMPORAL (1H) ===
                // Buscamos las velas de 1H cuyo timestamp sea ANTERIOR a la vela de 15m actual
                // (Para evitar el temido 'look-ahead bias' o adivinación del futuro)
                const historia1hDisponible = velas1h.filter(v => v.timestamp <= velaCerrada.timestamp);
                
                // Si tenemos suficiente historia de 1H para calcular el ADX (14)
                if (historia1hDisponible.length >= 28) {
                    const inputADX_1h = {
                        high: historia1hDisponible.map(v => v.high),
                        low: historia1hDisponible.map(v => v.low),
                        close: historia1hDisponible.map(v => v.close),
                        period: 14
                    };
                    const adxHistorico = ADX.calculate(inputADX_1h).pop()!;
                    
                    // Nuestra Regla de Oro: Si el mercado tiene tendencia fuerte (ADX >= 20)
                    // Abortamos la trampa de liquidez porque nos van a atropellar.
                    if (adxHistorico.adx >= 20) {
                        operacionesFiltradas++;
                        console.log(`[${velaCerrada.timestamp.toISOString().split('T')[0]}] 🛡️ SEÑAL BLOQUEADA: ADX 1h en ${adxHistorico.adx.toFixed(1)} (Evitamos operar contra tendencia)`);
                        continue; // Saltamos a la siguiente vela sin abrir operación
                    }
                }

                // === SI SOBREVIVE EL FILTRO, EJECUTAMOS LA SIMULACIÓN ===
                operacionesTotales++;
                const precioEntradaTeorico = velaCerrada.close;
                const penalizacionSlippage = precioEntradaTeorico * (SLIPPAGE_BASE_BPS / 10000);
                const precioEntradaReal = precioEntradaTeorico + penalizacionSlippage;

                const stopLoss = velaCerrada.low - 0.35 * atrActual;
                const riesgoBruto = precioEntradaReal - stopLoss;
                const takeProfit = precioEntradaReal + (riesgoBruto * 1.6); 

                const comisionApertura = precioEntradaReal * COMISION_TAKER;
                
                let resultadoOperacion = 'ABIERTA';
                for (let j = i + 1; j < Math.min(i + 16, velas15m.length); j++) {
                    const velaFutura = velas15m[j];
                    if (velaFutura.low <= stopLoss) {
                        resultadoOperacion = 'PERDIDA (SL)';
                        balanceActual -= (balanceActual * (RIESGO_MAXIMO_PORCENTAJE / 100));
                        operacionesPerdedoras++;
                        break;
                    } else if (velaFutura.high >= takeProfit) {
                        resultadoOperacion = 'GANADA (TP)';
                        const beneficioBruto = (balanceActual * (RIESGO_MAXIMO_PORCENTAJE / 100)) * 1.6;
                        balanceActual += (beneficioBruto * (1 - COMISION_TAKER)); 
                        operacionesGanadoras++;
                        break;
                    }
                }
                
                if (resultadoOperacion === 'ABIERTA') {
                     resultadoOperacion = 'CERRADA POR TIEMPO';
                     balanceActual -= (balanceActual * COMISION_TAKER); 
                }

                console.log(`[${velaCerrada.timestamp.toISOString().split('T')[0]}] 🟢 Señal LONG (Aprobada) | Resultado: ${resultadoOperacion} | Balance: $${balanceActual.toFixed(2)}`);
                i += 5; 
            }
        }

        console.log('\n===================================================');
        console.log('📊 REPORTE DE RENDIMIENTO (V2 - FILTRO MULTITEMPORAL):');
        console.log(`   🔸 Capital Inicial:   $${CAPITAL_INICIAL.toFixed(2)} USDT`);
        console.log(`   🔸 Capital Final:     $${balanceActual.toFixed(2)} USDT`);
        
        const retornoNeto = ((balanceActual - CAPITAL_INICIAL) / CAPITAL_INICIAL) * 100;
        const colorRetorno = retornoNeto > 0 ? '🟩' : '🟥';
        console.log(`   🔸 Retorno Neto:      ${colorRetorno} ${retornoNeto.toFixed(2)}%`);
        
        console.log(`   🔸 Operaciones Ejecutadas: ${operacionesTotales}`);
        console.log(`   🔸 Operaciones Bloqueadas: ${operacionesFiltradas} (Capital salvado)`);
        
        if (operacionesTotales > 0) {
            console.log(`   🔸 Win Rate:               ${((operacionesGanadoras / operacionesTotales) * 100).toFixed(1)}% (${operacionesGanadoras}G / ${operacionesPerdedoras}P)`);
        }
        console.log('===================================================\n');

    } catch (error) {
        console.error('❌ Error en el backtesting:', error);
    }
}

ejecutarBacktestOptimizado();