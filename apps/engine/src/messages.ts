import type { SignalExit } from './lifecycle';
import type { Evaluation, TradePlan } from './strategy';
import type { Direction } from './types';

const usd = (x: number) => `$${x.toFixed(2)}`;
const TESTNET_LINK = '👉 <a href="https://testnet.binancefuture.com/en/futures/BTCUSDT">Abrir Binance Testnet</a>';

export function entryMessage(ev: Evaluation, plan: TradePlan): string {
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
