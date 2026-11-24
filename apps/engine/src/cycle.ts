import { fetchClosedKlines } from './binance';
import {
    DAILY_REPORT_HOUR_UTC,
    DEFAULT_COSTS,
    DEFAULT_STRATEGY,
    DOWNTIME_ALERT_MINUTES,
    STRATEGY_NAME,
    SYMBOL,
} from './config';
import {
    getState,
    lastHeartbeatAt,
    latestBacktest,
    loadSignalState,
    loadStrategyConfig,
    logHealth,
    prisma,
    saveSignalState,
    setState,
} from './db';
import { explainNoSignal } from './explain';
import { instanceLabel } from './instance';
import { resolveSignal, signalPnlR, STATUS_BY_REASON } from './lifecycle';
import { backtestLine, dailyReportMessage, downtimeMessage, entryMessage, exitMessage } from './messages';
import { dailyReportDue, wasDown } from './monitor';
import { decide, evaluate, type SignalState } from './strategy';
import { enviarTelegramRegistrando } from './telegram';
import type { Direction } from './types';

const DAILY_KEY = `dailyReport:${STRATEGY_NAME}`;

/**
 * Un ciclo del motor:
 *  1. Descarga solo velas CERRADAS de 1h y 4h.
 *  2. Cierra las señales activas que tocaron SL/TP o cuya tendencia terminó (y avisa por Telegram).
 *  3. Decide si hay señal nueva (anti-spam con estado persistido en BD) y la guarda en `Signal`.
 *  4. Escribe el latido en `MarketRegimeRecord` con la explicación de por qué hay o no señal.
 *  5. Avisa si el motor estuvo caído y envía el informe diario.
 */
export async function runCycle(now = new Date()): Promise<void> {
    const p = DEFAULT_STRATEGY;

    let c1h, c4h;
    try {
        [c1h, c4h] = await Promise.all([
            fetchClosedKlines(SYMBOL, '1h', p.lookback1h),
            fetchClosedKlines(SYMBOL, '4h', p.lookback4h),
        ]);
    } catch (err) {
        await logHealth('BINANCE', 'ERROR', `[${instanceLabel()}] ${err instanceof Error ? err.message : String(err)}`);
        throw err;
    }

    const ev = evaluate(c1h, c4h, p);
    if (!ev) throw new Error(`Historia insuficiente (${c1h.length} velas 1h, ${c4h.length} velas 4h)`);
    console.log(
        `🎯 Régimen: ${ev.regime} | precio ${ev.price.toFixed(2)} | ADX ${ev.adx.toFixed(1)} | ` +
        `vela 1h cerrada ${new Date(ev.candleCloseTime).toISOString()}`,
    );

    // --- ¿Estuvo caído el motor? (antes de escribir el latido nuevo) ---
    const previousBeat = await lastHeartbeatAt();
    if (wasDown(previousBeat, now, DOWNTIME_ALERT_MINUTES)) {
        console.warn(`⚠️ Hueco desde el último latido (${previousBeat!.toISOString()}): avisando por Telegram.`);
        await logHealth('ENGINE', 'ERROR', `Sin ciclos desde ${previousBeat!.toISOString()}`);
        await enviarTelegramRegistrando(downtimeMessage(previousBeat!, now), 'Aviso de motor caído');
    }

    const config = await loadStrategyConfig();
    const costs = { ...DEFAULT_COSTS, riskPct: config.maxRiskPerTrade };
    const bt = await latestBacktest(STRATEGY_NAME);

    // --- 2. Señales activas: ¿terminaron? ---
    const active = await prisma.signal.findMany({ where: { status: 'ACTIVE', strategy: STRATEGY_NAME, symbol: SYMBOL } });
    let activeDirection: Direction | null = null;
    let stillActive: (typeof active)[number] | null = null;
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
            stillActive = s;
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
        await enviarTelegramRegistrando(exitMessage(sig.direction, sig.entryPrice, exit, pnlR), `Aviso de cierre de la señal ${s.id}`);
    }

    // --- 3. ¿Señal nueva? ---
    let state: SignalState = await loadSignalState();
    let note: string;
    if (state.lastCandleCloseTime === ev.candleCloseTime) {
        console.log('⏳ Esta vela de 1h ya fue procesada; no hay decisión nueva.');
        note = explainNoSignal(ev, state, activeDirection, p);
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
                    generatedAt: now,
                },
            });
            console.log(`🚀 SEÑAL NUEVA ${d.direction} guardada (${signal.id})`);
            note = `Señal ${d.direction} emitida a ${d.plan.entry.toFixed(2)}.`;
            await enviarTelegramRegistrando(entryMessage(ev, d.plan, backtestLine(bt)), `Señal ${signal.id}`);
        } else if (d.action === 'REJECT') {
            console.log(`🚫 Señal ${d.direction} rechazada: ${d.reason}`);
            note = `Señal ${d.direction} rechazada: ${d.reason}.`;
            await prisma.rejectedSignal.create({
                data: { symbol: SYMBOL, strategy: STRATEGY_NAME, direction: d.direction, reason: d.reason, riskRewardNet: d.plan.rrNet, rejectedAt: now },
            });
        } else {
            note = explainNoSignal(ev, d.state, activeDirection, p);
            console.log(`— Sin señal nueva: ${note}`);
        }
        state = d.state;
        await saveSignalState(state);
    }

    // --- 4. Latido ---
    await prisma.marketRegimeRecord.create({
        data: { timestamp: now, regime: ev.regime, adx1h: ev.adx, emaSlope4h: ev.emaSlope4h, price: ev.price, note },
    });

    // --- 5. Informe diario ---
    const last = await getState<{ date: string }>(DAILY_KEY);
    const due = dailyReportDue(now, last?.date ?? null, DAILY_REPORT_HOUR_UTC);
    if (due) {
        const since = new Date(now.getTime() - 7 * 86_400_000);
        const [signals7d, closed] = await Promise.all([
            prisma.signal.count({ where: { strategy: STRATEGY_NAME, generatedAt: { gte: since } } }),
            prisma.signal.findMany({
                where: { strategy: STRATEGY_NAME, closedAt: { gte: since }, pnlNet: { not: null } },
                select: { pnlNet: true },
            }),
        ]);
        const sent = await enviarTelegramRegistrando(dailyReportMessage({
            ev,
            note: stillActive ? explainNoSignal(ev, state, activeDirection, p) : note,
            active: stillActive,
            signals7d,
            closed7d: { count: closed.length, sumR: closed.reduce((a, s) => a + (s.pnlNet ?? 0), 0) },
            backtest: bt,
            now,
        }), 'Informe diario');
        if (sent) await setState(DAILY_KEY, { date: due });
    }
}
