import { randomUUID } from 'crypto';
import { FAILURE_ALERT_STREAK } from './config';
import { runCycle } from './cycle';
import { acquireCycleLock, getState, lastHeartbeatAt, logHealth, releaseCycleLock, setState } from './db';
import { instanceLabel } from './instance';
import { failureMessage, recoveryMessage } from './messages';
import { enviarTelegramRegistrando } from './telegram';

export type CycleOutcome = 'ok' | 'locked' | 'error';

const STREAK_KEY = 'errorStreak';
/** Espera entre comprobaciones cuando otro proceso tiene el candado (configurable para tests). */
const LOCK_WAIT_MS = Number(process.env.LOCK_WAIT_MS ?? 10_000);
/** Respaldo en memoria por si la BD es justamente lo que falla. */
let memoryStreak = 0;

async function readStreak(): Promise<number> {
    try {
        return (await getState<{ count: number }>(STREAK_KEY))?.count ?? memoryStreak;
    } catch {
        return memoryStreak;
    }
}

async function writeStreak(count: number): Promise<void> {
    memoryStreak = count;
    try {
        await setState(STREAK_KEY, { count });
    } catch {
        /* la BD no responde: queda el valor en memoria */
    }
}

/**
 * Ejecuta un ciclo con:
 *  - candado entre procesos (Render y GitHub Actions no pueden correr a la vez),
 *  - registro de la racha de fallos y aviso por Telegram al llegar a FAILURE_ALERT_STREAK,
 *  - aviso de recuperación cuando vuelve a funcionar.
 */
export async function runGuardedCycle(source: string): Promise<{ outcome: CycleOutcome; error?: string }> {
    const owner = `${source}:${randomUUID()}`;
    let locked = false;
    try {
        locked = await acquireCycleLock(owner);
        if (!locked) {
            // Otro proceso tiene el candado. Si termina bien, escribirá un latido nuevo y no hace falta repetir.
            // Si falla (p. ej. su IP está baneada por Binance), libera el candado y este proceso hace el ciclo.
            const start = new Date();
            for (let i = 0; i < 6 && !locked; i++) {
                await new Promise(r => setTimeout(r, LOCK_WAIT_MS));
                const beat = await lastHeartbeatAt();
                if (beat && beat >= start) {
                    console.log('🔒 Otro proceso completó el ciclo; se omite este.');
                    return { outcome: 'locked' };
                }
                locked = await acquireCycleLock(owner);
            }
            if (!locked) {
                console.log('🔒 Otro proceso sigue con el candado; se omite este ciclo.');
                return { outcome: 'locked' };
            }
            console.log('🔓 El otro proceso no completó el ciclo; lo ejecuta este.');
        }
        await runCycle();
        const streak = await readStreak();
        if (streak > 0) {
            if (streak >= FAILURE_ALERT_STREAK) await enviarTelegramRegistrando(recoveryMessage(streak), 'Aviso de recuperación');
            await writeStreak(0);
        }
        return { outcome: 'ok' };
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('❌ Error en el ciclo:', msg);
        await logHealth('ENGINE', 'ERROR', `[${instanceLabel()}] ${msg}`);
        const streak = (await readStreak()) + 1;
        await writeStreak(streak);
        if (streak === FAILURE_ALERT_STREAK) await enviarTelegramRegistrando(failureMessage(streak, msg), 'Aviso de fallos');
        return { outcome: 'error', error: msg };
    } finally {
        if (locked) await releaseCycleLock(owner).catch(() => undefined);
    }
}
