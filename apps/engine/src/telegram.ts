import { logHealth } from './db';
import { fetchJson } from './http';

let ultimoError: string | null = null;

/** Motivo del último fallo de envío (token inválido, chat no encontrado, bot bloqueado, red...). */
export function ultimoErrorTelegram(): string | null {
    return ultimoError;
}

/**
 * Envía un mensaje a Telegram. Devuelve true SOLO si Telegram confirmó la entrega
 * (HTTP 2xx y `ok: true`). Antes el log decía "enviada exitosamente" aunque fallara.
 */
export async function enviarTelegram(mensaje: string): Promise<boolean> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
        ultimoError = 'Telegram no configurado: faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID';
        console.warn(`⚠️ ${ultimoError}. Mensaje no enviado.`);
        return false;
    }

    try {
        const res = await fetchJson<{ ok: boolean; description?: string }>(
            `${process.env.TELEGRAM_API_URL ?? 'https://api.telegram.org'}/bot${token}/sendMessage`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, text: mensaje, parse_mode: 'HTML', disable_web_page_preview: true }),
            },
        );
        if (!res.ok) {
            ultimoError = `Telegram rechazó el mensaje: ${res.description ?? 'sin descripción'}`;
            console.error(`❌ ${ultimoError}`);
            return false;
        }
        ultimoError = null;
        console.log('📱 Telegram confirmó la entrega del mensaje.');
        return true;
    } catch (error) {
        // Incluye la respuesta de Telegram, p. ej. "HTTP 401 ... Unauthorized" o "HTTP 400 ... chat not found"
        ultimoError = `Error enviando a Telegram: ${error instanceof Error ? error.message : String(error)}`;
        console.error(`❌ ${ultimoError}`);
        return false;
    }
}

/** Envía y, si falla, deja el motivo exacto en SystemHealth. */
export async function enviarTelegramRegistrando(mensaje: string, contexto: string): Promise<boolean> {
    const ok = await enviarTelegram(mensaje);
    if (!ok) await logHealth('TELEGRAM', 'ERROR', `${contexto}: ${ultimoError ?? 'motivo desconocido'}`);
    return ok;
}
