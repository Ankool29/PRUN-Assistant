import type { Market } from '../data.ts'
import { ageHours, bookIsUsable, EPSILON, knownLevels, type Costs, type Financials, type Level, priceOutOfRange, quantityWithinBudget, rate, totals, validCosts } from './execution.ts'
import { DAY_MS, HISTORY_WINDOW, pairKey, type DailyPoint, type HistorySeries } from './history.ts'

const MIN_PRICED_DAYS = 14
const MIN_CONSECUTIVE_RETURNS = 7

export function quantile(sorted: number[], p: number) {
  const index = (sorted.length - 1) * p
  const low = Math.floor(index)
  return sorted[low] + (sorted[Math.ceil(index)] - sorted[low]) * (index - low)
}

export function analyzeHistory(points: DailyPoint[], now: number) {
  const today = Math.floor(now / DAY_MS) * DAY_MS
  const days = points.filter(row => row.dayMs >= today - HISTORY_WINDOW * DAY_MS && row.dayMs < today)
    .sort((a, b) => a.dayMs - b.dayMs)
  const observed = days.filter((row): row is DailyPoint & { close: number } =>
    row.close !== null && Number.isFinite(row.close) && row.close > 0 && row.units > 0)
  if (observed.length < MIN_PRICED_DAYS) return { reason: `Moins de ${MIN_PRICED_DAYS} jours négociés.` } as const
  const sorted = observed.map(row => row.close).sort((a, b) => a - b)
  const center = quantile(sorted, 0.5)
  const mad = quantile(sorted.map(value => Math.abs(value - center)).sort((a, b) => a - b), 0.5)
  const guard = Math.max(6 * 1.4826 * mad, center * 0.15)
  const cleaned = observed.filter(row => Math.abs(row.close - center) <= guard && !priceOutOfRange(row.close, center))
  if (cleaned.length < MIN_PRICED_DAYS) return { reason: 'Trop peu de jours après exclusion des prix aberrants.' } as const
  const lastDay = cleaned.at(-1)!.dayMs
  if (today - lastDay > 3 * DAY_MS) return { reason: 'Dernier jour négocié valide trop ancien.' } as const

  const returns = cleaned.slice(1).flatMap((row, i) => row.dayMs - cleaned[i].dayMs === DAY_MS
    ? [Math.log(row.close) - Math.log(cleaned[i].close)] : [])
  if (returns.length < MIN_CONSECUTIVE_RETURNS) return { reason: 'Jours voisins insuffisants pour mesurer la volatilité.' } as const

  const prices = cleaned.map(row => row.close).sort((a, b) => a - b)
  const median = quantile(prices, 0.5)
  const mean = prices.reduce((sum, value) => sum + value / prices.length, 0)
  const meanReturn = returns.reduce((sum, value) => sum + value, 0) / returns.length
  const volatility = Math.sqrt(returns.reduce((sum, value) => sum + (value - meanReturn) ** 2, 0) / (returns.length - 1))
  const x = cleaned.map(row => (row.dayMs - cleaned[0].dayMs) / DAY_MS)
  const xMean = x.reduce((sum, value) => sum + value, 0) / x.length
  const slope = cleaned.reduce((sum, row, i) => sum + (x[i] - xMean) * Math.log(row.close), 0)
    / x.reduce((sum, value) => sum + (value - xMean) ** 2, 0)

  // Les zéros observés sont inclus. Les jours manquants et les bougies aberrantes sont exclus.
  const valid = new Set(cleaned.map(row => row.dayMs))
  const volumeDays = days.filter(row => row.units === 0 || valid.has(row.dayMs))
  const units = volumeDays.map(row => row.units).sort((a, b) => a - b)
  const medianUnits = quantile(units, 0.5)
  const turnover = volumeDays.reduce((sum, row) => sum + row.turnover / volumeDays.length, 0)
  const dispersion = 1.4826 * quantile(prices.map(value => Math.abs(value - median)).sort((a, b) => a - b), 0.5) / median
  return { stats: {
    mean, median, volatility, trend: Math.expm1(slope), medianUnits, turnover, lastDay,
    pricedDays: cleaned.length, observedDays: days.length, outliers: observed.length - cleaned.length,
    threshold: Math.max(0.05, 1.5 * dispersion),
    prices: [quantile(prices, 0.2), median, quantile(prices, 0.8)] as [number, number, number],
  } } as const
}

