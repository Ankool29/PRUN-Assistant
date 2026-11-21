import type { Market, Order } from '../data.ts'
import type { Itinerary } from './itinerary.ts'
import { quoteTime } from '../quoteTime.ts'
import { freshness } from '../domain.ts'

export type Costs = {
  currency: string
  rates: Readonly<Record<string, number>> // Une unité de la devise locale, en devise de référence.
  capital: number
  buyFee: number
  sellFee: number
  minQuantity: number
  maxQuantity: number
  minReturn: number
  minLiquidity: number
}

export type Level = { price: number; quantity: number }
export type Fill = { buy: number; sell: number; quantity: number }
export const EPSILON = 1e-8

export function rate(costs: Costs, currency: string) {
  if (currency === costs.currency) return 1
  const value = costs.rates[currency]
  return Number.isFinite(value) && value > 0 ? value : null
}

export function validCosts(costs: Costs) {
  return costs.capital > 0 && [
    costs.capital, costs.buyFee, costs.sellFee,
    costs.minReturn, costs.minLiquidity,
  ].every(value => Number.isFinite(value) && value >= 0)
    && costs.buyFee <= 1 && costs.sellFee < 1
    && Number.isSafeInteger(costs.minQuantity) && costs.minQuantity >= 1
    && Number.isSafeInteger(costs.maxQuantity) && costs.maxQuantity >= costs.minQuantity
}

export function knownLevels(orders: Order[], factor: number, descending = false): Level[] {
  return orders.flatMap(order => {
    const price = order.price * factor
    return Number.isFinite(price) && price > 0 && order.quantity !== null
      && Number.isSafeInteger(order.quantity) && order.quantity > 0
      ? [{ price, quantity: order.quantity }] : []
  }).sort((a, b) => descending ? b.price - a.price : a.price - b.price)
}

export function bookIsUsable(market: Market, now: number, demo: boolean) {
  return demo || freshness(market.observedAt, now) === 'fresh'
}

export function quantityWithinBudget(capital: number, spent: number, unit: number, cap: number) {
  if (unit <= 0 || cap <= 0 || spent > capital + EPSILON) return 0
  return Math.max(0, Math.min(cap, Math.floor((capital - spent + EPSILON) / unit)))
}

// Sommes des quantités publiées, avec plafond dès que le filtre est satisfait.
export function bookDepth(levels: Level[]) {
  return levels.reduce((sum, row) => Math.min(Number.MAX_SAFE_INTEGER, sum + row.quantity), 0)
}

export function totals(buy: number, sell: number, quantity: number, costs: Costs, route: Itinerary) {
  const buyFee = buy * costs.buyFee
  const sellFee = sell * costs.sellFee
  const shipping = quantity > 0 ? route.fixed + route.unit * quantity : 0
  const invested = buy + buyFee + shipping
  const gross = sell - buy
  const net = sell - sellFee - invested
  return { buy, sell, buyFee, sellFee, shipping, invested, gross, net, yield: invested > 0 ? net / invested : 0 }
}

export type Financials = ReturnType<typeof totals>

export function fillsFor(asks: Level[], bids: Level[], costs: Costs, route: Itinerary) {
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
    const unitCost = buy * (1 + costs.buyFee) + route.unit
    const marginal = sell * (1 - costs.sellFee) - unitCost
    if (!Number.isFinite(marginal)) break
    if (marginal <= 0 && (best || quantity >= costs.minQuantity)) break
    const spent = route.fixed + buyValue * (1 + costs.buyFee) + quantity * route.unit
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
      const money = totals(buyValue + buy * end, sellValue + sell * end, quantity + end, costs, route)
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

export function ageHours(market: Market, now: number, demo: boolean) {
  return demo ? 0 : Math.max(0, (now - (quoteTime(market.observedAt) ?? NaN)) / 3600_000)
}

export function priceOutOfRange(price: number, reference: number) {
  return !Number.isFinite(price) || price <= 0 || price < reference / 20 || price > reference * 20
}
