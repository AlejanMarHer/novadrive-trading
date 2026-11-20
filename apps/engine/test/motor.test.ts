import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adx, atr, ema } from '../lib/indicadores';
import type { Vela } from '../lib/binance';
import {
    alinearTemporalidades,
    buscarSalida,
    calcularNiveles,
    clasificarRegimen,
    CONFIG,
    resultadoEnR,
    type ValoresMercado,
} from '../lib/estrategia';
import { calcularMetricas, PARAMETROS_POR_DEFECTO, simularBarrido, simularTendencia } from '../lib/simulador';

const HORA = 3_600_000;

/** Genera velas sintéticas a partir de una lista de cierres. */
function velasDesdeCierres(cierres: number[], duracionMs: number, inicio = 0, rango = 0.004): Vela[] {
    return cierres.map((close, i) => {
        const open = i === 0 ? close : cierres[i - 1];
        return {
            openTime: inicio + i * duracionMs,
            closeTime: inicio + (i + 1) * duracionMs - 1,
            open,
            high: Math.max(open, close) * (1 + rango),
            low: Math.min(open, close) * (1 - rango),
            close,
            cerrada: true,
        };
    });
}

/** Paseo aleatorio determinista (semilla fija) con deriva opcional por tramos. */
function paseo(n: number, semilla = 42, deriva: (i: number) => number = () => 0): number[] {
    let s = semilla;
    const azar = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296) - 0.5;
    const precios = [30_000];
    for (let i = 1; i < n; i++) precios.push(precios[i - 1] * (1 + deriva(i) + azar() * 0.012));
    return precios;
}

/** Agrupa velas de 1h en velas de 4h (como lo haría Binance). */
function agrupar4h(velas1h: Vela[]): Vela[] {
    const resultado: Vela[] = [];
    for (let i = 0; i + 4 <= velas1h.length; i += 4) {
        const grupo = velas1h.slice(i, i + 4);
        resultado.push({
            openTime: grupo[0].openTime,
            closeTime: grupo[3].closeTime,
            open: grupo[0].open,
            high: Math.max(...grupo.map(v => v.high)),
            low: Math.min(...grupo.map(v => v.low)),
            close: grupo[3].close,
            cerrada: true,
        });
    }
    return resultado;
}

test('EMA: serie constante da el mismo valor y respeta el calentamiento', () => {
    const r = ema(Array(30).fill(100), 10);
    assert.ok(Number.isNaN(r[8]));
    assert.equal(r[9], 100);
    assert.equal(r[29], 100);
});

test('ATR: rango constante sin huecos da ese rango', () => {
    const velas = Array.from({ length: 40 }, () => ({ high: 110, low: 100, close: 105 }));
    const r = atr(velas, 14);
    assert.ok(Number.isNaN(r[13]));
    assert.ok(Math.abs(r[39] - 10) < 1e-9);
});

test('ADX: tendencia alcista fuerte => ADX alto y +DI > -DI; bajista => -DI > +DI', () => {
    const sube = Array.from({ length: 80 }, (_, i) => ({ high: 101 + i, low: 99 + i, close: 100.5 + i }));
    const ultimo = adx(sube, 14).at(-1)!;
    assert.ok(ultimo.adx > 50, `ADX esperado > 50, fue ${ultimo.adx}`);
    assert.ok(ultimo.pdi > ultimo.mdi);

    const baja = sube.map(v => ({ high: 300 - v.low, low: 300 - v.high, close: 300 - v.close }));
    const ultimoBaja = adx(baja, 14).at(-1)!;
    assert.ok(ultimoBaja.mdi > ultimoBaja.pdi);
});

test('Indicadores sin look-ahead: calcular sobre un prefijo da los mismos valores', () => {
    const velas = velasDesdeCierres(paseo(300), HORA);
    const completo = adx(velas, 14);
    const prefijo = adx(velas.slice(0, 150), 14);
    assert.equal(prefijo[149].adx, completo[149].adx);
    assert.equal(ema(velas.map(v => v.close), 21)[149], ema(velas.slice(0, 150).map(v => v.close), 21)[149]);
    assert.equal(atr(velas, 14)[149], atr(velas.slice(0, 150), 14)[149]);
});

test('Alineación 1h/4h: nunca usa una vela de 4h que aún no ha cerrado', () => {
    const velas1h = velasDesdeCierres(paseo(24), HORA);
    const velas4h = agrupar4h(velas1h);
    const indices = alinearTemporalidades(velas1h, velas4h);
    // Velas 1h 0..2 (00:00-02:59): ninguna vela de 4h cerrada todavía.
    assert.deepEqual(indices.slice(0, 3), [-1, -1, -1]);
    // La vela 1h de las 03:00 cierra junto con la de 4h de 00:00-03:59.
    assert.equal(indices[3], 0);
    // De 04:00 a 06:59 se sigue usando la de 00:00 (la de 04:00 aún está abierta).
    assert.deepEqual(indices.slice(4, 7), [0, 0, 0]);
    assert.equal(indices[7], 1);
    for (let i = 0; i < velas1h.length; i++) {
        if (indices[i] >= 0) assert.ok(velas4h[indices[i]].closeTime <= velas1h[i].closeTime);
    }
});

