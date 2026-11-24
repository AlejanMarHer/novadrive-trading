/**
 * Ejecuta UN ciclo del motor y termina. Pensado para programadores externos
 * (GitHub Actions cada 15 min, cron, etc.) en lugar de un servidor que puede dormirse.
 * Todo el estado vive en la base de datos, así que cada ejecución continúa donde quedó la anterior.
 *
 *   npm run cycle
 */
import { STRATEGY_NAME, SYMBOL } from './src/config';
import { prisma } from './src/db';
import { startupSummary } from './src/instance';
import { runGuardedCycle } from './src/runner';

(async () => {
    const source = process.env.GITHUB_ACTIONS ? 'github-actions' : 'once';
    console.log(`🤖 Ciclo único ${STRATEGY_NAME} ${SYMBOL} (${source}) — ${new Date().toISOString()}`);
    console.log(`ℹ️ ${startupSummary()}`);
    const { outcome } = await runGuardedCycle(source);
    await prisma.$disconnect().catch(() => undefined);
    // Un error deja la ejecución en rojo en GitHub Actions; el bloqueo por otro proceso no es un error.
    process.exit(outcome === 'error' ? 1 : 0);
})();
