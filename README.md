# NovaDrive Trading

Motor de señales para BTCUSDT con alertas por Telegram y un dashboard en Next.js.

```
apps/engine/          Motor 24/7 (Render) + backtester
  index.ts            Ciclo cada 15 min: régimen → señales → Telegram → Supabase
  backtester.ts       Backtest de la estrategia en vivo (o de la V2 de barrido)
  lib/estrategia.ts   Reglas de la estrategia (compartidas por motor y backtest)
  lib/indicadores.ts  EMA, ATR y ADX (Wilder) sin look-ahead
  lib/simulador.ts    Simulación con comisiones sobre nominal y slippage
  lib/binance.ts      Descarga de velas (con timeout y solo velas cerradas)
  lib/telegram.ts     Envío de alertas
  test/               Tests (node:test)
apps/web/             Dashboard (Vercel)
prisma/schema.prisma  Esquema de la base de datos (Supabase)
```

## Estrategia en vivo (`regime-trend-v3`)

Evalúa solo velas **cerradas** de 1h y 4h:

| Régimen | Condición |
|---|---|
| `TREND_BULL` | cierre 1h > EMA50 4h, EMA21 1h > EMA55 1h, +DI > −DI, ADX ≥ 22 |
| `TREND_BEAR` | cierre 1h < EMA50 4h, EMA21 1h < EMA55 1h, −DI > +DI, ADX ≥ 22 |
| `RANGE_COMPRESSION` | ADX < 20 |
| `TRANSITION_CHOP` | cualquier otro caso |

Una tendencia activa se mantiene mientras el ADX siga ≥ 20 (histéresis).

- **Entrada:** al entrar en `TREND_BULL` (LONG) o `TREND_BEAR` (SHORT).
- **Stop:** 1.5 × ATR(14, 1h). **TP1:** 1R (referencia). **TP2:** 2R (objetivo).
- **Salida:** Stop, TP2 o fin de la tendencia (alerta de cierre por Telegram).
- Cada señal se guarda en la tabla `Signal` con su resultado neto en R (`pnlNet`).
- Para pausar las señales sin apagar el motor: crea una fila en `StrategyConfig` con
  `strategyName = 'regime-trend-v3'` e `isActive = false`. `maxRiskPerTrade` define el
  % de riesgo usado para sugerir el tamaño de posición.

## Puesta en marcha

```bash
npm install
cp .env.example .env              # y rellena los valores
npm run db:generate
npm test                          # tests del motor
npm run backtest                  # backtest de 365 días de la estrategia en vivo
npm run backtest -- --dias=730 --detalle
npm run backtest -- --estrategia=barrido --dias=180
npm run dev:engine                # motor en local
npm run dev:web                   # dashboard en local
```

## Despliegue

- **Motor (Render):** comando de inicio `npm run start:engine`. El plan gratuito de
  Render duerme el servicio sin tráfico entrante: configura un monitor externo
  (UptimeRobot, cron-job.org…) que llame a `https://TU-SERVICIO.onrender.com/health`
  cada 5–10 minutos. `/health` responde 503 si el motor lleva más de 30 min sin un
  ciclo correcto, así el monitor también te avisa de fallos.
- **Dashboard (Vercel):** raíz del proyecto `apps/web`, con `DATABASE_URL` y `DIRECT_URL`.
  Muestra un aviso si el motor lleva más de 35 min sin reportar.

## Aviso

Proyecto educativo. Las señales no son asesoría financiera; valida siempre con el
backtest y en Testnet antes de arriesgar dinero real.
