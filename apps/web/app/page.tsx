'use client';

import { useState, useEffect } from 'react';
import Chart from './Chart';
import { obtenerUltimoRegimen } from './actions'; // Importamos el puente a la BD

export default function Dashboard() {
  const [precio, setPrecio] = useState<string>("Cargando...");
  const [colorPrecio, setColorPrecio] = useState<string>("text-slate-50");
  
  // Nuevos estados para la Base de Datos
  const [regimen, setRegimen] = useState<string>("Consultando BD...");
  const [adx, setAdx] = useState<number | null>(null);

  // 1. WebSocket del Precio
  useEffect(() => {
    const ws = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@bookTicker');
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      const nuevoPrecio = parseFloat(data.a).toFixed(2); 
      setPrecio((precioAnterior) => {
        if (precioAnterior !== "Cargando...") {
          if (parseFloat(nuevoPrecio) > parseFloat(precioAnterior)) setColorPrecio("text-emerald-400");
          else if (parseFloat(nuevoPrecio) < parseFloat(precioAnterior)) setColorPrecio("text-red-400");
        }
        return nuevoPrecio;
      });
    };
    return () => ws.close();
  }, []);

  // 2. Consulta Automática a Supabase (Cada 10 segundos)
  useEffect(() => {
    const consultarBaseDeDatos = async () => {
      const datos = await obtenerUltimoRegimen();
      if (datos) {
        setRegimen(datos.regime);
        setAdx(datos.adx1h);
      } else {
        setRegimen("Sin datos en la nube");
      }
    };

    consultarBaseDeDatos(); // Consulta inicial
    const intervalo = setInterval(consultarBaseDeDatos, 10000); // Polling cada 10s
    return () => clearInterval(intervalo);
  }, []);

  // Elegimos el color de la tarjeta según el régimen detectado
  const colorRegimen = regimen.includes('BULL') ? 'text-emerald-400' : regimen.includes('BEAR') ? 'text-red-400' : 'text-yellow-400';

  return (
    <main className="min-h-screen p-4 md:p-8 bg-slate-900 text-slate-50 font-sans">
      
      <header className="mb-8 border-b border-slate-800 pb-4">
        <h1 className="text-3xl font-bold tracking-tight text-emerald-400">NovaDrive Trading</h1>
        <p className="text-slate-400 mt-1">Motor Cuantitativo BTCUSDT 24/7</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
          <h2 className="text-sm text-slate-400 mb-1">Precio BTCUSDT (En vivo)</h2>
          <p className={`text-3xl font-mono font-semibold transition-colors duration-150 ${colorPrecio}`}>
            {precio !== "Cargando..." ? `$${precio}` : precio}
          </p>
          <span className="text-xs text-emerald-400 flex items-center mt-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 mr-2 animate-pulse"></span>
            Conexión Socket Activa
          </span>
        </div>
        
        {/* TARJETA VIVA: CONECTADA A SUPABASE */}
        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
          <h2 className="text-sm text-slate-400 mb-1">Régimen de Mercado (Nube)</h2>
          <p className={`text-xl font-bold mt-1 ${colorRegimen}`}>{regimen}</p>
          <span className="text-xs text-slate-400 mt-2 block">
            ADX 1H Actual: <span className="font-mono text-slate-300">{adx ? adx.toFixed(2) : '--'}</span>
          </span>
        </div>
        
        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
          <h2 className="text-sm text-slate-400 mb-1">Expectativa Neta (V2)</h2>
          <p className="text-3xl font-mono font-semibold text-emerald-400">+0.20%</p>
          <span className="text-xs text-slate-400 mt-2 block">Filtro Multitemporal Activo</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        <div className="lg:col-span-2 bg-slate-800 p-1 rounded-xl border border-slate-700 shadow-lg min-h-[400px]">
          <Chart />
        </div>

        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
          <h2 className="text-lg font-bold mb-4 border-b border-slate-700 pb-2 text-slate-200">Últimas Decisiones</h2>
          
          <div className="space-y-4">
            <div className="bg-slate-900/50 p-4 rounded-lg border border-emerald-900/50">
              <div className="flex justify-between items-center mb-2">
                <span className="bg-emerald-500/20 text-emerald-400 px-2 py-1 rounded text-xs font-bold border border-emerald-500/30">LONG APROBADA</span>
                <span className="text-xs text-slate-500">Backtest V2</span>
              </div>
              <div className="space-y-1 mt-3">
                <p className="text-sm text-slate-300 flex justify-between"><span>Entrada:</span> <span className="font-mono">$81,062.2</span></p>
                <p className="text-sm text-slate-300 flex justify-between"><span>Take Profit:</span> <span className="font-mono text-emerald-400">$81,800.0</span></p>
              </div>
            </div>
          </div>
        </div>

      </div>
    </main>
  );
}