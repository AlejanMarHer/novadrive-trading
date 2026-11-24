/** Utilidades puras de vigilancia (fáciles de testear). */

/** Devuelve la fecha (YYYY-MM-DD, UTC) si toca enviar el informe diario, o null. */
export function dailyReportDue(now: Date, lastSentDate: string | null, hourUtc: number | null): string | null {
    if (hourUtc === null) return null;
    const today = now.toISOString().slice(0, 10);
    if (lastSentDate === today) return null;
    return now.getUTCHours() >= hourUtc ? today : null;
}

/** True si el hueco desde el último latido supera el umbral (el motor estuvo caído o dormido). */
export function wasDown(lastAt: Date | null, now: Date, thresholdMinutes: number): boolean {
    return lastAt !== null && now.getTime() - lastAt.getTime() > thresholdMinutes * 60_000;
}
