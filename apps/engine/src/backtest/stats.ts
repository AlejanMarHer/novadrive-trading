import type { BacktestResult, BacktestTrade } from './types';

export interface Stats {
    trades: number;
    wins: number;
    losses: number;
    winRate: number;
    avgR: number;
    sdR: number;
    /** Intervalo de confianza 95% (aprox. normal) de la expectativa en R. */
    ciLowR: number;
    ciHighR: number;
    /** Expectativa media por operación en % del balance. */
    expectancyPct: number;
    profitFactor: number;
    totalReturnPct: number;
    maxDrawdownPct: number;
    totalFeesPct: number;
    avgHoldHours: number;
    byExitReason: Record<string, number>;
    firstHalfAvgR: number;
    secondHalfAvgR: number;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function computeStats(result: BacktestResult): Stats {
    const t: BacktestTrade[] = result.trades;
    const rs = t.map(x => x.rNet);
    const n = rs.length;
    const avgR = mean(rs);
    const sdR = n > 1 ? Math.sqrt(rs.reduce((a, r) => a + (r - avgR) ** 2, 0) / (n - 1)) : 0;
    const half = 1.96 * (n > 1 ? sdR / Math.sqrt(n) : Infinity);

    const grossWin = t.filter(x => x.balanceReturn > 0).reduce((a, x) => a + x.balanceReturn, 0);
    const grossLoss = -t.filter(x => x.balanceReturn < 0).reduce((a, x) => a + x.balanceReturn, 0);

    let peak = result.initialCapital;
    let maxDd = 0;
    for (const x of t) {
        peak = Math.max(peak, x.balanceAfter);
        maxDd = Math.max(maxDd, (peak - x.balanceAfter) / peak);
    }

    const byExitReason: Record<string, number> = {};
    for (const x of t) byExitReason[x.exitReason] = (byExitReason[x.exitReason] ?? 0) + 1;

    const final = t.length ? t[t.length - 1].balanceAfter : result.initialCapital;
    const mid = Math.floor(n / 2);

    return {
        trades: n,
        wins: t.filter(x => x.rNet > 0).length,
        losses: t.filter(x => x.rNet <= 0).length,
        winRate: n ? t.filter(x => x.rNet > 0).length / n : 0,
        avgR,
        sdR,
        ciLowR: avgR - half,
        ciHighR: avgR + half,
        expectancyPct: mean(t.map(x => x.balanceReturn)) * 100,
        profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
        totalReturnPct: (final / result.initialCapital - 1) * 100,
        maxDrawdownPct: maxDd * 100,
        totalFeesPct: t.reduce((a, x) => a + x.feesFraction, 0) * 100,
        avgHoldHours: mean(t.map(x => (x.exitTime - x.entryTime) / 3_600_000)),
        byExitReason,
        firstHalfAvgR: mean(rs.slice(0, mid)),
        secondHalfAvgR: mean(rs.slice(mid)),
    };
}

export const MIN_TRADES_FOR_CONFIDENCE = 30;

export function formatReport(result: BacktestResult, s: Stats): string {
    const d = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const pct = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(2)}%`;
    const lines = [
        '===================================================',
        `📊 REPORTE: ${result.strategy}`,
        `   Periodo:               ${d(result.from)} → ${d(result.to)} (${Math.round((result.to - result.from) / 86_400_000)} días)`,
        `   Capital inicial/final: $${result.initialCapital.toFixed(2)} → $${(result.trades.at(-1)?.balanceAfter ?? result.initialCapital).toFixed(2)}`,
        `   Retorno total:         ${pct(s.totalReturnPct)}`,
        `   Máx. drawdown:         -${s.maxDrawdownPct.toFixed(2)}%`,
        `   Operaciones:           ${s.trades} (${s.wins}G / ${s.losses}P, win rate ${(s.winRate * 100).toFixed(1)}%)`,
        `   Expectativa neta:      ${s.avgR.toFixed(3)} R por operación  (${pct(s.expectancyPct)} del balance)`,
        `   IC 95% expectativa:    [${s.ciLowR.toFixed(3)} R, ${s.ciHighR.toFixed(3)} R]`,
        `   Profit factor:         ${Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞'}`,
        `   Comisiones totales:    ${s.totalFeesPct.toFixed(2)}% del balance (acumulado)`,
        `   Duración media:        ${s.avgHoldHours.toFixed(1)} h`,
        `   Salidas:               ${Object.entries(s.byExitReason).map(([k, v]) => `${k}=${v}`).join(', ') || '—'}`,
        `   Estabilidad (R medio): 1ª mitad ${s.firstHalfAvgR.toFixed(3)} | 2ª mitad ${s.secondHalfAvgR.toFixed(3)}`,
        `   Señales rechazadas:    ${result.rejected.length}`,
    ];
    if (s.trades < MIN_TRADES_FOR_CONFIDENCE) {
        lines.push(`   ⚠️  Menos de ${MIN_TRADES_FOR_CONFIDENCE} operaciones: el resultado NO es estadísticamente significativo.`);
    } else if (s.ciLowR <= 0 && s.ciHighR >= 0) {
        lines.push('   ⚠️  El IC 95% incluye 0: no se puede distinguir esta expectativa de cero.');
    } else if (s.ciLowR > 0) {
        lines.push('   ✅ El IC 95% está por encima de 0 (recuerda: rendimiento pasado ≠ futuro, y cuidado con el sobreajuste).');
    } else {
        lines.push('   🟥 El IC 95% está por debajo de 0: la estrategia pierde dinero con costes realistas.');
    }
    lines.push('===================================================');
    return lines.join('\n');
}
