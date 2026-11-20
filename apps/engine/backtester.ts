/**
 * Backtester de NovaDrive.
 *
 * Uso:
 *   npm run backtest                                  # estrategia en vivo, 365 días
 *   npm run backtest -- --dias=730                    # más historia
 *   npm run backtest -- --estrategia=barrido --dias=180   # estrategia V2 (barrido 15m)
 *
 * La estrategia "tendencia" usa EXACTAMENTE el mismo código que el motor en vivo
 * (lib/estrategia.ts). Supuestos de la simulación: ver lib/simulador.ts.
 */

import { descargarHistorial } from './lib/binance';
import {
    calcularMetricas,
    PARAMETROS_POR_DEFECTO,
    simularBarrido,
    simularTendencia,
    type ResultadoSimulacion,
} from './lib/simulador';

const DIA_MS = 24 * 60 * 60 * 1000;
const MUESTRA_MINIMA = 30;

function leerArgumento(nombre: string, porDefecto: string): string {
    const encontrado = process.argv.find(a => a.startsWith(`--${nombre}=`));
    return encontrado ? encontrado.split('=')[1] : porDefecto;
}

const fecha = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function main() {
    const estrategia = leerArgumento('estrategia', 'tendencia');
    const dias = Number(leerArgumento('dias', '365'));
    const detalle = process.argv.includes('--detalle');
    if (!['tendencia', 'barrido'].includes(estrategia) || !Number.isFinite(dias) || dias <= 0) {
        throw new Error('Uso: --estrategia=tendencia|barrido --dias=N [--detalle]');
    }

    const hasta = Date.now();
    // Margen extra para que los indicadores (EMA50 en 4h ≈ 9 días) estén estables.
    const desde = hasta - (dias + 30) * DIA_MS;
    const inicioEvaluacion = hasta - dias * DIA_MS;

    console.log('===================================================');
    console.log(`🔬 BACKTEST "${estrategia}" — últimos ${dias} días`);
    console.log('===================================================');

    let resultado: ResultadoSimulacion;
    let precioInicial: number;
    let precioFinal: number;

    if (estrategia === 'tendencia') {
        console.log('📥 Descargando velas de 1h y 4h...');
        const [velas1h, velas4h] = await Promise.all([
            descargarHistorial('1h', desde, hasta),
            descargarHistorial('4h', desde, hasta),
        ]);
        console.log(`✅ ${velas1h.length} velas 1h y ${velas4h.length} velas 4h.`);
        resultado = simularTendencia(velas1h, velas4h);
        const evaluadas = velas1h.filter(v => v.openTime >= inicioEvaluacion);
        precioInicial = evaluadas[0].open;
        precioFinal = evaluadas[evaluadas.length - 1].close;
    } else {
        console.log('📥 Descargando velas de 15m y 1h...');
        const [velas15m, velas1h] = await Promise.all([
            descargarHistorial('15m', desde, hasta),
            descargarHistorial('1h', desde, hasta),
        ]);
        console.log(`✅ ${velas15m.length} velas 15m y ${velas1h.length} velas 1h.`);
        resultado = simularBarrido(velas15m, velas1h);
        const evaluadas = velas15m.filter(v => v.openTime >= inicioEvaluacion);
        precioInicial = evaluadas[0].open;
        precioFinal = evaluadas[evaluadas.length - 1].close;
    }

    // Solo cuentan las operaciones dentro del periodo pedido (el margen inicial es calentamiento).
    const capitalInicial = PARAMETROS_POR_DEFECTO.capitalInicial;
    const operaciones = resultado.operaciones.filter(o => o.tiempoEntrada >= inicioEvaluacion);
    let capital = capitalInicial;
    const recalculadas = operaciones.map(o => {
        const factor = capital / (o.capitalDespues - o.pnlUsd);
        const pnlUsd = o.pnlUsd * factor;
        capital += pnlUsd;
        return { ...o, pnlUsd, comisionesUsd: o.comisionesUsd * factor, capitalDespues: capital };
    });
    const periodo: ResultadoSimulacion = { ...resultado, operaciones: recalculadas, capitalFinal: capital };
    const m = calcularMetricas(periodo, capitalInicial);

    if (detalle) {
        console.log('\n📜 Operaciones:');
        for (const o of recalculadas) {
            console.log(`  ${fecha(o.tiempoEntrada)} → ${fecha(o.tiempoSalida)} | ${o.direccion.padEnd(5)} | ${o.motivo.padEnd(14)} | ${o.pnlR >= 0 ? '+' : ''}${o.pnlR.toFixed(2)}R | ${usd(o.capitalDespues)}`);
        }
    }

    const retornoBH = ((precioFinal - precioInicial) / precioInicial) * 100;
    console.log('\n📊 RESULTADOS (después de comisiones y slippage)');
    console.log(`   Capital inicial:      ${usd(capitalInicial)}`);
    console.log(`   Capital final:        ${usd(capital)}`);
    console.log(`   Retorno:              ${m.retornoPct >= 0 ? '🟩' : '🟥'} ${m.retornoPct.toFixed(2)}%   (comprar y mantener BTC: ${retornoBH.toFixed(2)}%)`);
    console.log(`   Operaciones:          ${m.operaciones}${estrategia === 'barrido' ? `  (bloqueadas por ADX: ${resultado.senalesFiltradas})` : ''}`);
    console.log(`   Win rate:             ${m.winRate.toFixed(1)}%`);
    console.log(`   Expectativa:          ${m.rPromedio >= 0 ? '+' : ''}${m.rPromedio.toFixed(3)}R por operación`);
    console.log(`   Profit factor:        ${Number.isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : '∞'}`);
    console.log(`   Máximo drawdown:      ${m.maxDrawdownPct.toFixed(2)}%`);
    console.log(`   Comisiones pagadas:   ${usd(m.comisionesUsd)}`);
    console.log(`   Salidas por motivo:   ${Object.entries(m.porMotivo).map(([k, v]) => `${k}=${v}`).join(', ') || '—'}`);
    console.log(`   Supuestos: riesgo ${PARAMETROS_POR_DEFECTO.riesgoPct}%/operación, comisión ${(PARAMETROS_POR_DEFECTO.comision * 100).toFixed(3)}% por lado, slippage ${PARAMETROS_POR_DEFECTO.slippageBps} bps, apalancamiento máx. ${PARAMETROS_POR_DEFECTO.apalancamientoMax}x`);

    if (m.operaciones < MUESTRA_MINIMA) {
        console.log(`\n⚠️  Solo ${m.operaciones} operaciones: la muestra es demasiado pequeña para sacar conclusiones. Prueba con más --dias.`);
    }
    console.log('===================================================\n');
}

main().catch(error => {
    console.error('❌ Error en el backtest:', error);
    process.exitCode = 1;
});
