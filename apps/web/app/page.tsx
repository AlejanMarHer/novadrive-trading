'use client';

import { useEffect, useState } from 'react';
import Chart from './Chart';
import { obtenerEstado, type EstadoMotor } from './actions';

/** Si el motor no reporta en este tiempo, los datos se consideran viejos. */
const MINUTOS_PARA_DESACTUALIZADO = 35;

type EstadoSocket = 'conectando' | 'conectado' | 'desconectado';

const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function haceCuanto(iso: string, ahora: number): string {
  const minutos = Math.max(0, Math.round((ahora - new Date(iso).getTime()) / 60_000));
  if (minutos < 1) return 'hace menos de 1 min';
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  return `hace ${horas} h ${minutos % 60} min`;
}

export default function Dashboard() {
  const [precio, setPrecio] = useState<number | null>(null);
  const [colorPrecio, setColorPrecio] = useState('text-slate-50');
  const [estadoSocket, setEstadoSocket] = useState<EstadoSocket>('conectando');

  const [estado, setEstado] = useState<EstadoMotor | null>(null);
  const [errorBD, setErrorBD] = useState(false);
  const [ahora, setAhora] = useState(() => Date.now());

  // 1. Precio en vivo (último precio negociado) con reconexión automática
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reintento: ReturnType<typeof setTimeout> | null = null;
    let activo = true;

    const conectar = () => {
      setEstadoSocket('conectando');
      ws = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@aggTrade');
      ws.onopen = () => setEstadoSocket('conectado');
      ws.onmessage = (event) => {
        const nuevo = parseFloat(JSON.parse(event.data).p);
        if (!Number.isFinite(nuevo)) return;
        setPrecio((anterior) => {
          if (anterior !== null) {
            if (nuevo > anterior) setColorPrecio('text-emerald-400');
            else if (nuevo < anterior) setColorPrecio('text-red-400');
          }
          return nuevo;
        });
      };
      ws.onclose = () => {
        setEstadoSocket('desconectado');
        if (activo) reintento = setTimeout(conectar, 5000);
      };
      ws.onerror = () => ws?.close();
    };

    conectar();
    return () => {
      activo = false;
      if (reintento) clearTimeout(reintento);
      ws?.close();
    };
  }, []);

  // 2. Estado del motor desde la base de datos (cada 30 s)
  useEffect(() => {
    const consultar = async () => {
      try {
        const datos = await obtenerEstado();
        setErrorBD(datos === null);
        if (datos) setEstado(datos);
      } catch (error) {
        console.error('Error leyendo BD:', error);
        setErrorBD(true);
      }
      setAhora(Date.now());
    };
    consultar();
    const intervalo = setInterval(consultar, 30_000);
    return () => clearInterval(intervalo);
  }, []);

  const regimen = estado?.regimen ?? null;
  const actualizadoEn = estado?.actualizadoEn ?? null;
  const desactualizado =
    !actualizadoEn || ahora - new Date(actualizadoEn).getTime() > MINUTOS_PARA_DESACTUALIZADO * 60_000;

  const colorRegimen = regimen?.includes('BULL') ? 'text-emerald-400' : regimen?.includes('BEAR') ? 'text-red-400' : 'text-yellow-400';
  const senal = estado?.senalActiva ?? null;
  const stats = estado?.estadisticas;

  const textoSocket = { conectando: 'Conectando…', conectado: 'Conexión en vivo', desconectado: 'Sin conexión (reintentando)' }[estadoSocket];
  const colorSocket = { conectando: 'bg-yellow-400', conectado: 'bg-emerald-400', desconectado: 'bg-red-400' }[estadoSocket];

  return (
    <main className="min-h-screen p-4 md:p-8 bg-slate-900 text-slate-50 font-sans">
      <header className="mb-8 border-b border-slate-800 pb-4">
        <h1 className="text-3xl font-bold tracking-tight text-emerald-400">NovaDrive Trading</h1>
        <p className="text-slate-400 mt-1">Motor de señales BTCUSDT 24/7</p>
      </header>

      {(desactualizado || errorBD) && estado !== null && (
        <div className="mb-6 rounded-lg border border-red-500/50 bg-red-900/30 p-4 text-sm text-red-200">
          ⚠️ {errorBD ? 'No se pudo leer la base de datos.' : `El motor no reporta desde ${actualizadoEn ? haceCuanto(actualizadoEn, ahora) : 'hace mucho'}.`}{' '}
          Los datos pueden estar desactualizados: no operes con ellos hasta que el motor vuelva.
        </div>
      )}

      {/* TARJETAS SUPERIORES */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
          <h2 className="text-sm text-slate-400 mb-1">Precio BTCUSDT (en vivo)</h2>
          <p className={`text-3xl font-mono font-semibold transition-colors duration-150 ${colorPrecio}`}>
            {precio !== null ? usd(precio) : 'Cargando…'}
          </p>
          <span className="text-xs text-slate-400 flex items-center mt-2">
            <span className={`w-2 h-2 rounded-full mr-2 ${colorSocket} ${estadoSocket === 'conectado' ? 'animate-pulse' : ''}`}></span>
            {textoSocket}
          </span>
        </div>

        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
          <h2 className="text-sm text-slate-400 mb-1">Régimen de mercado</h2>
          <p className={`text-xl font-bold mt-1 ${colorRegimen}`}>
            {estado === null ? (errorBD ? 'Error de conexión' : 'Consultando…') : regimen ?? 'Sin datos'}
          </p>
          <span className="text-xs text-slate-400 mt-2 block">
            ADX 1H: <span className="font-mono text-slate-300">{estado?.adx != null ? estado.adx.toFixed(2) : '--'}</span>
            {actualizadoEn && <> · Actualizado {haceCuanto(actualizadoEn, ahora)}</>}
          </span>
        </div>

        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
          <h2 className="text-sm text-slate-400 mb-1">Resultado real de las señales</h2>
          {stats && stats.cerradas > 0 && stats.rPromedio !== null ? (
            <>
              <p className={`text-3xl font-mono font-semibold ${stats.rPromedio >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {stats.rPromedio >= 0 ? '+' : ''}{stats.rPromedio.toFixed(2)}R
              </p>
              <span className="text-xs text-slate-400 mt-2 block">
                Promedio neto por señal · {stats.cerradas} cerradas · {((stats.ganadoras / stats.cerradas) * 100).toFixed(0)}% ganadoras
              </span>
            </>
          ) : (
            <>
              <p className="text-3xl font-mono font-semibold text-slate-500">--</p>
              <span className="text-xs text-slate-400 mt-2 block">Aún no hay señales cerradas</span>
            </>
          )}
        </div>
      </div>

      {/* GRÁFICO Y PANEL DE SEÑAL */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-slate-800 p-1 rounded-xl border border-slate-700 shadow-lg min-h-[400px]">
          <Chart />
        </div>

        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
          <h2 className="text-lg font-bold mb-4 border-b border-slate-700 pb-2 text-slate-200">Señal del algoritmo</h2>

          {desactualizado ? (
            <div className="p-4 rounded-lg border bg-slate-900/40 border-slate-600 text-sm text-slate-300">
              ⏸️ Sin datos recientes del motor. No hay señal confiable en este momento.
            </div>
          ) : senal ? (
            <div className={`p-4 rounded-lg border ${senal.direccion === 'LONG' ? 'bg-emerald-900/30 border-emerald-500/50' : 'bg-red-900/30 border-red-500/50'}`}>
              <div className="flex justify-between items-center mb-3">
                <span className={`px-2 py-1 rounded text-xs font-bold border ${senal.direccion === 'LONG' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-red-500/20 text-red-400 border-red-500/30'}`}>
                  {senal.direccion === 'LONG' ? '🟢 LONG (COMPRA)' : '🔴 SHORT (VENTA)'}
                </span>
                <span className="text-xs text-slate-400">{haceCuanto(senal.generadaEn, ahora)}</span>
              </div>
              <dl className="space-y-1 text-sm font-mono">
                <div className="flex justify-between"><dt className="text-slate-400">Entrada</dt><dd>{usd(senal.entrada)}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-400">Stop Loss</dt><dd className="text-red-400">{usd(senal.stopLoss)}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-400">TP1 (1R)</dt><dd className="text-emerald-400">{usd(senal.takeProfit1)}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-400">TP2 (2R)</dt><dd className="text-emerald-400">{usd(senal.takeProfit2)}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-400">R:R neto</dt><dd>{senal.riskRewardNet.toFixed(2)}</dd></div>
              </dl>
              <p className="text-xs text-slate-500 mt-3 pt-3 border-t border-slate-700/50">
                Señal en seguimiento. Llegará una alerta de cierre por Telegram cuando toque Stop/TP2 o termine la tendencia.
              </p>
            </div>
          ) : (
            <div className="p-4 rounded-lg border bg-yellow-900/30 border-yellow-500/50">
              <span className="px-2 py-1 rounded text-xs font-bold border bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
                🟡 SIN SEÑAL ACTIVA
              </span>
              <p className="text-sm text-slate-300 mt-3">Esperar. Las señales se emiten al inicio de una tendencia.</p>
            </div>
          )}

          <p className="text-xs text-slate-500 mt-4 text-center">
            El motor evalúa el mercado cada 15 minutos con velas cerradas de 1h y 4h.
          </p>
        </div>
      </div>
    </main>
  );
}
