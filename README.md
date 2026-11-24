# NovaDrive Trading

Generador de señales manuales para **BTCUSDT** (seguimiento de tendencia 1h/4h) con alertas por Telegram, un dashboard en Next.js y un backtester que prueba **exactamente la misma estrategia** que corre en vivo.

> ⚠️ Esto no es asesoramiento financiero. Opera primero en Testnet. Un backtest positivo no garantiza resultados futuros.

## Estructura

```
apps/
  engine/                 Motor 24/7 (Render) + backtester
    index.ts              Servidor 24/7 (Render): HTTP /health + ciclo cada 15 min
    once.ts               Un solo ciclo y termina (GitHub Actions / cron)
    backtester.ts         CLI del backtest
    src/
      strategy.ts         Reglas de la estrategia (compartidas entre motor en vivo y backtest)
      cycle.ts            Un ciclo del motor: velas cerradas → salidas → entradas → latido → informe diario
      runner.ts           Candado entre procesos y alertas por fallos seguidos
      explain.ts          Explicación legible de por qué hay (o no) señal
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
npm run db:push                      # crea las tablas/columnas nuevas (cambios solo aditivos)
```

| Comando | Qué hace |
| --- | --- |
| `npm run dev:engine` | Motor en modo watch |
| `npm run start:engine` | Motor como servidor 24/7 (Render) |
| `npm run cycle` | Ejecuta un único ciclo y termina (GitHub Actions) |
| `npm run dev:web` | Dashboard en http://localhost:3000 |
| `npm run backtest` | Backtest de la estrategia en vivo (730 días) |
| `npm run backtest -- --days=1095` | Backtest con más historial |
| `npm run backtest -- --save` | Guarda el resumen en `BacktestRun` (lo muestran el dashboard y Telegram) |
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

### Resultados (BTCUSDT, 24/11/2024 → 24/11/2026, costes realistas)

| Estrategia | Operaciones | Expectativa | Retorno | Máx. DD | Profit factor |
| --- | --- | --- | --- | --- | --- |
| Tendencia 1h/4h (la que corre en vivo) | 269 | −0.04 R | −8.9% | −21.5% | 0.94 |
| Barrido de liquidez 15m (la del antiguo "+0.20%") | 586 | −0.74 R | −91.5% | −91.5% | 0.33 |

- La estrategia en vivo **no tiene ventaja demostrada**: el IC 95% de la expectativa (−0.20 R a +0.12 R) incluye el 0. Las comisiones (≈20% del balance acumulado en 2 años) se comen la pequeña ventaja bruta.
- Validación fuera de muestra: se probaron 54 combinaciones de parámetros (stop, objetivo, ADX mínimo y comisión taker/maker) eligiendo con el primer año y evaluando en el segundo. **Ninguna fue rentable en el segundo año**, así que no se cambiaron los parámetros (hacerlo sería sobreajuste).
- Úsala solo en **Testnet** hasta que una versión nueva supere la validación fuera de muestra.

## Alertas por Telegram

| Mensaje | Cuándo |
| --- | --- |
| 🟢/🔴 Nueva señal | Entrada LONG/SHORT con SL, TP, R:R neto y tamaño sugerido |
| ✅/🛑/⚠️ Cierre | La señal tocó TP o SL, o terminó la tendencia (cerrar a mercado) |
| 📋 Informe diario | Una vez al día (12:00 UTC por defecto, `DAILY_REPORT_HOUR_UTC`): régimen, **por qué no hay señal**, señales de la semana y aviso del backtest. **Si un día no llega, el motor está caído.** |
| ⚠️ Motor estuvo caído | Al volver a funcionar tras más de 90 min sin ciclos |
| ❌ / ✅ Fallos | Tras 3 ciclos seguidos con error, y cuando se recupera |

## Base de datos

| Tabla | Quién escribe | Para qué |
| --- | --- | --- |
| `MarketRegimeRecord` | motor, en cada ciclo | Latido + régimen, ADX, pendiente de la EMA50 de 4h y `note` (por qué hay o no señal) |
| `Signal` | motor | Cada señal con su entrada, SL y TP; al cerrarse, la salida y el `pnlNet` (en R, neto de costes) |
| `RejectedSignal` | motor | Disparos descartados y el motivo |
| `StrategyConfig` | motor (la crea) / tú | `isActive = false` detiene las entradas sin redeploy; `maxRiskPerTrade` |
| `SystemHealth` | motor | Arranques y errores (Binance, Telegram, motor) |
| `EngineState` | motor | Estado del anti-spam, última vela procesada, informe diario, racha de errores y candado |
| `BacktestRun` | `backtest --save` | Resumen de cada backtest guardado |

## Despliegue

### Motor — opción recomendada: GitHub Actions (gratis, no se duerme)

El workflow `.github/workflows/motor.yml` ejecuta `npm run cycle` cada 15 min. En un repo público es gratis.

1. En GitHub: **Settings → Secrets and variables → Actions → New repository secret** y crea `DATABASE_URL`, `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID` (y `DIRECT_URL` si quieres).
2. En la pestaña **Actions**, abre "Motor de señales" y pulsa **Run workflow** para probarlo.

Mientras no exista `DATABASE_URL`, el workflow termina sin hacer nada. GitHub puede retrasar varios minutos las ejecuciones programadas y desactiva los workflows programados de repos públicos tras 60 días sin actividad (se reactivan con un clic). Los logs de Actions de un repo público son públicos; los secretos aparecen enmascarados.

### Motor — Render (Web Service)

- Build: `npm install && npx prisma generate` · Start: `npm run start:engine` (o el anterior `npx tsx apps/engine/index.ts`).
- Variables: `DATABASE_URL`, `DIRECT_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
- **Plan gratuito**: Render duerme el servicio tras ~15 min sin tráfico entrante (el temporizador interno no cuenta) y limita las horas de instancia al mes. El motor hace keep-alive contra su propia URL (`RENDER_EXTERNAL_URL`), pero no es fiable: usa GitHub Actions, un monitor externo (UptimeRobot contra `/health`) o un plan de pago.
- Render y GitHub Actions pueden convivir: un candado en la base de datos impide que dos ciclos corran a la vez y dupliquen señales.

### Binance
El motor usa `data-api.binance.vision` (el endpoint oficial de solo datos de mercado, sin bloqueo geográfico) y, si falla, `api.binance.com`. Esto importa porque `api.binance.com` responde **451** desde EE. UU., donde están los servidores de GitHub Actions y las regiones de Render de Oregón y Ohio.

### Dashboard (Vercel)
Root `apps/web`, variables `DATABASE_URL` y `DIRECT_URL`. Muestra la hora del último registro del motor y, si tiene más de 30 min, una alerta y oculta la señal.
