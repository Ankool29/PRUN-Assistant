import type { Market } from '../data.ts'
import { ageHours, bookDepth, bookIsUsable, fillsFor, knownLevels, type Costs, type Fill, type Level, type Financials, priceOutOfRange, rate, validCosts } from './execution.ts'

import { itinerary, type Departure, type Itinerary } from './itinerary.ts'

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
}
type Book = {
  market: Market
  asks: Level[]
  bids: Level[]
  bidDepth: number
  askDepth: number
}

export function scanArbitrage(markets: Market[], costs: Costs, options: {
  departure: Departure; now: number; demo: boolean; mode: SaleMode; from: string; to: string; target: number | null
}): Arbitrage[] {
  if (!validCosts(costs) || (options.target !== null && (!Number.isFinite(options.target) || options.target <= 0))) return []
  const booksByTicker = new Map<string, Book[]>()
  for (const market of markets) {
    const factor = rate(costs, market.currency)
    if (factor === null || !bookIsUsable(market, options.now, options.demo)) continue
    const checked = (orders: Market['buys'], descending = false) => {
      const levels = knownLevels(orders, factor, descending)
      const reference = (market.average ?? market.last ?? 0) * factor
      return levels.length && reference > 0 && priceOutOfRange(levels[0].price, reference) ? [] : levels
    }
    const asks = checked(market.sells)
    const bids = checked(market.buys, true)
    const book = { market, asks, bids, askDepth: bookDepth(asks), bidDepth: bookDepth(bids) }
    const existing = booksByTicker.get(market.ticker)
    if (existing) existing.push(book)
    else booksByTicker.set(market.ticker, [book])
  }

  const output: Arbitrage[] = []
  for (const books of booksByTicker.values()) {
    for (const from of books) {
      if (!from.askDepth || (options.from && options.from !== from.market.exchange)) continue
      for (const to of books) {
        if (from === to || (options.to && options.to !== to.market.exchange)) continue
        const liquidity = Math.min(from.askDepth, to.bidDepth)
        if (liquidity < costs.minLiquidity) continue
        const target = options.target ?? to.asks[0]?.price
        const bids = options.mode === 'immediate' ? to.bids : target
          ? [{ price: target, quantity: costs.maxQuantity }] : []
        const route = itinerary(options.departure, from.market.exchange, to.market.exchange)
        if (!route) continue
        const result = fillsFor(from.asks, bids, costs, route)
        if (!result) continue
        const ageRisk = Math.max(ageHours(from.market, options.now, options.demo),
          ageHours(to.market, options.now, options.demo)) / 3
        const depthRisk = liquidity ? Math.min(1, result.quantity / liquidity) : 1
        const risk = Math.min(100, Math.round(20 * ageRisk + 40 * depthRisk
          + (options.mode === 'limit' ? 30 : 0) + (from.market.currency !== to.market.currency ? 10 : 0)))
        output.push({ from: from.market, to: to.market, mode: options.mode, liquidity, risk, route, ...result })
      }
    }
  }
  return output
}
