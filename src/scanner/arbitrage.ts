import type { Market } from '../data.ts'
import { freshness } from '../domain.ts'
import { ageHours, bookDepth, knownLevels, type Costs, type Fill, type Level, type Financials, priceOutOfRange, rate, validCosts } from './execution.ts'
import type { Departure, Itinerary } from './itinerary.ts'
import { assessTrade, count, indicativeLocalTrade, type Calculated, type Deficit, type Diagnostics, type Review } from './trade.ts'

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

export type GrossGap = {
  from: Market
  to: Market
  purchase: number | null
  resale: number | null
  difference: number | null
  differenceCurrency: string | null
  relative: number | null
  recent: boolean
  publishedOnly: boolean
  localMarket?: { quantity: number; margin: number }
}
type Book = {
  market: Market
  asks: Level[]
  bids: Level[]
  bidDepth: number
  askDepth: number
  status: ReturnType<typeof freshness>
  factor: number | null
}
export const stageLabels = {
  total: 'Comparaisons de matériaux',
  scoped: 'Dans le périmètre des bourses',
  fresh: 'Deux carnets récents',
  prices: 'Prix et quantités exploitables',
  liquid: 'Liquidité suffisante',
  comparable: 'Prix comparables dans une même devise',
  inReference: 'Dans la devise du capital',
  assessed: 'Soumises au calcul commercial',
  commercial: 'Intéressantes avant transport',
  net: 'Net affichable, positif ou déficitaire',
} as const
export type Stages = Record<keyof typeof stageLabels, number>

type Options = {
  departure: Departure; now: number; demo: boolean; mode: SaleMode; from: string; to: string; target: number | null
  rawOnly?: boolean
}

function indicative(value: number | null) {
  return value !== null && Number.isFinite(value) && value > 0 ? value : null
}

function grossGap(from: Book, to: Book, currency: string): GrossGap | null {
  // Les niveaux issus d'ordres chiffrés priment. Le meilleur prix indicatif
  // reste consultable quand le carnet ne permet pas de vérifier la quantité.
  const purchase = from.asks[0]?.price ?? indicative(from.market.ask)
  const resale = to.bids[0]?.price ?? indicative(to.market.bid)
  if (purchase === null && resale === null) return null
  const same = from.market.currency === to.market.currency
  const comparable = same || (from.factor !== null && to.factor !== null)
  const buy = purchase === null ? null : purchase * (same ? 1 : from.factor ?? NaN)
  const sell = resale === null ? null : resale * (same ? 1 : to.factor ?? NaN)
  const gap = buy !== null && sell !== null ? sell - buy : NaN
  const difference = comparable && Number.isFinite(gap) ? gap : null
  return { from: from.market, to: to.market, purchase, resale, difference,
    differenceCurrency: difference === null ? null : same ? from.market.currency : currency,
    relative: difference === null || !buy || !Number.isFinite(difference / buy) ? null : difference / buy,
    recent: from.status === 'fresh' && to.status === 'fresh',
    publishedOnly: (purchase !== null && !from.asks.length) || (resale !== null && !to.bids.length) }
}

function convert(levels: Level[], factor: number) {
  return factor === 1 ? levels : levels.map(({ price, quantity }) => ({ price: price * factor, quantity }))
    .filter(level => Number.isFinite(level.price) && level.price > 0)
}

