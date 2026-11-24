import type { SignalExit } from './lifecycle';
import type { Evaluation, TradePlan } from './strategy';
import type { Direction } from './types';

const usd = (x: number) => `$${x.toFixed(2)}`;
const TESTNET_LINK = '👉 <a href="https://testnet.binancefuture.com/en/futures/BTCUSDT">Abrir Binance Testnet</a>';

export function entryMessage(ev: Evaluation, plan: TradePlan, btLine = ''): string {
    const long = plan.direction === 'LONG';
    return [
        `${long ? '🟢' : '🔴'} <b>NUEVA SEÑAL: ${long ? 'LONG (COMPRA)' : 'SHORT (VENTA)'}</b>`,
        '',
        `🎯 <b>Régimen:</b> ${ev.regime}`,
        `📊 <b>ADX 1H:</b> ${ev.adx.toFixed(2)}`,
        `💰 <b>Precio de referencia:</b> ${usd(plan.entry)} (cierre 1h)`,
        '',
        '🛡️ <b>Gestión de riesgo:</b>',
        `🛑 <b>Stop Loss:</b> ${usd(plan.stopLoss)}`,
        `🎯 <b>Take Profit:</b> ${usd(plan.takeProfit)}`,
        `⚖️ <b>R:R neto:</b> ${plan.rrNet.toFixed(2)} (costes ≈ ${plan.costR.toFixed(2)} R)`,
        `📐 <b>Tamaño sugerido:</b> ${plan.leverage.toFixed(2)}× tu capital (riesgo ${plan.effectiveRiskPct.toFixed(2)}%)`,
        '',
        'ℹ️ Recibirás un aviso cuando la señal se cierre (SL, TP o fin de tendencia).',
        ...(btLine ? [btLine] : []),
        TESTNET_LINK,
    ].join('\n');
}

export function exitMessage(direction: Direction, entryPrice: number, exit: SignalExit, pnlR: number): string {
    const pnl = `${pnlR >= 0 ? '+' : ''}${pnlR.toFixed(2)} R`;
    const header =
        exit.reason === 'EXIT_SIGNAL'
            ? `⚠️ <b>SALIDA: CERRAR ${direction} A MERCADO</b>\nLa tendencia terminó (estructura rota).`
            : exit.reason === 'TP'
                ? `✅ <b>${direction} CERRADO EN TAKE PROFIT</b>`
                : `🛑 <b>${direction} CERRADO EN STOP LOSS</b>`;
    return [
        header,
        '',
        `💰 <b>Entrada:</b> ${usd(entryPrice)}`,
        `🏁 <b>Salida${exit.reason === 'EXIT_SIGNAL' ? ' (ref.)' : ''}:</b> ${usd(exit.price)}`,
        `📈 <b>Resultado neto estimado:</b> ${pnl}`,
        '',
        TESTNET_LINK,
    ].join('\n');
}

const fechaHora = (d: Date) =>
    d.toLocaleString('es-ES', { timeZone: 'UTC', dateStyle: 'short', timeStyle: 'short' }) + ' UTC';

const REGIME_ICON: Record<string, string> = {
    TREND_BULL: '🟢',
    TREND_BEAR: '🔴',
    RANGE_COMPRESSION: '🟡',
    TRANSITION_CHOP: '🟠',
};

export interface BacktestSummary {
    avgR: number;
    ciLowR: number;
    ciHighR: number;
    profitFactor: number | null;
    totalReturnPct: number;
    trades: number;
    periodStart: Date;
    periodEnd: Date;
}

/** Línea de aviso según el último backtest guardado. Vacía si no hay backtest. */
export function backtestLine(bt: BacktestSummary | null): string {
    if (!bt) return '';
    const days = Math.round((bt.periodEnd.getTime() - bt.periodStart.getTime()) / 86_400_000);
    const base = `🧪 <b>Backtest ${days} días:</b> ${bt.avgR >= 0 ? '+' : ''}${bt.avgR.toFixed(2)} R/op, ` +
        `${bt.totalReturnPct >= 0 ? '+' : ''}${bt.totalReturnPct.toFixed(1)}% en ${bt.trades} ops`;
    if (bt.ciLowR > 0) return base;
    return `${base}\n⚠️ <b>Sin ventaja estadística demostrada: úsala solo en Testnet.</b>`;
}

export function dailyReportMessage(d: {
    ev: Evaluation;
    note: string;
    active: { direction: string; entryPrice: number; stopLoss: number; takeProfit2: number } | null;
    signals7d: number;
    closed7d: { count: number; sumR: number };
    backtest: BacktestSummary | null;
    now: Date;
}): string {
    const lines = [
        `📋 <b>Informe diario NovaDrive</b> · ${fechaHora(d.now)}`,
        '',
        `${REGIME_ICON[d.ev.regime] ?? '⚪'} <b>Régimen:</b> ${d.ev.regime}`,
        `💰 <b>BTC:</b> ${usd(d.ev.price)} · <b>ADX 1H:</b> ${d.ev.adx.toFixed(1)}`,
        `❔ <b>Señal:</b> ${escapeHtml(d.note)}`,
        d.active
            ? `📌 <b>Activa:</b> ${d.active.direction} desde ${usd(d.active.entryPrice)} (SL ${usd(d.active.stopLoss)} · TP ${usd(d.active.takeProfit2)})`
            : '📌 <b>Activa:</b> ninguna',
        `📈 <b>Últimos 7 días:</b> ${d.signals7d} señales; ${d.closed7d.count} cerradas (${d.closed7d.sumR >= 0 ? '+' : ''}${d.closed7d.sumR.toFixed(2)} R)`,
    ];
    const bt = backtestLine(d.backtest);
    if (bt) lines.push(bt);
    lines.push('', '✅ El motor está funcionando. Si un día no recibes este informe, el motor está caído.');
    return lines.join('\n');
}

export function downtimeMessage(lastAt: Date, now: Date): string {
    const h = (now.getTime() - lastAt.getTime()) / 3_600_000;
    return [
        '⚠️ <b>El motor estuvo sin funcionar</b>',
        `Último ciclo anterior: ${fechaHora(lastAt)} (${h >= 48 ? `${(h / 24).toFixed(1)} días` : `${h.toFixed(1)} h`} sin datos).`,
        'Durante ese tiempo no se generaron señales. Ya está funcionando otra vez.',
    ].join('\n');
}

export function failureMessage(streak: number, error: string): string {
    return `❌ <b>El motor está fallando</b> (${streak} ciclos seguidos)\n<code>${escapeHtml(error.slice(0, 400))}</code>\nMientras falle no habrá señales.`;
}

export function recoveryMessage(streak: number): string {
    return `✅ <b>Motor recuperado</b> tras ${streak} ciclos con error.`;
}

export function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
