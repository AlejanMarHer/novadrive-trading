/**
 * Estrategia de RÉGIMEN DE TENDENCIA (la que corre en vivo).
 *
 * Este módulo es compartido por el motor en vivo (index.ts) y por el
 * backtester, para que lo que se prueba sea exactamente lo que se opera.
 *
 * Reglas (evaluadas solo con velas CERRADAS):
 *   TREND_BULL : cierre 1h > EMA50 4h, EMA21 1h > EMA55 1h, +DI > -DI y ADX >= 22
 *   TREND_BEAR : cierre 1h < EMA50 4h, EMA21 1h < EMA55 1h, -DI > +DI y ADX >= 22
 *   Histéresis : una tendencia ya activa se mantiene mientras se cumplan sus
 *                condiciones y el ADX siga >= 20 (evita alertas repetidas cuando
 *                el ADX oscila alrededor de 22).
 *   RANGE_COMPRESSION : ADX < 20
 *   TRANSITION_CHOP   : cualquier otro caso
 *
 * Señal: se emite al ENTRAR en TREND_BULL / TREND_BEAR.
 *   Stop Loss  = entrada ∓ 1.5 × ATR(14, 1h)
 *   TP1        = 1R (referencia para tomar parciales / mover a breakeven)
 *   TP2        = 2R (objetivo de la operación; equivale al TP original)
 *   Salida     = Stop, TP2, o fin del régimen de tendencia (cierre a mercado).
 */

import { adx, atr, ema } from './indicadores';
import type { Vela } from './binance';

export type Regimen = 'TREND_BULL' | 'TREND_BEAR' | 'RANGE_COMPRESSION' | 'TRANSITION_CHOP';
export type Direccion = 'LONG' | 'SHORT';

export const NOMBRE_ESTRATEGIA = 'regime-trend-v3';

export const CONFIG = {
    adxEntrada: 22,
    adxSalida: 20,
    adxRango: 20,
    multiplicadorATR: 1.5,
    ratioTP1: 1,
    ratioTP2: 2,
    /** Comisión taker de Binance Futures USDⓈ-M (0.05 %) por lado. */
    comision: 0.0005,
    /** Slippage supuesto por lado en órdenes a mercado (puntos básicos). */
    slippageBps: 2,
    /** Velas mínimas para que los indicadores estén estables. */
    minimoVelas1h: 120,
    minimoVelas4h: 60,
};

export interface ValoresMercado {
    tiempo: number;        // closeTime de la vela 1h evaluada
    cierre1h: number;
    ema21_1h: number;
    ema55_1h: number;
    ema50_4h: number;
    pendienteEma4h: number; // % de cambio de la EMA50 4h en las últimas 5 velas 4h
    adx: number;
    pdi: number;
    mdi: number;
    atr: number;
}

export function esTendencia(r: Regimen | string | null | undefined): r is 'TREND_BULL' | 'TREND_BEAR' {
    return r === 'TREND_BULL' || r === 'TREND_BEAR';
}

export function direccionDeRegimen(r: Regimen): Direccion | null {
    if (r === 'TREND_BULL') return 'LONG';
    if (r === 'TREND_BEAR') return 'SHORT';
    return null;
}

/** Clasifica el régimen de una vela dado el régimen anterior (histéresis). */
export function clasificarRegimen(v: ValoresMercado, previo: string | null): Regimen {
    const condicionesAlcistas = v.cierre1h > v.ema50_4h && v.ema21_1h > v.ema55_1h && v.pdi > v.mdi;
    const condicionesBajistas = v.cierre1h < v.ema50_4h && v.ema21_1h < v.ema55_1h && v.mdi > v.pdi;

    if (condicionesAlcistas && (v.adx >= CONFIG.adxEntrada || (previo === 'TREND_BULL' && v.adx >= CONFIG.adxSalida))) {
        return 'TREND_BULL';
    }
    if (condicionesBajistas && (v.adx >= CONFIG.adxEntrada || (previo === 'TREND_BEAR' && v.adx >= CONFIG.adxSalida))) {
        return 'TREND_BEAR';
    }
    if (v.adx < CONFIG.adxRango) return 'RANGE_COMPRESSION';
    return 'TRANSITION_CHOP';
}

/**
 * Para cada vela de 1h devuelve el índice de la última vela de 4h que ya estaba
 * CERRADA en el momento del cierre de esa vela de 1h (-1 si no hay ninguna).
 * Es la pieza que evita el look-ahead bias entre temporalidades.
 */
