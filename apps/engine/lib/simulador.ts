/**
 * Simulador de operaciones para el backtester.
 *
 * Supuestos (conservadores y explícitos):
 *  - La señal se evalúa al CIERRE de una vela y se entra en la APERTURA de la
 *    siguiente, con slippage en contra.
 *  - Comisión taker en la entrada y en la salida, sobre el VALOR NOMINAL de la
 *    posición (no sobre la ganancia).
 *  - Stop y salidas a mercado con slippage en contra; el TP se llena exacto.
 *  - Si una vela toca stop y TP a la vez, se asume el stop.
 *  - Tamaño de posición: arriesga `riesgoPct` del capital, limitado por un
 *    apalancamiento máximo.
 */

import { adx, atr } from './indicadores';
import type { Vela } from './binance';
import {
    alinearTemporalidades,
    buscarSalida,
    calcularNiveles,
    calcularValores,
    clasificarRegimen,
    CONFIG,
    direccionDeRegimen,
    resultadoEnR,
    type Direccion,
    type Regimen,
} from './estrategia';

export interface ParametrosSimulacion {
    capitalInicial: number;
    riesgoPct: number;          // % del capital arriesgado por operación
    apalancamientoMax: number;  // tope del valor nominal / capital
    comision: number;           // por lado, fracción
    slippageBps: number;        // por lado, puntos básicos
}

export const PARAMETROS_POR_DEFECTO: ParametrosSimulacion = {
    capitalInicial: 10_000,
    riesgoPct: 0.75,
    apalancamientoMax: 5,
    comision: CONFIG.comision,
    slippageBps: CONFIG.slippageBps,
};

export type MotivoSalida = 'STOP_LOSS' | 'TAKE_PROFIT' | 'FIN_DE_REGIMEN' | 'TIEMPO' | 'FIN_DE_DATOS';

export interface Operacion {
    direccion: Direccion;
    tiempoEntrada: number;
    tiempoSalida: number;
    entrada: number;
    salida: number;
    stopLoss: number;
    motivo: MotivoSalida;
    pnlR: number;
    pnlUsd: number;
    comisionesUsd: number;
    capitalDespues: number;
}

export interface ResultadoSimulacion {
    operaciones: Operacion[];
    capitalFinal: number;
    senalesFiltradas: number;
}

function conSlippage(precio: number, direccion: Direccion, esEntrada: boolean, bps: number): number {
    // En contra: compras más caro y vendes más barato.
    const compra = (direccion === 'LONG') === esEntrada;
    const factor = bps / 10_000;
    return compra ? precio * (1 + factor) : precio * (1 - factor);
}

function liquidar(
    p: ParametrosSimulacion,
    capital: number,
    direccion: Direccion,
    entrada: number,
    salida: number,
    stopLoss: number,
): { pnlUsd: number; comisionesUsd: number; pnlR: number } {
    const riesgoPorUnidad = Math.abs(entrada - stopLoss);
    const cantidadPorRiesgo = (capital * p.riesgoPct) / 100 / riesgoPorUnidad;
    const cantidadMax = (capital * p.apalancamientoMax) / entrada;
    const cantidad = Math.min(cantidadPorRiesgo, cantidadMax);

    const signo = direccion === 'LONG' ? 1 : -1;
    const comisionesUsd = cantidad * (entrada + salida) * p.comision;
    const pnlUsd = cantidad * signo * (salida - entrada) - comisionesUsd;
    return { pnlUsd, comisionesUsd, pnlR: resultadoEnR(direccion, entrada, salida, riesgoPorUnidad) };
}

/** Serie de regímenes de la estrategia en vivo, vela a vela (con histéresis). */
export function serieRegimenes(velas1h: Vela[], velas4h: Vela[]): (Regimen | null)[] {
    const valores = calcularValores(velas1h, velas4h);
    const serie: (Regimen | null)[] = [];
    let previo: Regimen | null = null;
    for (const v of valores) {
        const actual: Regimen | null = v ? clasificarRegimen(v, previo) : null;
        serie.push(actual);
        previo = actual;
    }
    return serie;
}