function valores(parcial: Partial<ValoresMercado>): ValoresMercado {
    return {
        tiempo: 0, cierre1h: 105, ema21_1h: 102, ema55_1h: 100, ema50_4h: 100, pendienteEma4h: 0,
        adx: 25, pdi: 30, mdi: 10, atr: 1, ...parcial,
    };
}

test('Régimen: entra en tendencia con ADX >= 22 y la mantiene hasta ADX < 20 (histéresis)', () => {
    assert.equal(clasificarRegimen(valores({ adx: 23 }), null), 'TREND_BULL');
    assert.equal(clasificarRegimen(valores({ adx: 21 }), null), 'TRANSITION_CHOP');
    assert.equal(clasificarRegimen(valores({ adx: 21 }), 'TREND_BULL'), 'TREND_BULL');
    assert.equal(clasificarRegimen(valores({ adx: 19 }), 'TREND_BULL'), 'RANGE_COMPRESSION');
    assert.equal(
        clasificarRegimen(valores({ cierre1h: 95, ema21_1h: 98, ema55_1h: 100, pdi: 10, mdi: 30, adx: 30 }), null),
        'TREND_BEAR',
    );
    // Si se rompe la estructura de EMAs, la tendencia termina aunque el ADX siga alto.
    assert.equal(clasificarRegimen(valores({ cierre1h: 99, adx: 30 }), 'TREND_BULL'), 'TRANSITION_CHOP');
});

test('Niveles: stop a 1.5 ATR, TP1 = 1R, TP2 = 2R y R:R neto < 2 por comisiones', () => {
    const n = calcularNiveles('LONG', 100_000, 400);
    assert.equal(n.stopLoss, 99_400);
    assert.equal(n.takeProfit1, 100_600);
    assert.equal(n.takeProfit2, 101_200);
    assert.ok(n.riskRewardNet < 2 && n.riskRewardNet > 1.5);

    const s = calcularNiveles('SHORT', 100_000, 400);
    assert.equal(s.stopLoss, 100_600);
    assert.equal(s.takeProfit2, 98_800);
});

test('Resultado en R descuenta comisiones sobre el nominal', () => {
    // Stop exacto: -1R menos comisiones.
    const r = resultadoEnR('LONG', 100_000, 99_400, 600);
    const comisionesEnR = ((100_000 + 99_400) * CONFIG.comision) / 600;
    assert.ok(Math.abs(r - (-1 - comisionesEnR)) < 1e-9);
    assert.ok(resultadoEnR('SHORT', 100_000, 98_800, 600) < 2);
});

test('Salida: si una vela toca stop y TP a la vez se asume el stop', () => {
    const niveles = { direccion: 'LONG' as const, stopLoss: 99, takeProfit2: 102 };
    assert.deepEqual(buscarSalida(niveles, [{ high: 103, low: 98 }]), { indice: 0, precio: 99, motivo: 'STOP_LOSS' });
    assert.deepEqual(buscarSalida(niveles, [{ high: 101, low: 99.5 }, { high: 102.5, low: 100 }]), { indice: 1, precio: 102, motivo: 'TAKE_PROFIT' });
    assert.equal(buscarSalida(niveles, [{ high: 101, low: 99.5 }]), null);
});

test('Simulación de tendencia: genera operaciones y las comisiones empeoran el resultado', () => {
    const deriva = (i: number) => (Math.floor(i / 400) % 2 === 0 ? 0.0015 : -0.0015);
    const velas1h = velasDesdeCierres(paseo(3000, 7, deriva), HORA);
    const velas4h = agrupar4h(velas1h);

    const conCostes = simularTendencia(velas1h, velas4h);
    const sinCostes = simularTendencia(velas1h, velas4h, { ...PARAMETROS_POR_DEFECTO, comision: 0, slippageBps: 0 });
    assert.ok(conCostes.operaciones.length > 0, 'debería haber operaciones');
    assert.ok(conCostes.capitalFinal < sinCostes.capitalFinal);

    // Las operaciones no se solapan y cada entrada es posterior a su señal.
    for (let k = 1; k < conCostes.operaciones.length; k++) {
        assert.ok(conCostes.operaciones[k].tiempoEntrada >= conCostes.operaciones[k - 1].tiempoSalida - HORA);
    }
    const m = calcularMetricas(conCostes, PARAMETROS_POR_DEFECTO.capitalInicial);
    assert.equal(m.operaciones, conCostes.operaciones.length);
    assert.ok(m.maxDrawdownPct >= 0);
});

test('Simulación de barrido (V2 corregida) corre sin errores', () => {
    const velas15m = velasDesdeCierres(paseo(4000, 3), HORA / 4, 0, 0.002);
    const velas1h: Vela[] = [];
    for (let i = 0; i + 4 <= velas15m.length; i += 4) {
        const g = velas15m.slice(i, i + 4);
        velas1h.push({ openTime: g[0].openTime, closeTime: g[3].closeTime, open: g[0].open, high: Math.max(...g.map(v => v.high)), low: Math.min(...g.map(v => v.low)), close: g[3].close, cerrada: true });
    }
    const r = simularBarrido(velas15m, velas1h);
    for (const o of r.operaciones) {
        assert.equal(o.direccion, 'LONG');
        assert.ok(o.stopLoss < o.entrada);
    }
});
