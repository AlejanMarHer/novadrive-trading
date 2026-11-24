import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backtestLine, dailyReportMessage, escapeHtml } from '../src/messages';
import { dailyReportDue, wasDown } from '../src/monitor';
import { makeEv } from './helpers';

test('dailyReportDue: una vez al día, a partir de la hora configurada', () => {
    const at = (h: number) => new Date(Date.UTC(2026, 10, 24, h, 5));
    assert.equal(dailyReportDue(at(11), null, 12), null);
    assert.equal(dailyReportDue(at(12), null, 12), '2026-11-24');
    assert.equal(dailyReportDue(at(18), '2026-11-24', 12), null, 'ya enviado hoy');
    assert.equal(dailyReportDue(at(18), '2026-11-23', 12), '2026-11-24');
    assert.equal(dailyReportDue(at(18), null, null), null, 'desactivado');
});

test('wasDown: detecta huecos largos entre latidos', () => {
    const now = new Date(Date.UTC(2026, 10, 24, 12));
    assert.equal(wasDown(new Date(now.getTime() - 20 * 60_000), now, 90), false);
    assert.equal(wasDown(new Date(now.getTime() - 3 * 86_400_000), now, 90), true);
    assert.equal(wasDown(null, now, 90), false, 'primer arranque: no es una caída');
});

test('el informe diario escapa el HTML de la explicación (Telegram rechaza "<" sin escapar)', () => {
    const msg = dailyReportMessage({
        ev: makeEv({ regime: 'RANGE_COMPRESSION' }),
        note: 'ADX 15.2 < 20',
        active: null,
        signals7d: 0,
        closed7d: { count: 0, sumR: 0 },
        backtest: null,
        now: new Date(Date.UTC(2026, 10, 24, 12)),
    });
    assert.match(msg, /ADX 15\.2 &lt; 20/);
    assert.doesNotMatch(msg, /15\.2 < 20/);
    assert.equal(escapeHtml('<b>&'), '&lt;b&gt;&amp;');
});

test('backtestLine avisa si el backtest no demuestra ventaja', () => {
    const base = { avgR: -0.04, ciLowR: -0.2, ciHighR: 0.12, profitFactor: 0.94, totalReturnPct: -8.9, trades: 269,
        periodStart: new Date(Date.UTC(2024, 10, 24)), periodEnd: new Date(Date.UTC(2026, 10, 24)) };
    assert.match(backtestLine(base), /Sin ventaja estadística/);
    assert.doesNotMatch(backtestLine({ ...base, avgR: 0.3, ciLowR: 0.1 }), /Sin ventaja/);
    assert.equal(backtestLine(null), '');
});
