import type { Market } from '../data.ts'
import { ageHours, bookDepth, bookIsUsable, knownLevels, type Costs, type Fill, type Level, type Financials, priceOutOfRange, rate, validCosts } from './execution.ts'

import { type Departure, type Itinerary } from './itinerary.ts'
import { assessTrade, count, type Calculated, type Deficit, type Diagnostics, type Review } from './trade.ts'

export type SaleMode = 'immediate' | 'limit'
export type Arbitrage = {
  from: Market
  to: Market
  mode: SaleMode
  quantity: number
  liquidity: number
  risk: number
  fills: Fill[]
  money: Financials
  route: Itinerary
  alternatives: Calculated[]
}
type Book = {
  market: Market
  asks: Level[]
  bids: Level[]
  bidDepth: number
  askDepth: number
  issue: string | null
}

type Options = {
  departure: Departure; now: number; demo: boolean; mode: SaleMode; from: string; to: string; target: number | null
}

export function analyzeArbitrage(markets: Market[], costs: Costs, options: Options) {
  const opportunities: Arbitrage[] = []
  const reviews: Review[] = []
  const deficits: Deficit[] = []
  const diagnostics: Diagnostics = {}
  const output = { opportunities, reviews, deficits, diagnostics }
  if (!validCosts(costs) || (options.target !== null && (!Number.isFinite(options.target) || options.target <= 0))) return output
  const booksByTicker = new Map<string, Book[]>()
  for (const market of markets) {
    const factor = rate(costs, market.currency)
    const issue = !bookIsUsable(market, options.now, options.demo) ? 'Carnet trop ancien ou sans date'
      : factor === null ? 'Taux de change absent' : null
    const checked = (orders: Market['buys'], descending = false) => {
      const levels = issue || factor === null ? [] : knownLevels(orders, factor, descending)
      const reference = (market.average ?? market.last ?? 0) * (factor ?? 1)
      return levels.length && reference > 0 && priceOutOfRange(levels[0].price, reference) ? [] : levels
    }
    const asks = checked(market.sells)
    const bids = checked(market.buys, true)
    const book = { market, asks, bids, issue, askDepth: bookDepth(asks), bidDepth: bookDepth(bids) }
    const existing = booksByTicker.get(market.ticker)
    if (existing) existing.push(book)
    else booksByTicker.set(market.ticker, [book])
  }

  for (const books of booksByTicker.values()) {
    for (const from of books) {

      for (const to of books) {
        if (from === to) continue
        if ((options.from && options.from !== from.market.exchange) || (options.to && options.to !== to.market.exchange)) {
          count(diagnostics, 'Périmètre ou bourse filtrée'); continue
        }
        const issue = from.issue ?? to.issue
        if (issue) { count(diagnostics, issue); continue }
        const liquidity = Math.min(from.askDepth, to.bidDepth)
        const target = options.target ?? to.asks[0]?.price
        const bids = options.mode === 'immediate' ? to.bids : target
          ? [{ price: target, quantity: costs.maxQuantity }] : []
        if (!from.askDepth || !bids.length) { count(diagnostics, 'Carnet sans prix ou quantité exploitable'); continue }
        if (liquidity < costs.minLiquidity) { count(diagnostics, 'Liquidité sous le seuil'); continue }
        const result = assessTrade(from.market, to.market, from.asks, bids, costs, options.departure, diagnostics)
        if (result.review) reviews.push(result.review)
        if (result.deficit) deficits.push(result.deficit)
        if (!result.confirmed) continue
        const ageRisk = Math.max(ageHours(from.market, options.now, options.demo),
          ageHours(to.market, options.now, options.demo)) / 3
        const depthRisk = liquidity ? Math.min(1, result.confirmed.quantity / liquidity) : 1
        const risk = Math.min(100, Math.round(20 * ageRisk + 40 * depthRisk
          + (options.mode === 'limit' ? 30 : 0) + (from.market.currency !== to.market.currency ? 10 : 0)))
        opportunities.push({ from: from.market, to: to.market, mode: options.mode, liquidity, risk,
          alternatives: result.alternatives ?? [], ...result.confirmed })
      }
    }
  }
  return output
}

export function scanArbitrage(markets: Market[], costs: Costs, options: Options) {
  return analyzeArbitrage(markets, costs, options).opportunities
}
