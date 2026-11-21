import { Prisma, PrismaClient } from '@prisma/client';
import { DEFAULT_COSTS, STRATEGY_NAME } from './config';
import { INITIAL_STATE, type SignalState } from './strategy';

export const prisma = new PrismaClient();

const STATE_KEY = `signalState:${STRATEGY_NAME}`;

export async function loadSignalState(): Promise<SignalState> {
    const row = await prisma.engineState.findUnique({ where: { key: STATE_KEY } });
    if (!row || typeof row.value !== 'object' || row.value === null) return { ...INITIAL_STATE };
    const v = row.value as Partial<SignalState>;
    return {
        disarmed: v.disarmed === 'LONG' || v.disarmed === 'SHORT' ? v.disarmed : null,
        lastCandleCloseTime: typeof v.lastCandleCloseTime === 'number' ? v.lastCandleCloseTime : null,
    };
}

export async function saveSignalState(state: SignalState): Promise<void> {
    const value = state as unknown as Prisma.InputJsonValue;
    await prisma.engineState.upsert({
        where: { key: STATE_KEY },
        create: { key: STATE_KEY, value },
        update: { value },
    });
}

/** Crea la configuración si no existe y devuelve la vigente (editable desde Supabase). */
export async function loadStrategyConfig(): Promise<{ isActive: boolean; maxRiskPerTrade: number }> {
    const cfg = await prisma.strategyConfig.upsert({
        where: { strategyName: STRATEGY_NAME },
        create: { strategyName: STRATEGY_NAME, isActive: true, maxRiskPerTrade: DEFAULT_COSTS.riskPct },
        update: {},
    });
    return { isActive: cfg.isActive, maxRiskPerTrade: cfg.maxRiskPerTrade };
}

/** Registra un evento de salud. Nunca lanza: si la BD está caída, solo lo deja en el log. */
export async function logHealth(component: string, status: 'OK' | 'ERROR' | 'STARTED', message?: string): Promise<void> {
    try {
        await prisma.systemHealth.create({ data: { component, status, message: message?.slice(0, 1000) } });
    } catch (err) {
        const msg = err instanceof Error ? err.message.split('\n').filter(l => l.trim()).pop() : String(err);
        console.error(`⚠️ No se pudo registrar SystemHealth (${component}/${status}): ${msg}`);
    }
}
