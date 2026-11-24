import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { enviarTelegram, ultimoErrorTelegram } from '../src/telegram';

let server: http.Server;
let respuesta: { status: number; body: unknown } = { status: 200, body: { ok: true } };

before(async () => {
    server = http.createServer((req, res) => {
        req.resume();
        req.on('end', () => {
            res.writeHead(respuesta.status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(respuesta.body));
        });
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    process.env.TELEGRAM_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.TELEGRAM_BOT_TOKEN = '123:secreto';
    process.env.TELEGRAM_CHAT_ID = '42';
});
after(() => server.close());

test('entrega correcta', async () => {
    respuesta = { status: 200, body: { ok: true } };
    assert.equal(await enviarTelegram('hola'), true);
    assert.equal(ultimoErrorTelegram(), null);
});

test('guarda el motivo exacto del rechazo y no filtra el token', async () => {
    respuesta = { status: 400, body: { ok: false, error_code: 400, description: 'Bad Request: chat not found' } };
    assert.equal(await enviarTelegram('hola'), false);
    assert.match(ultimoErrorTelegram()!, /chat not found/);
    assert.doesNotMatch(ultimoErrorTelegram()!, /secreto/);
});

test('sin token o chat configurado lo dice explícitamente', async () => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;
    assert.equal(await enviarTelegram('hola'), false);
    assert.match(ultimoErrorTelegram()!, /no configurado/);
    process.env.TELEGRAM_BOT_TOKEN = token;
});
