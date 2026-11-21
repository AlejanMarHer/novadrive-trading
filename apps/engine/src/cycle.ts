import { fetchClosedKlines } from './binance';
import { DEFAULT_COSTS, DEFAULT_STRATEGY, STRATEGY_NAME, SYMBOL } from './config';
import { loadSignalState, loadStrategyConfig, logHealth, prisma, saveSignalState } from './db';
import { resolveSignal, signalPnlR, STATUS_BY_REASON } from './lifecycle';
import { entryMessage, exitMessage } from './messages';
import { decide, evaluate } from './strategy';
import { enviarTelegram } from './telegram';
import type { Direction } from './types';

/**
 * Un ciclo del motor:
 *  1. Descarga solo velas CERRADAS de 1h y 4h.
 *  2. Cierra las señales activas que tocaron SL/TP o cuya tendencia terminó (y avisa por Telegram).
 *  3. Decide si hay señal nueva (anti-spam con estado persistido en BD) y la guarda en `Signal`.
 *  4. Escribe el latido en `MarketRegimeRecord`.
 */
export async function runCycle(): Promise<void> {
    const p = DEFAULT_STRATEGY;

    let c1h, c4h;
    try {
        [c1h, c4h] = await Promise.all([
            fetchClosedKlines(SYMBOL, '1h', p.lookback1h),
            fetchClosedKlines(SYMBOL, '4h', p.lookback4h),
        ]);
    } catch (err) {
        await logHealth('BINANCE', 'ERROR', err instanceof Error ? err.message : String(err));
        throw err;
    }

    const ev = evaluate(c1h, c4h, p);
    if (!ev) throw new Error(`Historia insuficiente (${c1h.length} velas 1h, ${c4h.length} velas 4h)`);
    console.log(
        `🎯 Régimen: ${ev.regime} | precio ${ev.price.toFixed(2)} | ADX ${ev.adx.toFixed(1)} | ` +
        `vela 1h cerrada ${new Date(ev.candleCloseTime).toISOString()}`,
    );

    const config = await loadStrategyConfig();
    const costs = { ...DEFAULT_COSTS, riskPct: config.maxRiskPerTrade };

    // --- 2. Señales activas: ¿terminaron? ---
    const active = await prisma.signal.findMany({ where: { status: 'ACTIVE', strategy: STRATEGY_NAME, symbol: SYMBOL } });
    let activeDirection: Direction | null = null;
    for (const s of active) {
        const sig = {
            direction: s.direction as Direction,
            entryPrice: s.entryPrice,
            stopLoss: s.stopLoss,
            takeProfit: s.takeProfit2,
            generatedAt: s.generatedAt.getTime(),
        };
        const exit = resolveSignal(sig, c1h, ev);
        if (!exit) {
            activeDirection = sig.direction;
            continue;
        }
        const pnlR = signalPnlR(sig, exit, costs);
        await prisma.signal.update({
            where: { id: s.id },
            data: {
                status: STATUS_BY_REASON[exit.reason],
                closedAt: new Date(exit.time),
                exitPrice: exit.price,
                exitReason: exit.reason,
                pnlNet: pnlR,
            },
        });
        console.log(`🏁 Señal ${s.direction} cerrada por ${exit.reason} (${pnlR.toFixed(2)} R)`);
        const sent = await enviarTelegram(exitMessage(sig.direction, sig.entryPrice, exit, pnlR));
        if (!sent) await logHealth('TELEGRAM', 'ERROR', `No se entregó el aviso de cierre de la señal ${s.id}`);
    }

    // --- 3. ¿Señal nueva? ---
    const state = await loadSignalState();
    if (state.lastCandleCloseTime === ev.candleCloseTime) {
        console.log('⏳ Esta vela de 1h ya fue procesada; no hay decisión nueva.');
    } else {
        const d = decide(ev, state, { activeDirection, strategyActive: config.isActive }, p, costs);
        if (d.action === 'ENTER') {
            const signal = await prisma.signal.create({
                data: {
                    symbol: SYMBOL,
                    strategy: STRATEGY_NAME,
                    direction: d.direction,
                    entryPrice: d.plan.entry,
                    stopLoss: d.plan.stopLoss,
                    takeProfit1: d.plan.takeProfit,
                    takeProfit2: d.plan.takeProfit,
                    riskRewardNet: d.plan.rrNet,
                    atr: ev.atr,
                },
            });
            console.log(`🚀 SEÑAL NUEVA ${d.direction} guardada (${signal.id})`);
            const sent = await enviarTelegram(entryMessage(ev, d.plan));
            if (!sent) await logHealth('TELEGRAM', 'ERROR', `No se entregó la señal ${signal.id}`);
        } else if (d.action === 'REJECT') {
            console.log(`🚫 Señal ${d.direction} rechazada: ${d.reason}`);
            await prisma.rejectedSignal.create({
                data: { symbol: SYMBOL, strategy: STRATEGY_NAME, direction: d.direction, reason: d.reason, riskRewardNet: d.plan.rrNet },
            });
        } else {
            console.log('— Sin señal nueva.');
        }
        await saveSignalState(d.state);
    }

    // --- 4. Latido ---
    await prisma.marketRegimeRecord.create({
        data: { regime: ev.regime, adx1h: ev.adx, emaSlope4h: ev.emaSlope4h, price: ev.price },
    });
}
