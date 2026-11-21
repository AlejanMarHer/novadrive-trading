/** Minutos sin registros del motor a partir de los cuales el dashboard avisa que los datos son viejos. */
export const STALE_AFTER_MINUTES = 30;

export function minutesSince(iso: string | null | undefined, now: number): number | null {
    if (!iso) return null;
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return null;
    return Math.max(0, (now - t) / 60_000);
}

/** Sin registro, o registro más viejo que el umbral ⇒ datos desactualizados. */
export function isStale(iso: string | null | undefined, now: number, maxMinutes = STALE_AFTER_MINUTES): boolean {
    const m = minutesSince(iso, now);
    return m === null || m > maxMinutes;
}

export function formatAge(minutes: number | null): string {
    if (minutes === null) return 'nunca';
    if (minutes < 1) return 'hace menos de 1 min';
    if (minutes < 60) return `hace ${Math.floor(minutes)} min`;
    const h = Math.floor(minutes / 60);
    if (h < 48) return `hace ${h} h ${Math.floor(minutes % 60)} min`;
    return `hace ${Math.floor(h / 24)} días`;
}
