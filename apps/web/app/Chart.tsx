'use client';
import { useEffect, useRef } from 'react';
import { createChart, ColorType, CandlestickSeries, Time } from 'lightweight-charts';
import { fetchKlinesBrowser, openBinanceStream } from '@/lib/binanceStream';

export default function Chart() {
  const chartContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

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

    let cerrarStream: (() => void) | null = null;
    let desmontado = false;

    fetchKlinesBrowser('BTCUSDT', '15m', 100)
      .then(data => {
        if (desmontado) return;
        candlestickSeries.setData(data.map(d => ({
          time: Math.floor(Number(d[0]) / 1000) as Time,
          open: parseFloat(String(d[1])),
          high: parseFloat(String(d[2])),
          low: parseFloat(String(d[3])),
          close: parseFloat(String(d[4])),
        })));
        cerrarStream = openBinanceStream('btcusdt@kline_15m', msg => {
          const response = msg as { e?: string; k?: { t: number; o: string; h: string; l: string; c: string } };
          if (response.e !== 'kline' || !response.k) return;
          const k = response.k;
          candlestickSeries.update({
            time: Math.floor(k.t / 1000) as Time,
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            close: parseFloat(k.c),
          });
        });
      })
      .catch(err => console.error('No se pudieron cargar las velas de Binance:', err));

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      desmontado = true;
      cerrarStream?.();
      chart.remove();
    };
  }, []);

  return <div ref={chartContainerRef} className="w-full h-full rounded-lg overflow-hidden" />;
}