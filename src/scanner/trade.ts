import { EPSILON, fillsFor, totals, type Costs, type Fill, type Financials, type Level } from './execution.ts'
import { itinerary, resolveTransport, type Departure, type Itinerary } from './itinerary.ts'
import type { Market } from '../data.ts'

export type Diagnostics = Record<string, number>
export function count(diagnostics: Diagnostics, reason: string) {
  diagnostics[reason] = (diagnostics[reason] ?? 0) + 1
}

export type Review = {
  from: Market; to: Market; quantity: number; margin: number; reasons: string[]
}
export type Calculated = {
  quantity: number; fills: Fill[]; money: Financials; route: Itinerary
}
export type Deficit = Review & Calculated & { alternatives: Calculated[] }
const withoutTravel: Itinerary = { legs: [], fixed: 0, unit: 0 }

export function indicativeLocalTrade(asks: Level[], bids: Level[], costs: Costs) {
  const fill = fillsFor(asks, bids, { ...costs, capital: Number.MAX_VALUE }, withoutTravel)
  return fill && { quantity: fill.quantity, margin: fill.money.gross - fill.money.buyFee - fill.money.sellFee }
}

export function remaining(levels: Level[], consumed: number) {
  return levels.flatMap(row => {
    const taken = Math.min(consumed, row.quantity)
    consumed -= taken
    return row.quantity > taken ? [{ price: row.price, quantity: row.quantity - taken }] : []
  })
}

function exact(asks: Level[], bids: Level[], quantity: number, costs: Costs, route: Itinerary) {
  let needed = quantity
  let buy = 0
  let sell = 0
  const fills: Fill[] = []
  let a = 0, b = 0, availableA = asks[0]?.quantity ?? 0, availableB = bids[0]?.quantity ?? 0
  while (needed > 0 && a < asks.length && b < bids.length) {
    const taken = Math.min(needed, availableA, availableB)
    fills.push({ buy: asks[a].price, sell: bids[b].price, quantity: taken })
    buy += taken * asks[a].price
    sell += taken * bids[b].price
    needed -= taken
    availableA -= taken
    availableB -= taken
    if (!availableA) availableA = asks[++a]?.quantity ?? 0
    if (!availableB) availableB = bids[++b]?.quantity ?? 0
  }
  if (needed || quantity < costs.minQuantity || quantity > costs.maxQuantity) return null
  const money = totals(buy, sell, quantity, costs, route)
  return Number.isFinite(money.net) && money.invested <= costs.capital + EPSILON ? { quantity, fills, money, route } : null
}

function affordable(asks: Level[], bids: Level[], upper: number, costs: Costs, route: Itinerary) {
  let minimum = costs.minQuantity
  let maximum = upper
  let best: Calculated | null = null
  while (minimum <= maximum) {
    const quantity = minimum + Math.floor((maximum - minimum) / 2)
    const result = exact(asks, bids, quantity, costs, route)
    if (result) {
      best = result
      minimum = quantity + 1
    } else maximum = quantity - 1
  }
  return best
}

export function assessTrade(from: Market, to: Market, asks: Level[], bids: Level[], costs: Costs,
  departure: Departure, diagnostics: Diagnostics) {
  // La marge commerciale est calculée avant transport. Elle ne renseigne aucun bénéfice net.
  const marketOnly = fillsFor(asks, bids, costs, withoutTravel)
  if (!marketOnly) {
    const openBudget = { ...costs, capital: Number.MAX_VALUE, minReturn: 0 }
    const commercial = fillsFor(asks, bids, { ...openBudget, minQuantity: 1 }, withoutTravel)
    const quantity = commercial && fillsFor(asks, bids, openBudget, withoutTravel)
    const budget = quantity && fillsFor(asks, bids, { ...costs, minReturn: 0 }, withoutTravel)
    count(diagnostics, !commercial ? 'Marge commerciale insuffisante'
      : !quantity ? 'Quantité hors des limites'
      : !budget ? 'Capital insuffisant avant transport' : 'Rendement sous le seuil avant transport')
    return {}
  }
  const margin = marketOnly.money.gross - marketOnly.money.buyFee - marketOnly.money.sellFee
  const review = { from, to, quantity: marketOnly.quantity, margin }
  const { choices, reasons } = resolveTransport(departure, from.exchange, to.exchange, from.ticker)
  if (!choices.length) {
    count(diagnostics, 'Transport à vérifier')
    return { commercial: true, review: { ...review, reasons } }
  }

  const positives: Calculated[] = []
  const deficits: Calculated[] = []
  let failedQuote = false
  for (const choice of choices) {
    const fuel = choice.route.legs.find(leg => leg.kind === 'loaded')?.flight?.fuel ?? []
    const reserved = fuel.find(row => row.ticker === from.ticker)?.units ?? 0
    const cargoOffers = reserved ? remaining(asks, reserved) : asks
    const fixedQuantity = choice.quantity
    const result = fixedQuantity === null
      ? fillsFor(cargoOffers, bids, costs, choice.route)
      : exact(cargoOffers, bids, fixedQuantity, costs, choice.route)
    if (result && result.money.net > EPSILON && result.money.net + EPSILON >= result.money.invested * costs.minReturn) {
      positives.push({ ...result, route: choice.route })
      continue
    }
    if (fixedQuantity === null && costs.minReturn > 0
      && fillsFor(cargoOffers, bids, { ...costs, minReturn: 0 }, choice.route)) continue
    const candidate = fixedQuantity === null ? affordable(cargoOffers, bids, marketOnly.quantity, costs, choice.route) : result
    if (candidate && candidate.money.net <= EPSILON) deficits.push({ ...candidate, route: choice.route })
    if (fixedQuantity !== null && !candidate) failedQuote = true
  }
  if (failedQuote && !positives.length && !deficits.length) {
    const fallback = itinerary(departure, from.exchange, to.exchange)
    if (fallback) {
      const feasible = fillsFor(asks, bids, costs, fallback)
      if (feasible) positives.push({ ...feasible, route: fallback })
      else if (!fillsFor(asks, bids, { ...costs, minReturn: 0 }, fallback)) {
        const candidate = affordable(asks, bids, marketOnly.quantity, costs, fallback)
        if (candidate && candidate.money.net <= EPSILON) deficits.push(candidate)
      }
    }
  }
  positives.sort((a, b) => b.money.net - a.money.net)
  deficits.sort((a, b) => b.money.net - a.money.net)
  if (positives.length) return { commercial: true, confirmed: positives[0], alternatives: [...positives.slice(1), ...deficits] }
  if (deficits.length) {
    count(diagnostics, 'Déficit après transport')
    return { commercial: true, deficit: { ...review, ...deficits[0], reasons: [], alternatives: deficits.slice(1) } }
  }
  if (failedQuote || reasons.length) {
    count(diagnostics, 'Transport à vérifier')
    return { commercial: true, review: { ...review, reasons: [...new Set([...reasons,
      ...(failedQuote ? ['Quantité du relevé SFC incompatible avec le carnet, les filtres ou le capital après ravitaillement.'] : []),
    ])] } }
  }
  count(diagnostics, 'Capital, quantité ou rendement après transport')
  return { commercial: true }
}