/** Backtest de la estrategia que corre en vivo (régimen de tendencia, 1h + 4h). */
export function simularTendencia(velas1h: Vela[], velas4h: Vela[], p = PARAMETROS_POR_DEFECTO): ResultadoSimulacion {
    const valores = calcularValores(velas1h, velas4h);
    const regimenes = serieRegimenes(velas1h, velas4h);
    const operaciones: Operacion[] = [];
    let capital = p.capitalInicial;

    let i = 1;
    while (i < velas1h.length - 1) {
        const regimen = regimenes[i];
        const direccion = regimen ? direccionDeRegimen(regimen) : null;
        const valoresI = valores[i];
        if (!direccion || !valoresI || regimen === regimenes[i - 1]) {
            i++;
            continue;
        }

        const indiceEntrada = i + 1;
        const entrada = conSlippage(velas1h[indiceEntrada].open, direccion, true, p.slippageBps);
        const niveles = calcularNiveles(direccion, entrada, valoresI.atr);

        let salida = velas1h[velas1h.length - 1].close;
        let motivo: MotivoSalida = 'FIN_DE_DATOS';
        let tiempoSalida = velas1h[velas1h.length - 1].closeTime;
        let siguiente = velas1h.length;

        for (let j = indiceEntrada; j < velas1h.length; j++) {
            const toque = buscarSalida(niveles, [velas1h[j]]);
            if (toque) {
                motivo = toque.motivo;
                salida = toque.motivo === 'STOP_LOSS' ? conSlippage(toque.precio, direccion, false, p.slippageBps) : toque.precio;
                tiempoSalida = velas1h[j].closeTime;
                siguiente = j;
                break;
            }
            if (regimenes[j] !== regimen && j + 1 < velas1h.length) {
                motivo = 'FIN_DE_REGIMEN';
                salida = conSlippage(velas1h[j + 1].open, direccion, false, p.slippageBps);
                tiempoSalida = velas1h[j + 1].openTime;
                siguiente = j; // la vela j puede ser, a la vez, una señal en sentido contrario
                break;
            }
        }

        const r = liquidar(p, capital, direccion, entrada, salida, niveles.stopLoss);
        capital += r.pnlUsd;
        operaciones.push({
            direccion,
            tiempoEntrada: velas1h[indiceEntrada].openTime,
            tiempoSalida,
            entrada,
            salida,
            stopLoss: niveles.stopLoss,
            motivo,
            ...r,
            capitalDespues: capital,
        });
        i = Math.max(siguiente, i + 1);
    }

    return { operaciones, capitalFinal: capital, senalesFiltradas: 0 };
}

/**
 * Backtest de la estrategia V2 original (barrido de liquidez en 15m con filtro
 * ADX 1h < 20), corregida: sin look-ahead, entrada en la apertura siguiente y
 * comisiones sobre el nominal.
 */