export function alinearTemporalidades(velasMenor: Vela[], velasMayor: Vela[]): number[] {
    const indices: number[] = [];
    let j = -1;
    for (const vela of velasMenor) {
        while (j + 1 < velasMayor.length && velasMayor[j + 1].closeTime <= vela.closeTime) j++;
        indices.push(j);
    }
    return indices;
}

/**
 * Calcula los valores de mercado para cada vela de 1h (solo velas cerradas).
 * Las posiciones sin datos suficientes quedan como `null`.
 */
export function calcularValores(velas1h: Vela[], velas4h: Vela[]): (ValoresMercado | null)[] {
    const cierres1h = velas1h.map(v => v.close);
    const ema21 = ema(cierres1h, 21);
    const ema55 = ema(cierres1h, 55);
    const serieADX = adx(velas1h, 14);
    const serieATR = atr(velas1h, 14);
    const ema50_4h = ema(velas4h.map(v => v.close), 50);
    const indice4h = alinearTemporalidades(velas1h, velas4h);

    return velas1h.map((vela, i) => {
        const j = indice4h[i];
        if (j < 5) return null;
        const valores: ValoresMercado = {
            tiempo: vela.closeTime,
            cierre1h: vela.close,
            ema21_1h: ema21[i],
            ema55_1h: ema55[i],
            ema50_4h: ema50_4h[j],
            pendienteEma4h: ((ema50_4h[j] - ema50_4h[j - 5]) / ema50_4h[j - 5]) * 100,
            adx: serieADX[i].adx,
            pdi: serieADX[i].pdi,
            mdi: serieADX[i].mdi,
            atr: serieATR[i],
        };
        const algunoInvalido = Object.values(valores).some(x => typeof x !== 'number' || !Number.isFinite(x));
        return algunoInvalido ? null : valores;
    });
}

export interface NivelesSenal {
    direccion: Direccion;
    entrada: number;
    stopLoss: number;
    takeProfit1: number;
    takeProfit2: number;
    riesgoPorUnidad: number;
    /** R:R a TP2 descontando comisiones de entrada y salida. */
    riskRewardNet: number;
}

export function calcularNiveles(direccion: Direccion, entrada: number, valorATR: number): NivelesSenal {
    const riesgo = valorATR * CONFIG.multiplicadorATR;
    const signo = direccion === 'LONG' ? 1 : -1;
    const stopLoss = entrada - signo * riesgo;
    const takeProfit1 = entrada + signo * riesgo * CONFIG.ratioTP1;
    const takeProfit2 = entrada + signo * riesgo * CONFIG.ratioTP2;
    const comisiones = (entrada + takeProfit2) * CONFIG.comision;
    const comisionesStop = (entrada + stopLoss) * CONFIG.comision;
    const riskRewardNet = (riesgo * CONFIG.ratioTP2 - comisiones) / (riesgo + comisionesStop);
    return { direccion, entrada, stopLoss, takeProfit1, takeProfit2, riesgoPorUnidad: riesgo, riskRewardNet };
}

/** Resultado neto en múltiplos de R (riesgo inicial), descontando comisiones. */
export function resultadoEnR(direccion: Direccion, entrada: number, salida: number, riesgoPorUnidad: number): number {
    const signo = direccion === 'LONG' ? 1 : -1;
    const bruto = signo * (salida - entrada);
    const comisiones = (entrada + salida) * CONFIG.comision;
    return (bruto - comisiones) / riesgoPorUnidad;
}

export type MotivoCierre = 'STOP_LOSS' | 'TAKE_PROFIT' | 'FIN_DE_REGIMEN';

/**
 * Revisa si alguna vela (posterior a la entrada) tocó el stop o el TP2.
 * Si una misma vela toca ambos, se asume el STOP (supuesto conservador).
 */
export function buscarSalida(
    niveles: Pick<NivelesSenal, 'direccion' | 'stopLoss' | 'takeProfit2'>,
    velas: Pick<Vela, 'high' | 'low'>[],
): { indice: number; precio: number; motivo: MotivoCierre } | null {
    for (let i = 0; i < velas.length; i++) {
        const v = velas[i];
        const tocaStop = niveles.direccion === 'LONG' ? v.low <= niveles.stopLoss : v.high >= niveles.stopLoss;
        const tocaTP = niveles.direccion === 'LONG' ? v.high >= niveles.takeProfit2 : v.low <= niveles.takeProfit2;
        if (tocaStop) return { indice: i, precio: niveles.stopLoss, motivo: 'STOP_LOSS' };
        if (tocaTP) return { indice: i, precio: niveles.takeProfit2, motivo: 'TAKE_PROFIT' };
    }
    return null;
}
