import os from 'os';
import { STRATEGY_NAME, SYMBOL } from './config';

/** Identifica el proceso: servicio de Render, ejecución de GitHub Actions o nombre de la máquina. */
export function instanceLabel(): string {
    if (process.env.GITHUB_ACTIONS) return `github-actions#${process.env.GITHUB_RUN_ID ?? '?'}`;
    const name = process.env.RENDER_SERVICE_NAME;
    const id = process.env.RENDER_SERVICE_ID;
    if (name || id) {
        const inst = process.env.RENDER_INSTANCE_ID;
        return `render:${name ?? '?'} (${id ?? '?'}${inst ? `, instancia ${inst}` : ''})`;
    }
    return os.hostname();
}

export function telegramConfigured(): boolean {
    return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

/** Resumen de arranque que se guarda en SystemHealth: permite ver cuántos procesos corren y cómo están configurados. */
export function startupSummary(): string {
    const commit = process.env.RENDER_GIT_COMMIT ?? process.env.GITHUB_SHA;
    return [
        `${STRATEGY_NAME} ${SYMBOL}`,
        instanceLabel(),
        `telegram=${telegramConfigured() ? 'configurado' : 'NO CONFIGURADO'}`,
        commit ? `commit ${commit.slice(0, 7)}` : null,
    ].filter(Boolean).join(' · ');
}
