/**
 * Backtester.
 *
 *   npm run backtest --workspace=apps/engine                       # estrategia en vivo, 730 días
 *   npm run backtest --workspace=apps/engine -- --days=1095        # más historial
 *   npm run backtest --workspace=apps/engine -- --strategy=sweep   # estrategia antigua de barrido (15m)
 *   npm run backtest --workspace=apps/engine -- --json=resultado.json --no-cache
 *   npm run backtest --workspace=apps/engine -- --save     # guarda el resumen en BacktestRun (lo muestran dashboard y Telegram)
 */
import fs from 'fs';
import { DEFAULT_COSTS, DEFAULT_STRATEGY, STRATEGY_NAME, SYMBOL } from './src/config';
import { fetchHistory } from './src/backtest/data';
import { computeStats, formatReport } from './src/backtest/stats';
import { runSweepBacktest } from './src/backtest/sweep';
import { runTrendBacktest } from './src/backtest/trend';

function arg(name: string): string | undefined {
    const hit = process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`));
    if (!hit) return undefined;
    return hit.includes('=') ? hit.split('=').slice(1).join('=') : 'true';
}

async function main() {
    const strategy = arg('strategy') ?? 'trend';
    const days = Number(arg('days') ?? 730);
    const useCache = arg('no-cache') === undefined;
    const end = Date.now();
    const start = end - days * 86_400_000;

    console.log('===================================================');
    console.log(`🔬 BACKTEST ${SYMBOL} | estrategia=${strategy} | ${days} días`);
    console.log(`   Costes: comisión ${(DEFAULT_COSTS.takerFee * 100).toFixed(3)}% por lado sobre el nocional, ` +
        `slippage ${DEFAULT_COSTS.slippageBps} bps (stops ${DEFAULT_COSTS.stopSlippageBps} bps), ` +
        `riesgo ${DEFAULT_COSTS.riskPct}%/op, apalancamiento máx. ${DEFAULT_COSTS.maxLeverage}×`);
    console.log('===================================================');

    let result;
    if (strategy === 'trend') {
        // Margen extra al inicio para calentar los indicadores (lookback de 4h = 200 velas ≈ 34 días).
        const warmup = DEFAULT_STRATEGY.lookback4h * 4 * 3_600_000;
        console.log('📥 Descargando historial (1h y 4h)...');
        const c1h = await fetchHistory(SYMBOL, '1h', start - warmup, end, { useCache });
        const c4h = await fetchHistory(SYMBOL, '4h', start - warmup, end, { useCache });
        console.log(`✅ ${c1h.length} velas de 1h y ${c4h.length} velas de 4h`);
        // Arrancamos la simulación en `start`: recortamos el exceso de velas de 1h previas al calentamiento necesario.
        const firstIdx = Math.max(0, c1h.findIndex(c => c.closeTime >= start) - DEFAULT_STRATEGY.lookback1h + 1);
        result = runTrendBacktest(c1h.slice(firstIdx), c4h, DEFAULT_STRATEGY, DEFAULT_COSTS);
    } else if (strategy === 'sweep') {
        console.log('📥 Descargando historial (15m y 1h)...');
        const c15 = await fetchHistory(SYMBOL, '15m', start, end, { useCache });
        const c1h = await fetchHistory(SYMBOL, '1h', start - 10 * 86_400_000, end, { useCache });
        console.log(`✅ ${c15.length} velas de 15m y ${c1h.length} velas de 1h`);
        result = runSweepBacktest(c15, c1h, DEFAULT_COSTS);
    } else {
        throw new Error(`Estrategia desconocida: ${strategy} (usa trend o sweep)`);
    }

    const stats = computeStats(result);
    console.log(formatReport(result, stats));

    const jsonPath = arg('json');
    if (jsonPath && jsonPath !== 'true') {
        fs.writeFileSync(jsonPath, JSON.stringify({ stats, result }, null, 2));
        console.log(`💾 Resultado guardado en ${jsonPath}`);
    }

    if (arg('save') !== undefined) {
        if (strategy !== 'trend') throw new Error('--save solo aplica a la estrategia en vivo (trend)');
        const { prisma } = await import('./src/db');
        const run = await prisma.backtestRun.create({
            data: {
                strategy: STRATEGY_NAME,
                symbol: SYMBOL,
                periodStart: new Date(result.from),
                periodEnd: new Date(result.to),
                trades: stats.trades,
                winRate: stats.winRate,
                avgR: stats.avgR,
                ciLowR: stats.ciLowR,
                ciHighR: stats.ciHighR,
                expectancyPct: stats.expectancyPct,
                totalReturnPct: stats.totalReturnPct,
                maxDrawdownPct: stats.maxDrawdownPct,
                profitFactor: Number.isFinite(stats.profitFactor) ? stats.profitFactor : null,
                totalFeesPct: stats.totalFeesPct,
                params: { strategy: DEFAULT_STRATEGY, costs: DEFAULT_COSTS, days } as object,
            },
        });
        console.log(`💾 Backtest guardado en BacktestRun (${run.id})`);
        await prisma.$disconnect();
    }
}

main().catch(err => {
    console.error('❌ Error en el backtest:', err instanceof Error ? err.message : err);
    process.exit(1);
});
