/**
 * Indicadores técnicos propios (EMA, ATR y ADX con suavizado de Wilder).
 *
 * Todas las funciones devuelven un arreglo ALINEADO con la entrada: el valor en
 * la posición i usa únicamente datos de las posiciones 0..i (sin mirar al
 * futuro). Durante el periodo de calentamiento el valor es NaN.
 *
 * Se implementan aquí (en vez de usar `technicalindicators`) para que el motor
 * en vivo y el backtester compartan exactamente el mismo cálculo, con los
 * índices alineados y cubiertos por tests.
 */

export interface VelaHLC {
    high: number;
    low: number;
    close: number;
}

export interface ValorADX {
    adx: number;
    pdi: number;
    mdi: number;
}

/** EMA sembrada con la media simple de los primeros `periodo` valores. */
export function ema(valores: number[], periodo: number): number[] {
    const salida = new Array<number>(valores.length).fill(NaN);
    if (periodo <= 0 || valores.length < periodo) return salida;

    const k = 2 / (periodo + 1);
    let suma = 0;
    for (let i = 0; i < periodo; i++) suma += valores[i];
    let actual = suma / periodo;
    salida[periodo - 1] = actual;

    for (let i = periodo; i < valores.length; i++) {
        actual = (valores[i] - actual) * k + actual;
        salida[i] = actual;
    }
    return salida;
}

function rangoVerdadero(velas: VelaHLC[], i: number): number {
    const v = velas[i];
    if (i === 0) return v.high - v.low;
    const cierrePrevio = velas[i - 1].close;
    return Math.max(v.high - v.low, Math.abs(v.high - cierrePrevio), Math.abs(v.low - cierrePrevio));
}

/** ATR de Wilder. Primer valor disponible en el índice `periodo`. */
export function atr(velas: VelaHLC[], periodo = 14): number[] {
    const salida = new Array<number>(velas.length).fill(NaN);
    if (velas.length <= periodo) return salida;

    let suma = 0;
    for (let i = 1; i <= periodo; i++) suma += rangoVerdadero(velas, i);
    let actual = suma / periodo;
    salida[periodo] = actual;

    for (let i = periodo + 1; i < velas.length; i++) {
        actual = (actual * (periodo - 1) + rangoVerdadero(velas, i)) / periodo;
        salida[i] = actual;
    }
    return salida;
}

/**
 * ADX de Wilder con +DI y -DI. +DI/-DI están disponibles desde el índice
 * `periodo`; el ADX desde el índice `2 * periodo - 1`.
 */
export function adx(velas: VelaHLC[], periodo = 14): ValorADX[] {
    const vacio: ValorADX = { adx: NaN, pdi: NaN, mdi: NaN };
    const salida: ValorADX[] = velas.map(() => ({ ...vacio }));
    if (velas.length < 2 * periodo) return salida;

    const tr: number[] = [0];
    const dmMas: number[] = [0];
    const dmMenos: number[] = [0];
    for (let i = 1; i < velas.length; i++) {
        const subida = velas[i].high - velas[i - 1].high;
        const bajada = velas[i - 1].low - velas[i].low;
        dmMas.push(subida > bajada && subida > 0 ? subida : 0);
        dmMenos.push(bajada > subida && bajada > 0 ? bajada : 0);
        tr.push(rangoVerdadero(velas, i));
    }

    let sTR = 0;
    let sMas = 0;
    let sMenos = 0;
    for (let i = 1; i <= periodo; i++) {
        sTR += tr[i];
        sMas += dmMas[i];
        sMenos += dmMenos[i];
    }

    const dx: number[] = new Array<number>(velas.length).fill(NaN);
    for (let i = periodo; i < velas.length; i++) {
        if (i > periodo) {
            sTR = sTR - sTR / periodo + tr[i];
            sMas = sMas - sMas / periodo + dmMas[i];
            sMenos = sMenos - sMenos / periodo + dmMenos[i];
        }
        const pdi = sTR === 0 ? 0 : (100 * sMas) / sTR;
        const mdi = sTR === 0 ? 0 : (100 * sMenos) / sTR;
        const sumaDI = pdi + mdi;
        dx[i] = sumaDI === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / sumaDI;
        salida[i].pdi = pdi;
        salida[i].mdi = mdi;
    }

    const primerADX = 2 * periodo - 1;
    let sumaDX = 0;
    for (let i = periodo; i <= primerADX; i++) sumaDX += dx[i];
    let valorADX = sumaDX / periodo;
    salida[primerADX].adx = valorADX;

    for (let i = primerADX + 1; i < velas.length; i++) {
        valorADX = (valorADX * (periodo - 1) + dx[i]) / periodo;
        salida[i].adx = valorADX;
    }
    return salida;
}