export function analyzeArbitrage(markets: Market[], costs: Costs, options: Options) {
  const opportunities: Arbitrage[] = []
  const reviews: Review[] = []
  const deficits: Deficit[] = []
  const gaps: GrossGap[] = []
  let localCandidates = 0
  const diagnostics: Diagnostics = {}
  const stages: Stages = {
    total: 0, scoped: 0, fresh: 0, prices: 0, liquid: 0,
    comparable: 0, inReference: 0, assessed: 0, commercial: 0, net: 0,
  }
  const financeReady = !options.rawOnly && validCosts(costs)
    && (options.target === null || (Number.isFinite(options.target) && options.target > 0))
  const booksByTicker = new Map<string, Book[]>()
  for (const market of markets) {
    const checked = (orders: Market['buys'], descending = false) => {
      const levels = knownLevels(orders, 1, descending)
      const reference = market.average ?? market.last ?? 0
      return levels.length && reference > 0 && priceOutOfRange(levels[0].price, reference) ? [] : levels
    }
    const asks = checked(market.sells)
    const bids = checked(market.buys, true)
    const book: Book = { market, asks, bids, askDepth: bookDepth(asks), bidDepth: bookDepth(bids),
      status: options.demo ? 'fresh' : freshness(market.observedAt, options.now), factor: rate(costs, market.currency) }
    const existing = booksByTicker.get(market.ticker)
    if (existing) existing.push(book)
    else booksByTicker.set(market.ticker, [book])
  }

  for (const books of booksByTicker.values()) {
    for (const from of books) {
      for (const to of books) {
        if (from === to) continue
        stages.total++
        if ((options.from && options.from !== from.market.exchange) || (options.to && options.to !== to.market.exchange)) {
          count(diagnostics, 'Périmètre ou bourse filtrée'); continue
        }
        stages.scoped++
        const gap = grossGap(from, to, costs.currency)
        if (gap) gaps.push(gap)
        if (from.status === 'unknown' || to.status === 'unknown') {
          count(diagnostics, 'Horodatage du carnet indéterminé'); continue
        }
        if (from.status === 'stale' || to.status === 'stale') {
          count(diagnostics, 'Carnet trop ancien'); continue
        }
        stages.fresh++
        const hasSale = options.mode === 'immediate' ? to.bidDepth : options.target !== null || to.askDepth
        if (!from.askDepth || !hasSale) { count(diagnostics, 'Carnet sans prix ou quantité exploitable'); continue }
        stages.prices++
        const liquidity = Math.min(from.askDepth, to.bidDepth)
        if (Number.isFinite(costs.minLiquidity) && liquidity < costs.minLiquidity) {
          count(diagnostics, 'Liquidité sous le seuil'); continue
        }
        stages.liquid++
        const sameCurrency = from.market.currency === to.market.currency
        if (!sameCurrency && (from.factor === null || to.factor === null)) {
          count(diagnostics, 'Taux de change interdevises absent'); continue
        }
        stages.comparable++
        if (sameCurrency && gap && options.mode === 'immediate' && validCosts({ ...costs, capital: 1 })) {
          const local = indicativeLocalTrade(from.asks, to.bids, costs)
          if (local) {
            localCandidates++
            gap.localMarket = local
          }
        }
        if (from.factor === null || to.factor === null) {
          count(diagnostics, 'Devise locale différente de celle du capital'); continue
        }
        const purchase = convert(from.asks, from.factor)
        const sale = convert(to.bids, to.factor)
        const localTarget = to.asks[0]?.price
        const target = options.target ?? (localTarget === undefined ? null : localTarget * to.factor)
        const bids = options.mode === 'immediate' ? sale
          : target !== null && Number.isFinite(target) && target > 0 ? [{ price: target, quantity: costs.maxQuantity }] : []
        if (financeReady && (!purchase.length || !bids.length)) {
          count(diagnostics, 'Montant converti inexploitable'); continue
        }
        stages.inReference++
        if (!financeReady) { count(diagnostics, 'Analyse financière suspendue'); continue }
        stages.assessed++
        const result = assessTrade(from.market, to.market, purchase, bids, costs, options.departure, diagnostics)
        if (result.commercial) stages.commercial++
        if (result.review) reviews.push(result.review)
        if (result.deficit) deficits.push(result.deficit)
        if (result.confirmed || result.deficit) stages.net++
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
  return { opportunities, reviews, deficits, diagnostics, gaps, stages, localCandidates }
}

export function scanArbitrage(markets: Market[], costs: Costs, options: Options) {
  return analyzeArbitrage(markets, costs, options).opportunities
}
