import type { Market, Order } from '../data.ts'
import { freshness } from '../domain.ts'

export type Costs = {
  currency: string
  rates: Readonly<Record<string, number>> // Une unité de la devise locale, en devise de référence.
  capital: number
  buyFee: number
  sellFee: number
  fixedTransport: number
  unitTransport: number
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
    costs.capital, costs.buyFee, costs.sellFee, costs.fixedTransport, costs.unitTransport,
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

export function totals(buy: number, sell: number, quantity: number, costs: Costs, transport: boolean) {
  const buyFee = buy * costs.buyFee
  const sellFee = sell * costs.sellFee
  const shipping = transport && quantity > 0 ? costs.fixedTransport + costs.unitTransport * quantity : 0
  const invested = buy + buyFee + shipping
  const gross = sell - buy
  const net = sell - sellFee - invested
  return { buy, sell, buyFee, sellFee, shipping, invested, gross, net, yield: invested > 0 ? net / invested : 0 }
}

export type Financials = ReturnType<typeof totals>

export function ageHours(market: Market, now: number, demo: boolean) {
  return demo ? 0 : Math.max(0, (now - Date.parse(market.observedAt ?? '')) / 3600_000)
}

export function priceOutOfRange(price: number, reference: number) {
  return !Number.isFinite(price) || price <= 0 || price < reference / 20 || price > reference * 20
}
