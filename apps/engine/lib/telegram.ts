/** Envío de mensajes a Telegram con timeout y verificación de respuesta. */
export async function enviarTelegram(mensaje: string): Promise<boolean> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
        console.warn('⚠️ TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID no configurados: alerta no enviada.');
        return false;
    }

    try {
        const respuesta = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: mensaje, parse_mode: 'HTML', disable_web_page_preview: true }),
            signal: AbortSignal.timeout(10_000),
        });
        if (!respuesta.ok) {
            const detalle = await respuesta.text().catch(() => '');
            console.error(`❌ Telegram rechazó el mensaje (HTTP ${respuesta.status}): ${detalle.slice(0, 300)}`);
            return false;
        }
        console.log('📱 Alerta enviada a Telegram.');
        return true;
    } catch (error) {
        console.error('❌ Error de red enviando a Telegram:', error);
        return false;
    }
}
