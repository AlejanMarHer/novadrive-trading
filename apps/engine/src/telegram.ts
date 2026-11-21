import { fetchJson } from './http';

/**
 * Envía un mensaje a Telegram. Devuelve true SOLO si Telegram confirmó la entrega
 * (HTTP 2xx y `ok: true`). Antes el log decía "enviada exitosamente" aunque fallara.
 */
export async function enviarTelegram(mensaje: string): Promise<boolean> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
        console.warn('⚠️ Telegram no configurado (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID). Mensaje no enviado.');
        return false;
    }

    try {
        const res = await fetchJson<{ ok: boolean; description?: string }>(
            `https://api.telegram.org/bot${token}/sendMessage`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, text: mensaje, parse_mode: 'HTML', disable_web_page_preview: true }),
            },
        );
        if (!res.ok) {
            console.error(`❌ Telegram rechazó el mensaje: ${res.description ?? 'sin descripción'}`);
            return false;
        }
        console.log('📱 Telegram confirmó la entrega del mensaje.');
        return true;
    } catch (error) {
        console.error('❌ Error enviando a Telegram:', error instanceof Error ? error.message : error);
        return false;
    }
}
