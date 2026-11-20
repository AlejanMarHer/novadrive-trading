'use server';

import { prisma } from '../lib/prisma';

export interface SenalActiva {
  direccion: 'LONG' | 'SHORT';
  entrada: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  riskRewardNet: number;
  generadaEn: string;
}

export interface EstadisticasSenales {
  cerradas: number;
  ganadoras: number;
  rPromedio: number | null;
}

export interface EstadoMotor {
  regimen: string | null;
  adx: number | null;
  actualizadoEn: string | null;
  senalActiva: SenalActiva | null;
  estadisticas: EstadisticasSenales;
}

/** Estado completo que muestra el dashboard (solo lectura). */
export async function obtenerEstado(): Promise<EstadoMotor | null> {
  try {
    const [registro, activa, cerradas] = await Promise.all([
      prisma.marketRegimeRecord.findFirst({ orderBy: { timestamp: 'desc' } }),
      prisma.signal.findFirst({ where: { status: 'ACTIVE' }, orderBy: { generatedAt: 'desc' } }),
      prisma.signal.findMany({
        where: { status: { startsWith: 'CLOSED' } },
        orderBy: { closedAt: 'desc' },
        take: 200,
      }),
    ]);

    const conResultado = cerradas.filter(s => s.pnlNet !== null);
    const ganadoras = conResultado.filter(s => (s.pnlNet ?? 0) > 0).length;
    const rPromedio = conResultado.length
      ? conResultado.reduce((suma, s) => suma + (s.pnlNet ?? 0), 0) / conResultado.length
      : null;

    return {
      regimen: registro?.regime ?? null,
      adx: registro?.adx1h ?? null,
      actualizadoEn: registro?.timestamp.toISOString() ?? null,
      senalActiva: activa
        ? {
            direccion: activa.direction === 'SHORT' ? 'SHORT' : 'LONG',
            entrada: activa.entryPrice,
            stopLoss: activa.stopLoss,
            takeProfit1: activa.takeProfit1,
            takeProfit2: activa.takeProfit2,
            riskRewardNet: activa.riskRewardNet,
            generadaEn: activa.generatedAt.toISOString(),
          }
        : null,
      estadisticas: { cerradas: conResultado.length, ganadoras, rPromedio },
    };
  } catch (error) {
    console.error('❌ Error consultando la base de datos:', error);
    return null;
  }
}
