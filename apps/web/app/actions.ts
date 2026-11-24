'use server';

import { prisma } from '@/lib/prisma';

export interface DashboardData {
  regimen: {
    regime: string;
    adx1h: number | null;
    emaSlope4h: number | null;
    price: number | null;
    note: string | null;
    timestamp: string;
  } | null;
  senalActiva: {
    id: string;
    direction: string;
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    riskRewardNet: number;
    generatedAt: string;
  } | null;
  ultimasSenales: {
    id: string;
    direction: string;
    status: string;
    pnlNet: number | null;
    generatedAt: string;
  }[];
  rendimiento: {
    cerradas: number;
    ganadoras: number;
    winRate: number | null;
    expectativaR: number | null;
    sumaR: number;
  };
  ultimoError: { component: string; message: string | null; timestamp: string } | null;
  backtest: {
    createdAt: string;
    periodStart: string;
    periodEnd: string;
    trades: number;
    winRate: number;
    avgR: number;
    ciLowR: number;
    ciHighR: number;
    totalReturnPct: number;
    maxDrawdownPct: number;
    profitFactor: number | null;
  } | null;
  error: string | null;
}

const EMPTY: DashboardData = {
  regimen: null,
  senalActiva: null,
  ultimasSenales: [],
  rendimiento: { cerradas: 0, ganadoras: 0, winRate: null, expectativaR: null, sumaR: 0 },
  ultimoError: null,
  backtest: null,
  error: null,
};

export async function obtenerEstadoDashboard(): Promise<DashboardData> {
  try {
    const [regimen, activa, ultimas, cerradas, ultimoError, backtest] = await Promise.all([
      prisma.marketRegimeRecord.findFirst({ orderBy: { timestamp: 'desc' } }),
      prisma.signal.findFirst({ where: { status: 'ACTIVE' }, orderBy: { generatedAt: 'desc' } }),
      prisma.signal.findMany({ orderBy: { generatedAt: 'desc' }, take: 5 }),
      prisma.signal.findMany({ where: { status: { not: 'ACTIVE' }, pnlNet: { not: null } }, select: { pnlNet: true } }),
      prisma.systemHealth.findFirst({
        where: { status: 'ERROR', timestamp: { gte: new Date(Date.now() - 24 * 3_600_000) } },
        orderBy: { timestamp: 'desc' },
      }),
      prisma.backtestRun.findFirst({ orderBy: { createdAt: 'desc' } }),
    ]);

    const rs = cerradas.map(s => s.pnlNet as number);
    const sumaR = rs.reduce((a, b) => a + b, 0);
    const ganadoras = rs.filter(r => r > 0).length;

    return {
      regimen: regimen && {
        regime: regimen.regime,
        adx1h: regimen.adx1h,
        emaSlope4h: regimen.emaSlope4h,
        price: regimen.price,
        note: regimen.note,
        timestamp: regimen.timestamp.toISOString(),
      },
      senalActiva: activa && {
        id: activa.id,
        direction: activa.direction,
        entryPrice: activa.entryPrice,
        stopLoss: activa.stopLoss,
        takeProfit: activa.takeProfit2,
        riskRewardNet: activa.riskRewardNet,
        generatedAt: activa.generatedAt.toISOString(),
      },
      ultimasSenales: ultimas.map(s => ({
        id: s.id,
        direction: s.direction,
        status: s.status,
        pnlNet: s.pnlNet,
        generatedAt: s.generatedAt.toISOString(),
      })),
      rendimiento: {
        cerradas: rs.length,
        ganadoras,
        winRate: rs.length ? ganadoras / rs.length : null,
        expectativaR: rs.length ? sumaR / rs.length : null,
        sumaR,
      },
      ultimoError: ultimoError && {
        component: ultimoError.component,
        message: ultimoError.message,
        timestamp: ultimoError.timestamp.toISOString(),
      },
      backtest: backtest && {
        createdAt: backtest.createdAt.toISOString(),
        periodStart: backtest.periodStart.toISOString(),
        periodEnd: backtest.periodEnd.toISOString(),
        trades: backtest.trades,
        winRate: backtest.winRate,
        avgR: backtest.avgR,
        ciLowR: backtest.ciLowR,
        ciHighR: backtest.ciHighR,
        totalReturnPct: backtest.totalReturnPct,
        maxDrawdownPct: backtest.maxDrawdownPct,
        profitFactor: backtest.profitFactor,
      },
      error: null,
    };
  } catch (error) {
    console.error('❌ Error consultando Supabase:', error);
    return { ...EMPTY, error: 'No se pudo consultar la base de datos' };
  }
}