export function simularBarrido(velas15m: Vela[], velas1h: Vela[], p = PARAMETROS_POR_DEFECTO): ResultadoSimulacion {
    const serieATR = atr(velas15m, 14);
    const serieADX1h = adx(velas1h, 14);
    const indice1h = alinearTemporalidades(velas15m, velas1h);
    const operaciones: Operacion[] = [];
    let capital = p.capitalInicial;
    let senalesFiltradas = 0;

    const RATIO_TP = 1.6;
    const MAX_VELAS = 15;

    let i = 20;
    while (i < velas15m.length - 1) {
        const vela = velas15m[i];
        const atrActual = serieATR[i];
        if (!Number.isFinite(atrActual)) { i++; continue; }

        let soporte = Infinity;
        for (let k = i - 20; k < i; k++) soporte = Math.min(soporte, velas15m[k].low);

        const barrido = vela.low <= soporte - 0.15 * atrActual;
        const reclamo = vela.close > soporte;
        if (!barrido || !reclamo) { i++; continue; }

        const j = indice1h[i];
        const adx1h = j >= 0 ? serieADX1h[j].adx : NaN;
        if (!Number.isFinite(adx1h)) { i++; continue; }
        if (adx1h >= 20) { senalesFiltradas++; i++; continue; }

        const indiceEntrada = i + 1;
        const entrada = conSlippage(velas15m[indiceEntrada].open, 'LONG', true, p.slippageBps);
        const stopLoss = vela.low - 0.35 * atrActual;
        if (entrada <= stopLoss) { i++; continue; }
        const takeProfit = entrada + (entrada - stopLoss) * RATIO_TP;

        const ultima = Math.min(indiceEntrada + MAX_VELAS, velas15m.length - 1);
        let salida = conSlippage(velas15m[ultima].close, 'LONG', false, p.slippageBps);
        let motivo: MotivoSalida = ultima === velas15m.length - 1 ? 'FIN_DE_DATOS' : 'TIEMPO';
        let indiceSalida = ultima;

        const toque = buscarSalida({ direccion: 'LONG', stopLoss, takeProfit2: takeProfit }, velas15m.slice(indiceEntrada, ultima + 1));
        if (toque) {
            indiceSalida = indiceEntrada + toque.indice;
            motivo = toque.motivo === 'STOP_LOSS' ? 'STOP_LOSS' : 'TAKE_PROFIT';
            salida = toque.motivo === 'STOP_LOSS' ? conSlippage(toque.precio, 'LONG', false, p.slippageBps) : toque.precio;
        }

        const r = liquidar(p, capital, 'LONG', entrada, salida, stopLoss);
        capital += r.pnlUsd;
        operaciones.push({
            direccion: 'LONG',
            tiempoEntrada: velas15m[indiceEntrada].openTime,
            tiempoSalida: velas15m[indiceSalida].closeTime,
            entrada,
            salida,
            stopLoss,
            motivo,
            ...r,
            capitalDespues: capital,
        });
        i = indiceSalida + 1;
    }

    return { operaciones, capitalFinal: capital, senalesFiltradas };
}

export interface Metricas {
    operaciones: number;
    ganadoras: number;
    winRate: number;
    rPromedio: number;
    profitFactor: number;
    retornoPct: number;
    maxDrawdownPct: number;
    comisionesUsd: number;
    porMotivo: Record<string, number>;
}

export function calcularMetricas(resultado: ResultadoSimulacion, capitalInicial: number): Metricas {
    const ops = resultado.operaciones;
    const ganadoras = ops.filter(o => o.pnlUsd > 0).length;
    const brutoGanado = ops.filter(o => o.pnlUsd > 0).reduce((s, o) => s + o.pnlUsd, 0);
    const brutoPerdido = Math.abs(ops.filter(o => o.pnlUsd <= 0).reduce((s, o) => s + o.pnlUsd, 0));

    let pico = capitalInicial;
    let maxDD = 0;
    for (const o of ops) {
        pico = Math.max(pico, o.capitalDespues);
        maxDD = Math.max(maxDD, (pico - o.capitalDespues) / pico);
    }

    const porMotivo: Record<string, number> = {};
    for (const o of ops) porMotivo[o.motivo] = (porMotivo[o.motivo] ?? 0) + 1;

    return {
        operaciones: ops.length,
        ganadoras,
        winRate: ops.length ? (ganadoras / ops.length) * 100 : 0,
        rPromedio: ops.length ? ops.reduce((s, o) => s + o.pnlR, 0) / ops.length : 0,
        profitFactor: brutoPerdido === 0 ? (brutoGanado > 0 ? Infinity : 0) : brutoGanado / brutoPerdido,
        retornoPct: ((resultado.capitalFinal - capitalInicial) / capitalInicial) * 100,
        maxDrawdownPct: maxDD * 100,
        comisionesUsd: ops.reduce((s, o) => s + o.comisionesUsd, 0),
        porMotivo,
    };
}
