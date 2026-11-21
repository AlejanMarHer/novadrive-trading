'use client';

import { useEffect, useRef, useState } from 'react';
import Chart from './Chart';
import { obtenerEstadoDashboard, type DashboardData } from './actions';
import { formatAge, isStale, minutesSince, STALE_AFTER_MINUTES } from '@/lib/freshness';

type SocketStatus = 'conectando' | 'conectado' | 'desconectado';

const SOCKET_LABEL: Record<SocketStatus, { text: string; dot: string; color: string }> = {
  conectando: { text: 'Conectando…', dot: 'bg-yellow-400 animate-pulse', color: 'text-yellow-400' },
  conectado: { text: 'Conexión en vivo', dot: 'bg-emerald-400 animate-pulse', color: 'text-emerald-400' },
  desconectado: { text: 'Sin conexión — reintentando', dot: 'bg-red-400', color: 'text-red-400' },
};

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Activa',
  CLOSED_TP: 'TP',
  CLOSED_SL: 'SL',
  CLOSED_EXIT: 'Salida',
};

const usd = (x: number) => `$${x.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fecha = (iso: string) => new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
const signedR = (r: number) => `${r >= 0 ? '+' : ''}${r.toFixed(2)} R`;

/** Precio del ÚLTIMO TRADE (aggTrade), no el ask del libro. Reconecta solo y refleja el estado real del socket. */
function usePrecioEnVivo() {
  const [precio, setPrecio] = useState<number | null>(null);
  const [direccion, setDireccion] = useState<'up' | 'down' | null>(null);
  const [estado, setEstado] = useState<SocketStatus>('conectando');
  const ultimo = useRef<number | null>(null);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reintento: ReturnType<typeof setTimeout> | null = null;
    let intentos = 0;
    let cerrado = false;

    const conectar = () => {
      setEstado('conectando');
      ws = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@aggTrade');
      ws.onopen = () => {
        intentos = 0;
        setEstado('conectado');
      };
      ws.onmessage = event => {
        const data = JSON.parse(event.data);
        ultimo.current = parseFloat(data.p);
      };
      ws.onclose = () => {
        if (cerrado) return;
        setEstado('desconectado');
        reintento = setTimeout(conectar, Math.min(30_000, 1000 * 2 ** intentos++));
      };
      ws.onerror = () => ws?.close();
    };
    conectar();

    // Limitamos los renders a 4 por segundo (aggTrade puede enviar decenas de mensajes por segundo).
    const tick = setInterval(() => {
      const p = ultimo.current;
      if (p === null) return;
      setPrecio(prev => {
        if (prev !== null && p !== prev) setDireccion(p > prev ? 'up' : 'down');
        return p;
      });
    }, 250);

    return () => {
      cerrado = true;
      clearInterval(tick);
      if (reintento) clearTimeout(reintento);
      ws?.close();
    };
  }, []);

  return { precio, direccion, estado };
}

export default function Dashboard() {
  const { precio, direccion, estado } = usePrecioEnVivo();
  const [datos, setDatos] = useState<DashboardData | null>(null);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const consultar = async () => {
      try {
        setDatos(await obtenerEstadoDashboard());
      } catch (error) {
        console.error('Error leyendo BD:', error);
        setDatos(prev => (prev ? { ...prev, error: 'Error de conexión con el servidor' } : null));
      }
    };
    consultar();
    const intervalo = setInterval(consultar, 15_000);
    return () => clearInterval(intervalo);
  }, []);

  // Reloj para recalcular la antigüedad de los datos aunque no lleguen datos nuevos.
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);

  const regimen = datos?.regimen ?? null;
  const edadMin = now !== null ? minutesSince(regimen?.timestamp, now) : null;
  const desactualizado = datos !== null && now !== null && isStale(regimen?.timestamp, now);
  const senal = desactualizado ? null : datos?.senalActiva ?? null;
  const rend = datos?.rendimiento;

  const colorRegimen = !regimen || desactualizado
    ? 'text-slate-400'
    : regimen.regime.includes('BULL') ? 'text-emerald-400' : regimen.regime.includes('BEAR') ? 'text-red-400' : 'text-yellow-400';
  const colorPrecio = direccion === 'up' ? 'text-emerald-400' : direccion === 'down' ? 'text-red-400' : 'text-slate-50';
  const socket = SOCKET_LABEL[estado];

  return (
    <main className="min-h-screen p-4 md:p-8 bg-slate-900 text-slate-50 font-sans">
      <header className="mb-6 border-b border-slate-800 pb-4">
        <h1 className="text-3xl font-bold tracking-tight text-emerald-400">NovaDrive Trading</h1>
        <p className="text-slate-400 mt-1">Motor de señales BTCUSDT · tendencia 1h/4h</p>
      </header>

      {/* ALERTAS */}
      {desactualizado && (
        <div role="alert" className="mb-6 p-4 rounded-xl border border-red-500/60 bg-red-950/60 text-red-200">
          <p className="font-bold">⚠️ Datos desactualizados: el motor no reporta {edadMin === null ? 'ningún registro' : formatAge(edadMin)}.</p>
          <p className="text-sm mt-1">
            El motor escribe cada 15 min; más de {STALE_AFTER_MINUTES} min sin registros indica que está caído o dormido.
            No operes con la información de esta página hasta que se recupere.
          </p>
        </div>
      )}
      {datos?.error && (
        <div role="alert" className="mb-6 p-4 rounded-xl border border-red-500/60 bg-red-950/60 text-red-200 text-sm">
          ❌ {datos.error}
        </div>
      )}
      {datos?.ultimoError && !desactualizado && (
        <div className="mb-6 p-3 rounded-xl border border-yellow-600/40 bg-yellow-950/30 text-yellow-200 text-xs">
          Último error del motor ({datos.ultimoError.component}, {fecha(datos.ultimoError.timestamp)}): {datos.ultimoError.message ?? 'sin detalle'}
        </div>
      )}

      {/* TARJETAS SUPERIORES */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
          <h2 className="text-sm text-slate-400 mb-1">BTCUSDT · último precio negociado</h2>
          <p className={`text-3xl font-mono font-semibold transition-colors duration-150 ${colorPrecio}`}>
            {precio !== null ? usd(precio) : 'Cargando…'}
          </p>
          <span className={`text-xs flex items-center mt-2 ${socket.color}`}>
            <span className={`w-2 h-2 rounded-full mr-2 ${socket.dot}`}></span>
            {socket.text}
          </span>
        </div>

        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
          <h2 className="text-sm text-slate-400 mb-1">Régimen de mercado (motor)</h2>
          <p className={`text-xl font-bold mt-1 ${colorRegimen}`}>
            {datos === null ? 'Consultando…' : regimen ? regimen.regime : 'Sin datos'}
          </p>
          <span className="text-xs text-slate-400 mt-2 block">
            ADX 1H: <span className="font-mono text-slate-300">{regimen?.adx1h != null ? regimen.adx1h.toFixed(2) : '--'}</span>
            {' · '}Pendiente EMA50 4H:{' '}
            <span className="font-mono text-slate-300">{regimen?.emaSlope4h != null ? `${regimen.emaSlope4h.toFixed(3)}%` : '--'}</span>
          </span>
          <span className={`text-xs mt-1 block ${desactualizado ? 'text-red-400 font-semibold' : 'text-slate-500'}`}>
            Último registro: {regimen ? `${fecha(regimen.timestamp)} (${formatAge(edadMin)})` : '—'}
          </span>
        </div>

        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
          <h2 className="text-sm text-slate-400 mb-1">Rendimiento real de las señales</h2>
          {!rend || rend.cerradas === 0 ? (
            <>
              <p className="text-xl font-semibold text-slate-400 mt-1">Sin señales cerradas</p>
              <span className="text-xs text-slate-500 mt-2 block">Se calculará con las señales registradas en la tabla Signal.</span>
            </>
          ) : (
            <>
              <p className={`text-3xl font-mono font-semibold ${rend.expectativaR! >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {signedR(rend.expectativaR!)}
                <span className="text-sm text-slate-400 font-sans font-normal"> / señal</span>
              </p>
              <span className="text-xs text-slate-400 mt-2 block">
                {rend.cerradas} cerradas · win rate {(rend.winRate! * 100).toFixed(0)}% · total {signedR(rend.sumaR)} (neto de comisiones)
              </span>
              {rend.cerradas < 30 && (
                <span className="text-xs text-yellow-400 mt-1 block">Muestra insuficiente (&lt;30): todavía no es concluyente.</span>
              )}
            </>
          )}
        </div>
      </div>

      {/* GRÁFICO Y PANEL DE SEÑALES */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-slate-800 p-1 rounded-xl border border-slate-700 shadow-lg min-h-[400px]">
          <Chart />
        </div>

        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
          <h2 className="text-lg font-bold mb-4 border-b border-slate-700 pb-2 text-slate-200">Señal del algoritmo</h2>

          {desactualizado ? (
            <div className="p-4 rounded-lg border bg-slate-900/60 border-red-500/50">
              <span className="px-2 py-1 rounded text-xs font-bold border bg-red-500/20 text-red-300 border-red-500/30">
                ⛔ SIN DATOS RECIENTES
              </span>
              <p className="text-sm text-slate-300 mt-4">
                No se puede saber si hay una señal vigente. Revisa el motor en Render antes de operar.
              </p>
            </div>
          ) : senal ? (
            <div className={`p-4 rounded-lg border ${senal.direction === 'LONG' ? 'bg-emerald-900/30 border-emerald-500/50' : 'bg-red-900/30 border-red-500/50'}`}>
              <div className="flex justify-between items-center mb-3">
                <span className={`px-2 py-1 rounded text-xs font-bold border ${senal.direction === 'LONG' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-red-500/20 text-red-400 border-red-500/30'}`}>
                  {senal.direction === 'LONG' ? '🟢 LONG (COMPRA)' : '🔴 SHORT (VENTA)'}
                </span>
                <span className="text-xs text-slate-500">Emitida {fecha(senal.generatedAt)}</span>
              </div>
              <dl className="space-y-1 text-sm font-mono">
                <div className="flex justify-between"><dt className="text-slate-400 font-sans">Entrada (ref.)</dt><dd>{usd(senal.entryPrice)}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-400 font-sans">Stop Loss</dt><dd className="text-red-400">{usd(senal.stopLoss)}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-400 font-sans">Take Profit</dt><dd className="text-emerald-400">{usd(senal.takeProfit)}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-400 font-sans">R:R neto</dt><dd>{senal.riskRewardNet.toFixed(2)}</dd></div>
              </dl>
            </div>
          ) : (
            <div className="p-4 rounded-lg border bg-yellow-900/20 border-yellow-500/40">
              <span className="px-2 py-1 rounded text-xs font-bold border bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
                🟡 SIN SEÑAL ACTIVA
              </span>
              <p className="text-sm text-slate-300 mt-4">Esperar. El motor avisará por Telegram cuando haya entrada o salida.</p>
            </div>
          )}

          {datos && datos.ultimasSenales.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-semibold text-slate-300 mb-2">Últimas señales</h3>
              <ul className="text-xs space-y-1">
                {datos.ultimasSenales.map(s => (
                  <li key={s.id} className="flex justify-between text-slate-400">
                    <span>{fecha(s.generatedAt)} · <span className={s.direction === 'LONG' ? 'text-emerald-400' : 'text-red-400'}>{s.direction}</span></span>
                    <span className="font-mono">
                      {STATUS_LABEL[s.status] ?? s.status}
                      {s.pnlNet != null && <span className={s.pnlNet >= 0 ? 'text-emerald-400' : 'text-red-400'}> {signedR(s.pnlNet)}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-xs text-slate-500 mt-6 text-center pt-3 border-t border-slate-700/50">
            El motor evalúa velas de 1h/4h ya cerradas cada 15 minutos.
          </p>
        </div>
      </div>
    </main>
  );
}
