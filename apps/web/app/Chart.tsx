'use client';
import { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, CandlestickSeries, Time } from 'lightweight-charts';

export default function Chart() {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    let desmontado = false;
    let ws: WebSocket | null = null;

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

    fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=200')
      .then((res) => {
        if (!res.ok) throw new Error(`Binance respondió HTTP ${res.status}`);
        return res.json();
      })
      .then((data: (number | string)[][]) => {
        if (desmontado) return;
        candlestickSeries.setData(
          data.map((d) => ({
            time: Math.floor(Number(d[0]) / 1000) as Time,
            open: parseFloat(String(d[1])),
            high: parseFloat(String(d[2])),
            low: parseFloat(String(d[3])),
            close: parseFloat(String(d[4])),
          })),
        );

        ws = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@kline_15m');
        ws.onmessage = (event) => {
          const response = JSON.parse(event.data);
          if (response.e !== 'kline') return;
          const kline = response.k;
          candlestickSeries.update({
            time: Math.floor(kline.t / 1000) as Time,
            open: parseFloat(kline.o),
            high: parseFloat(kline.h),
            low: parseFloat(kline.l),
            close: parseFloat(kline.c),
          });
        };
      })
      .catch((e: unknown) => {
        if (!desmontado) setError(e instanceof Error ? e.message : 'No se pudo cargar el gráfico');
      });

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      desmontado = true;
      window.removeEventListener('resize', handleResize);
      ws?.close();
      chart.remove();
    };
  }, []);

  return (
    <div className="relative w-full h-full">
      <div ref={chartContainerRef} className="w-full h-full rounded-lg overflow-hidden" />
      {error && (
        <p className="absolute inset-x-0 top-4 text-center text-sm text-red-300">⚠️ {error}</p>
      )}
    </div>
  );
}
