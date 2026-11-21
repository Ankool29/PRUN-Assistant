import type { Market } from '../data.ts'
import { ageHours, bookDepth, bookIsUsable, EPSILON, knownLevels, type Costs, type Fill, type Level, type Financials, priceOutOfRange, quantityWithinBudget, rate, totals, validCosts } from './execution.ts'

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
}
type Book = {
  market: Market
  asks: Level[]
  bids: Level[]
  bidDepth: number
  askDepth: number
}

function fillsFor(asks: Level[], bids: Level[], costs: Costs) {
  let quantity = 0
  let buyValue = 0
  let sellValue = 0
  let a = 0
  let b = 0
  let askRemaining = asks[0]?.quantity ?? 0
  let bidRemaining = bids[0]?.quantity ?? 0
  const fills: Fill[] = []
  let best: { quantity: number; money: Financials; index: number; lastQuantity: number } | null = null
  while (a < asks.length && b < bids.length && quantity < costs.maxQuantity) {
    const buy = asks[a].price
    const sell = bids[b].price
    const unitCost = buy * (1 + costs.buyFee) + costs.unitTransport
    const marginal = sell * (1 - costs.sellFee) - unitCost
    if (!Number.isFinite(marginal)) break
    if (marginal <= 0 && (best || quantity >= costs.minQuantity)) break
    const spent = costs.fixedTransport + buyValue * (1 + costs.buyFee) + quantity * costs.unitTransport
    const available = Math.min(askRemaining, bidRemaining, costs.maxQuantity - quantity)
    const step = quantityWithinBudget(costs.capital, spent, unitCost, available)
    if (!step) break

    // Le bénéfice monte sur ce segment. Le rendement minimal impose une borne si sa
    // marge marginale est sous le seuil, même lorsque la quantité maximale reste rentable.
    const previousNet = sellValue * (1 - costs.sellFee) - spent
    const slack = previousNet - costs.minReturn * spent
    const slope = marginal - costs.minReturn * unitCost
    const feasibleEnd = slope < 0 ? Math.min(step, Math.floor((slack + EPSILON) / -slope)) : step
    const end = marginal > 0 ? feasibleEnd : costs.minQuantity - quantity
    if (end > 0 && end <= feasibleEnd && quantity + end >= costs.minQuantity) {
      const money = totals(buyValue + buy * end, sellValue + sell * end, quantity + end, costs, true)
      if (Number.isFinite(money.net) && money.invested <= costs.capital + EPSILON
        && money.net > EPSILON && money.net + EPSILON >= costs.minReturn * money.invested
        && (!best || money.net > best.money.net)) {
        best = { quantity: quantity + end, money, index: fills.length, lastQuantity: end }
      }
    }
    fills.push({ buy, sell, quantity: step })
    quantity += step
    buyValue += buy * step
    sellValue += sell * step
    if (step < available) break
    askRemaining -= step
    bidRemaining -= step
    if (!askRemaining) askRemaining = asks[++a]?.quantity ?? 0
    if (!bidRemaining) bidRemaining = bids[++b]?.quantity ?? 0
  }
  if (!best) return null
  return {
    quantity: best.quantity, money: best.money,
    fills: [...fills.slice(0, best.index), { ...fills[best.index], quantity: best.lastQuantity }],
  }
}

export function scanArbitrage(markets: Market[], costs: Costs, options: {
  now: number; demo: boolean; mode: SaleMode; from: string; to: string; target: number | null
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
        const result = fillsFor(from.asks, bids, costs)
        if (!result) continue
        const ageRisk = Math.max(ageHours(from.market, options.now, options.demo),
          ageHours(to.market, options.now, options.demo)) / 3
        const depthRisk = liquidity ? Math.min(1, result.quantity / liquidity) : 1
        const risk = Math.min(100, Math.round(20 * ageRisk + 40 * depthRisk
          + (options.mode === 'limit' ? 30 : 0) + (from.market.currency !== to.market.currency ? 10 : 0)))
        output.push({ from: from.market, to: to.market, mode: options.mode, liquidity, risk, ...result })
      }
    }
  }
  return output
}
