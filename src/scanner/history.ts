import { z } from 'zod'
import type { Market, Snapshot } from '../data.ts'

export const DAY_MS = 86_400_000
export const HISTORY_WINDOW = 30
export const pairKey = (ticker: string, exchange: string) => `${ticker}.${exchange}`
const nonnegative = z.number().finite().nonnegative()
const int = nonnegative.int().safe()
const day = int.refine(value => value % DAY_MS === 0)
const code = z.string().regex(/^[A-Z0-9]+$/)
const point = z.object({ dayMs: day, close: nonnegative.positive().nullable(), units: int, turnover: nonnegative })
  .refine(row => row.units === 0 ? row.close === null : row.close !== null)
const seriesSchema = z.object({ ticker: code, exchange: code, points: z.array(point).max(HISTORY_WINDOW) })
  .refine(row => new Set(row.points.map(value => value.dayMs)).size === row.points.length)
const historySchema = z.object({
  schemaVersion: z.literal(1), source: z.literal('fio'), collectedAt: z.string().datetime({ offset: true }),
  marketCollectedAt: z.string().datetime({ offset: true }), windowDays: z.literal(HISTORY_WINDOW),
  failed: z.array(z.string()), series: z.array(seriesSchema),
}).refine(history => new Set(history.series.map(row => pairKey(row.ticker, row.exchange))).size === history.series.length)

export type DailyPoint = z.infer<typeof point>
export type HistorySeries = z.infer<typeof seriesSchema>
export type History = z.infer<typeof historySchema>

export async function loadHistory(signal: AbortSignal) {
  const response = await fetch(new URL('./data/history.json', window.location.href), { signal, cache: 'no-cache' })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return historySchema.parse(await response.json())
}

export function demoHistory(data: Snapshot, now: number): HistorySeries[] {
  const today = Math.floor(now / DAY_MS) * DAY_MS
  const variations = [0.86, 0.93, 1.03, 0.96, 1.07, 1.14, 1.02]
  return data.markets.flatMap(row => {
    if (!row.ask || !row.bid) return []
    const anchor = row.ask * (row.ticker === 'AL' ? 1.24 : 1.04)
    return [{
      ticker: row.ticker, exchange: row.exchange,
      points: Array.from({ length: HISTORY_WINDOW }, (_, i) => {
        const close = Math.round(anchor * variations[i % variations.length] * 100) / 100
        const units = 80 + (i % 6) * 18
        return { dayMs: today - (HISTORY_WINDOW - i) * DAY_MS, close, units, turnover: close * units }
      }),
    }]
  })
}

const rawDaily = z.object({
  DateEpochMs: day, Open: nonnegative.nullable(), Close: nonnegative.nullable(),
  Low: nonnegative.nullable(), High: nonnegative.nullable(), Traded: int, Volume: nonnegative,
})

export function parseDaily(payload: unknown, today: number): DailyPoint[] {
  const rows = z.array(z.object({ Interval: z.string() }).passthrough()).parse(payload)
  return rows.filter(row => row.Interval === 'DAY_ONE').map(row => rawDaily.parse(row))
    .filter(row => row.DateEpochMs >= today - HISTORY_WINDOW * DAY_MS && row.DateEpochMs < today)
    .map(row => {
      const { Open, Close, Low, High, Traded } = row
      if (Traded && (!Open || !Close || !Low || !High
        || Low > Math.min(Open, Close) || High < Math.max(Open, Close))) {
        throw new Error('Bougie FIO incohérente')
      }
      return point.parse({ dayMs: row.DateEpochMs, close: Traded ? Close : null, units: Traded, turnover: row.Volume })
    }).sort((a, b) => a.dayMs - b.dayMs)
}

export async function loadPairHistory(market: Market, now: number, signal: AbortSignal) {
  const ticker = code.parse(market.ticker)
  const exchange = code.parse(market.exchange)
  const today = Math.floor(now / DAY_MS) * DAY_MS
  const url = `https://rest.fnar.net/exchange/cxpc/${pairKey(ticker, exchange)}/${today - HISTORY_WINDOW * DAY_MS - 1}`
  const response = await fetch(url, { signal, credentials: 'omit', redirect: 'error' })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return seriesSchema.parse({ ticker, exchange, points: parseDaily(await response.json(), today) })
}
