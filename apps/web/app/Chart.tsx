'use client';
import { useEffect, useRef } from 'react';
import { createChart, ColorType, CandlestickSeries, Time } from 'lightweight-charts';

export default function Chart() {
  const chartContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // 1. Configuramos el lienzo del gráfico
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#1e293b' }, 
        textColor: '#94a3b8', 
      },
      grid: {
        vertLines: { color: '#334155' },
        horzLines: { color: '#334155' },
      },
      width: chartContainerRef.current.clientWidth,
      height: 400,
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
      },
    });

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#34d399', 
      downColor: '#f87171', 
      borderVisible: false,
      wickUpColor: '#34d399',
      wickDownColor: '#f87171',
    });

    let ws: WebSocket | null = null;

    // 2. Descargamos el historial (El Pasado)
    fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=100')
      .then(res => res.json())
      .then(data => {
        const formattedData = data.map((d: any) => ({
          time: Math.floor(d[0] / 1000) as Time, 
          open: parseFloat(d[1]),
          high: parseFloat(d[2]),
          low: parseFloat(d[3]),
          close: parseFloat(d[4]),
        }));
        
        // Pintamos las 100 velas históricas
        candlestickSeries.setData(formattedData);

        // 3. LA MAGIA: Nos conectamos al flujo en vivo (El Presente/Futuro)
        ws = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@kline_15m');
        
        ws.onmessage = (event) => {
          const response = JSON.parse(event.data);
          if (response.e === 'kline') {
            const kline = response.k;
            // Actualizamos dinámicamente la última vela del gráfico
            candlestickSeries.update({
              time: Math.floor(kline.t / 1000) as Time,
              open: parseFloat(kline.o),
              high: parseFloat(kline.h),
              low: parseFloat(kline.l),
              close: parseFloat(kline.c),
            });
          }
        };
      });

    // 4. Adaptabilidad de pantalla
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    // Limpieza al cerrar la pestaña
    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      if (ws) ws.close(); // Cerramos el socket para no gastar memoria
    };
  }, []);

  return <div ref={chartContainerRef} className="w-full h-full rounded-lg overflow-hidden" />;
}