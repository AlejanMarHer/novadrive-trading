import type { StrategyParams } from './config';
import type { Evaluation, SignalState } from './strategy';
import type { Direction } from './types';

const n0 = (x: number) => Math.round(x).toLocaleString('es-ES');

/** Condiciones de la estrategia que NO se cumplen para una dirección (lista legible). */
export function missingConditions(ev: Evaluation, direction: Direction, p: StrategyParams): string[] {
    const long = direction === 'LONG';
    const out: string[] = [];
    if (long ? !(ev.price > ev.emaTrend4h) : !(ev.price < ev.emaTrend4h)) {
        out.push(`precio ${long ? '>' : '<'} EMA${p.emaTrend4h} 4h (${n0(ev.price)} vs ${n0(ev.emaTrend4h)})`);
    }
    if (long ? !(ev.emaFast1h > ev.emaSlow1h) : !(ev.emaFast1h < ev.emaSlow1h)) {
        out.push(`EMA${p.emaFast1h} ${long ? '>' : '<'} EMA${p.emaSlow1h} en 1h (${n0(ev.emaFast1h)} vs ${n0(ev.emaSlow1h)})`);
    }
    if (!(ev.adx >= p.adxTrendMin)) out.push(`ADX ≥ ${p.adxTrendMin} (está en ${ev.adx.toFixed(1)})`);
    if (long ? !(ev.pdi > ev.mdi) : !(ev.mdi > ev.pdi)) {
        out.push(`${long ? '+DI > −DI' : '−DI > +DI'} (${ev.pdi.toFixed(1)} vs ${ev.mdi.toFixed(1)})`);
    }
    return out;
}

/**
 * Explica en una frase por qué el motor NO está emitiendo una señal nueva ahora mismo.
 * Se guarda en MarketRegimeRecord.note, se muestra en el dashboard y va en el informe diario.
 */
export function explainNoSignal(
    ev: Evaluation,
    state: SignalState,
    activeDirection: Direction | null,
    p: StrategyParams,
): string {
    if (activeDirection) {
        return `Hay una señal ${activeDirection} activa; el motor avisará cuando toque SL, TP o termine la tendencia.`;
    }
    if (ev.regime === 'TREND_BULL' || ev.regime === 'TREND_BEAR') {
        const dir: Direction = ev.regime === 'TREND_BULL' ? 'LONG' : 'SHORT';
        if (state.disarmed === dir) {
            return `Tendencia ${dir === 'LONG' ? 'alcista' : 'bajista'} en curso, pero su señal ya se emitió (o se rechazó). ` +
                `Se rearma cuando el ADX baje de ${p.adxRangeMax} o se rompa la tendencia.`;
        }
        return `Tendencia ${dir === 'LONG' ? 'alcista' : 'bajista'} detectada en esta vela.`;
    }
    if (ev.regime === 'RANGE_COMPRESSION') {
        return `Mercado en rango: ADX ${ev.adx.toFixed(1)} < ${p.adxRangeMax}. La estrategia solo opera tendencias.`;
    }
    const bull = missingConditions(ev, 'LONG', p);
    const bear = missingConditions(ev, 'SHORT', p);
    const [dir, missing] = bull.length <= bear.length ? (['LONG', bull] as const) : (['SHORT', bear] as const);
    return `Transición sin tendencia clara. Para ${dir} falta: ${missing.join('; ')}.`;
}
