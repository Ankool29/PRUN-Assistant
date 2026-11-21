import type { Market } from '../data.ts'
import { ageHours, bookIsUsable, knownLevels, type Costs, type Financials, type Level, priceOutOfRange, rate, totals, validCosts } from './execution.ts'
import { DAY_MS, HISTORY_WINDOW, pairKey, type DailyPoint, type HistorySeries } from './history.ts'

import { type Departure, type Itinerary } from './itinerary.ts'
import { assessTrade, count, type Calculated, type Deficit, type Diagnostics, type Review } from './trade.ts'

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
  from: Market
  to: Market
  route: Itinerary
  alternatives: Calculated[]
  quantity: number
  discount: number
  liquidity: number
  risk: number
  levels: Level[]
  stats: HistoryStats
  scenarios: { price: number; money: Financials }[]
}

export function scanSpeculation(markets: Market[], history: HistorySeries[], costs: Costs, options: {
  now: number; demo: boolean; departure: Departure; from: string; to: string
}) {
  const opportunities: Speculation[] = []
  const reviews: Review[] = []
  const deficits: Deficit[] = []
  const diagnostics: Diagnostics = {}
  const insufficient: { market: Market; reason: string }[] = []
  if (!validCosts(costs)) return { opportunities, reviews, deficits, diagnostics, insufficient, usable: 0, stale: 0, uncovered: markets.length }
  const byPair = new Map(history.map(row => [pairKey(row.ticker, row.exchange), row.points]))
  const purchases = new Map<string, { market: Market; asks: Level[] }[]>()
  for (const market of markets) {
    if (options.from && market.exchange !== options.from) { count(diagnostics, 'Périmètre ou bourse filtrée'); continue }
    const factor = rate(costs, market.currency)
    if (!bookIsUsable(market, options.now, options.demo)) { count(diagnostics, 'Carnet trop ancien ou sans date'); continue }
    if (factor === null) { count(diagnostics, 'Taux de change absent'); continue }
    const asks = knownLevels(market.sells, factor)
    if (!asks.length) { count(diagnostics, 'Carnet sans prix ou quantité exploitable'); continue }
    const entry = { market, asks }
    const existing = purchases.get(market.ticker)
    if (existing) existing.push(entry)
    else purchases.set(market.ticker, [entry])
  }

  let usable = 0
  let stale = 0
  let uncovered = 0
  for (const market of markets) {
    if (options.to && market.exchange !== options.to) { count(diagnostics, 'Bourse de revente filtrée'); continue }
    const points = byPair.get(pairKey(market.ticker, market.exchange))
    if (!points) { uncovered++; count(diagnostics, 'Historique absent'); continue }
    const result = analyzeHistory(points, options.now)
    if (result.reason) { insufficient.push({ market, reason: result.reason }); count(diagnostics, 'Historique insuffisant'); continue }
    const stats = result.stats!
    const factor = rate(costs, market.currency)
    if (factor === null) { count(diagnostics, 'Taux de change absent'); continue }
    if (!bookIsUsable(market, options.now, options.demo)) { stale++; count(diagnostics, 'Carnet trop ancien ou sans date'); continue }
    usable++
    if (stats.medianUnits < costs.minLiquidity || stats.medianUnits < costs.minQuantity) { count(diagnostics, 'Liquidité sous le seuil'); continue }
    const reference = stats.median * factor
    if (!Number.isFinite(reference) || reference <= 0 || stats.threshold >= 1) continue
    const ceiling = reference * (1 - stats.threshold)
    const resale = [{ price: reference, quantity: Math.floor(stats.medianUnits) }]
    for (const { market: from, asks } of purchases.get(market.ticker) ?? []) {
      // Un prix anormal au meilleur niveau rend l’entrée douteuse.
      if (priceOutOfRange(asks[0].price, reference)) { count(diagnostics, 'Prix aberrant'); continue }
      const assessment = assessTrade(from, market, asks.filter(row => row.price <= ceiling), resale, costs, options.departure, diagnostics)
      if (assessment.review) reviews.push(assessment.review)
      if (assessment.deficit) deficits.push(assessment.deficit)
      const entry = assessment.confirmed
      if (!entry) continue
      const route = entry.route
      const scenarios = stats.prices.map(value => ({
        price: value * factor,
        money: totals(entry.money.buy, value * factor * entry.quantity, entry.quantity, costs, route),
      }))
      if (!scenarios.every(item => Number.isFinite(item.money.net))) continue
      const discount = 1 - entry.money.buy / entry.quantity / reference
      const loss = Math.min(1, Math.max(0, -scenarios[0].money.yield))
      const age = Math.max(ageHours(from, options.now, options.demo), ageHours(market, options.now, options.demo))
      const risk = Math.min(100, Math.round(15 * age / 3
        + 25 * entry.quantity / stats.medianUnits + 25 * Math.min(1, stats.volatility / 0.2)
        + 15 * (1 - stats.pricedDays / HISTORY_WINDOW) + 20 * loss))
      opportunities.push({ from, to: market, route, quantity: entry.quantity,
        levels: entry.fills.map(fill => ({ price: fill.buy, quantity: fill.quantity })), discount,
        stats, risk, liquidity: stats.medianUnits, scenarios, alternatives: assessment.alternatives ?? [] })
    }
  }
  return { opportunities, reviews, deficits, diagnostics, insufficient, usable, stale, uncovered }
}
