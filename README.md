# NovaDrive Trading

Generador de señales manuales para **BTCUSDT** (seguimiento de tendencia 1h/4h) con alertas por Telegram, un dashboard en Next.js y un backtester que prueba **exactamente la misma estrategia** que corre en vivo.

> ⚠️ Esto no es asesoramiento financiero. Opera primero en Testnet. Un backtest positivo no garantiza resultados futuros.

## Estructura

```
apps/
  engine/                 Motor 24/7 (Render) + backtester
    index.ts              Punto de entrada: servidor HTTP (/health) + ciclo cada 15 min
    backtester.ts         CLI del backtest
    src/
      strategy.ts         Reglas de la estrategia (compartidas entre motor en vivo y backtest)
      cycle.ts            Un ciclo del motor: velas cerradas → salidas → entradas → latido
      lifecycle.ts        Cierre de señales activas (SL / TP / fin de tendencia)
      binance.ts, telegram.ts, http.ts, db.ts, messages.ts, config.ts
      backtest/           Descarga paginada con caché, simulación, estadísticas
    test/                 Tests (node:test)
  web/                    Dashboard Next.js (Vercel)
prisma/schema.prisma      Esquema compartido de la base de datos (Supabase)
```

## Puesta en marcha

```bash
npm install
cp .env.example .env                 # rellena DATABASE_URL, DIRECT_URL y Telegram
cp .env.example apps/web/.env.local  # el dashboard solo necesita DATABASE_URL / DIRECT_URL
npm run db:generate
npm run db:push                      # crea la tabla EngineState y las columnas nuevas (cambios solo aditivos)
```

| Comando | Qué hace |
| --- | --- |
| `npm run dev:engine` | Motor en modo watch |
| `npm run start:engine` | Motor (producción) |
| `npm run dev:web` | Dashboard en http://localhost:3000 |
| `npm run backtest` | Backtest de la estrategia en vivo (730 días) |
| `npm run backtest -- --days=1095` | Backtest con más historial |
| `npm run backtest -- --strategy=sweep` | Backtest de la estrategia antigua de barrido de liquidez (15m) |
| `npm test` | Tests |
| `npm run typecheck` | Comprobación de tipos del motor |

## La estrategia

Evaluada **solo con velas cerradas** (Binance devuelve la vela en curso como última y el motor la descarta):

- **TREND_BULL** → señal LONG: precio > EMA50(4h), EMA21(1h) > EMA55(1h), ADX(1h) ≥ 22 y +DI > −DI.
- **TREND_BEAR** → señal SHORT: la condición simétrica.
- **Stop** a 1.5×ATR(1h), **objetivo** a 2R. Tamaño de la posición para arriesgar `maxRiskPerTrade`% (0.75% por defecto, con un apalancamiento máximo de 3×).
- **Salida**: SL, TP, o **fin de tendencia** (EMA21 cruza EMA55 en contra, o el precio cruza la EMA50 de 4h). Se avisa por Telegram.
- **Anti-spam con histéresis, guardado en la BD** (`EngineState`): después de una señal LONG no se repite otra LONG hasta que el mercado entra en rango (ADX < 20) o se rompe la tendencia. Que el ADX oscile entre 20 y 22 no repite la señal, y reiniciar Render tampoco.
- Se rechaza la señal (y queda en `RejectedSignal`) si el R:R neto de costes es < 1.5, si ya hay una señal activa o si la estrategia está desactivada en `StrategyConfig`.

Todo lo anterior está en `apps/engine/src/strategy.ts`, que usan tanto el motor como el backtester.

## Backtester

- Paginación por la API de Binance (por defecto 2 años de velas de 1h y 4h) y caché en `apps/engine/.cache/`.
- **Sin look-ahead**: en cada instante *t* solo se usan velas con `closeTime ≤ t` (hay un test que lo verifica).
- **Costes realistas**: comisión taker del 0.05% **sobre el nocional** en la entrada y en la salida (se gane o se pierda), y slippage en ambos lados (2 bps; 5 bps en los stops). Si una vela toca el SL y el TP a la vez, se asume el SL.
- Informe: expectativa neta en R y en % del balance, **intervalo de confianza al 95%**, profit factor, drawdown máximo, comisiones acumuladas y estabilidad entre la primera y la segunda mitad. Avisa si hay menos de 30 operaciones o si el intervalo incluye el 0.
- `--json=archivo.json` guarda todas las operaciones.

## Base de datos

| Tabla | Quién escribe | Para qué |
| --- | --- | --- |
| `MarketRegimeRecord` | motor, en cada ciclo | Latido + régimen, ADX y pendiente de la EMA50 de 4h |
| `Signal` | motor | Cada señal con su entrada, SL y TP; al cerrarse, la salida y el `pnlNet` (en R, neto de costes) |
| `RejectedSignal` | motor | Disparos descartados y el motivo |
| `StrategyConfig` | motor (la crea) / tú | `isActive = false` detiene las entradas sin redeploy; `maxRiskPerTrade` |
| `SystemHealth` | motor | Arranques y errores (Binance, Telegram, motor) |
| `EngineState` | motor | Estado del anti-spam y última vela procesada |

## Despliegue

**Motor (Render, Web Service)**
- Build: `npm install && npx prisma generate`
- Start: `npm run start:engine` (sigue funcionando el anterior: `npx tsx apps/engine/index.ts`)
- Variables: `DATABASE_URL`, `DIRECT_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
- **Plan gratuito**: Render duerme el servicio tras ~15 min sin tráfico **entrante**; el temporizador interno no cuenta. El motor hace keep-alive contra su propia URL pública (`RENDER_EXTERNAL_URL`), pero lo más fiable es un monitor externo gratuito (p. ej. UptimeRobot) que llame a `https://<tu-servicio>.onrender.com/health` cada 5 min, o un plan de pago / Background Worker. `/health` devuelve 503 si lleva más de 30 min sin completar un ciclo.

**Dashboard (Vercel)**: root `apps/web`, variables `DATABASE_URL` y `DIRECT_URL`. Muestra la hora del último registro del motor y, si tiene más de 30 min, una alerta y oculta la señal.
