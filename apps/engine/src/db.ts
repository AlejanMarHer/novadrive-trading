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

// ---------------------------------------------------------------------------
// Estado genérico (clave → JSON) en EngineState
// ---------------------------------------------------------------------------

export async function getState<T>(key: string): Promise<T | null> {
    const row = await prisma.engineState.findUnique({ where: { key } });
    return row ? (row.value as unknown as T) : null;
}

export async function setState(key: string, value: unknown): Promise<void> {
    const v = value as Prisma.InputJsonValue;
    await prisma.engineState.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
}

/**
 * Candado entre procesos (p. ej. Render y GitHub Actions a la vez) para que dos ciclos no
 * corran simultáneamente y dupliquen una señal. Es una fila con caducidad, así que si un proceso
 * muere con el candado tomado, se libera solo. Funciona con el pooler de Supabase (pgbouncer).
 */
export async function acquireCycleLock(owner: string, ttlMs = 5 * 60_000): Promise<boolean> {
    const now = Date.now();
    const value = JSON.stringify({ owner, until: now + ttlMs });
    const rows = await prisma.$executeRaw`
        INSERT INTO "EngineState" ("key", "value", "updatedAt")
        VALUES ('lock:cycle', ${value}::jsonb, now())
        ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = now()
        WHERE ("EngineState"."value"->>'until')::bigint < ${now}::bigint`;
    return rows > 0;
}

export async function releaseCycleLock(owner: string): Promise<void> {
    await prisma.$executeRaw`DELETE FROM "EngineState" WHERE "key" = 'lock:cycle' AND "value"->>'owner' = ${owner}`;
}

export async function lastHeartbeatAt(): Promise<Date | null> {
    const r = await prisma.marketRegimeRecord.findFirst({ orderBy: { timestamp: 'desc' }, select: { timestamp: true } });
    return r?.timestamp ?? null;
}

export async function latestBacktest(strategy: string) {
    return prisma.backtestRun.findFirst({ where: { strategy }, orderBy: { createdAt: 'desc' } });
}