export type HistoryStats = NonNullable<ReturnType<typeof analyzeHistory>['stats']>
export type Speculation = {
  market: Market
  quantity: number
  discount: number
  liquidity: number
  risk: number
  levels: Level[]
  stats: HistoryStats
  scenarios: { price: number; money: Financials }[]
}

function fillEntry(levels: Level[], entryCeiling: number, historyVolume: number, costs: Costs) {
  const max = Math.min(costs.maxQuantity, Math.floor(historyVolume))
  const chosen: Level[] = []
  let quantity = 0
  let value = 0
  for (const order of levels) {
    if (order.price > entryCeiling || quantity === max) break
    const step = quantityWithinBudget(costs.capital, value * (1 + costs.buyFee),
      order.price * (1 + costs.buyFee), Math.min(order.quantity, max - quantity))
    if (!step) break
    chosen.push({ price: order.price, quantity: step })
    quantity += step
    value += order.price * step
    if (step < order.quantity) break
  }
  return { quantity, value, chosen }
}

export function scanSpeculation(markets: Market[], history: HistorySeries[], costs: Costs, options: { now: number; demo: boolean }) {
  const opportunities: Speculation[] = []
  const insufficient: { market: Market; reason: string }[] = []
  if (!validCosts(costs)) return { opportunities, insufficient, usable: 0, stale: 0, uncovered: markets.length }
  const byPair = new Map(history.map(row => [pairKey(row.ticker, row.exchange), row.points]))
  let usable = 0
  let stale = 0
  let uncovered = 0
  for (const market of markets) {
    const points = byPair.get(pairKey(market.ticker, market.exchange))
    if (!points) { uncovered++; continue }
    const result = analyzeHistory(points, options.now)
    if (result.reason) { insufficient.push({ market, reason: result.reason }); continue }
    const stats = result.stats!
    const factor = rate(costs, market.currency)
    if (factor === null) continue
    if (!bookIsUsable(market, options.now, options.demo)) { stale++; continue }
    usable++
    if (stats.medianUnits < costs.minLiquidity || stats.medianUnits < costs.minQuantity) continue
    const reference = stats.median * factor
    if (!Number.isFinite(reference) || reference <= 0 || stats.threshold >= 1) continue
    const ceiling = Math.min(reference * (1 - stats.threshold),
      reference * (1 - costs.sellFee) / ((1 + costs.buyFee) * (1 + costs.minReturn)))
    const allLevels = knownLevels(market.sells, factor)
    // Une offre anormale au sommet met en doute l’exécution de toute entrée sur ce carnet.
    if (!allLevels.length || priceOutOfRange(allLevels[0].price, reference)) continue
    const entry = fillEntry(allLevels, ceiling, stats.medianUnits, costs)
    if (entry.quantity < costs.minQuantity) continue
    const scenarios = stats.prices.map(value => ({
      price: value * factor, money: totals(entry.value, value * factor * entry.quantity, entry.quantity, costs, false),
    }))
    if (!scenarios.every(item => Number.isFinite(item.money.net))) continue
    if (scenarios[1].money.net <= EPSILON || scenarios[1].money.yield + EPSILON < costs.minReturn) continue
    const discount = 1 - entry.value / entry.quantity / reference
    const loss = Math.min(1, Math.max(0, -scenarios[0].money.yield))
    const risk = Math.min(100, Math.round(15 * ageHours(market, options.now, options.demo) / 3
      + 25 * entry.quantity / stats.medianUnits + 25 * Math.min(1, stats.volatility / 0.2)
      + 15 * (1 - stats.pricedDays / HISTORY_WINDOW) + 20 * loss))
    opportunities.push({ market, quantity: entry.quantity, levels: entry.chosen, discount, stats,
      risk, liquidity: stats.medianUnits, scenarios })
  }
  return { opportunities, insufficient, usable, stale, uncovered }
}
