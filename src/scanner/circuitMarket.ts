import type { Market, Snapshot } from '../data.ts'
import { FRESH_WINDOW_MS, freshness } from '../domain.ts'
import { bookDepth, knownLevels, priceOutOfRange, type Costs, type Level } from './execution.ts'
import type { TransportRates } from './itinerary.ts'
import { createFlightPlanner, modes, type NavigationData, type ShipNavigation } from './navigation.ts'
import { remaining } from './trade.ts'
import type { CircuitDeal, Payment } from './circuit.ts'

type Leg = { label: string; minutes: number | null; payments: Payment[]; reserved: number }
export type MarketCircuit = { deal: CircuitDeal; from: Market; to: Market; legs: Leg[] }
export type CircuitQuality = ReturnType<typeof freshness> | 'demo'
type CircuitBooks = { quality: CircuitQuality; deal: CircuitDeal | null }
type CircuitReport = { commercial: CircuitBooks; circuits: MarketCircuit[]; reasons: string[]; impossible: boolean }
type Settings = {
  data: Snapshot; now: number; parking: string; ship: ShipNavigation; navigation: NavigationData | null
  transport: TransportRates; costs: Costs; quantity: number
}

function fill(levels: Level[], wanted: number) {
  let quantity = 0
  let value = 0
  for (const level of levels) {
    const used = Math.min(level.quantity, wanted - quantity)
    value += used * level.price
    quantity += used
    if (quantity === wanted) break
  }
  return { quantity, value }
}

export function marketCircuitBuilder(settings: Settings) {
  const { data, now, ship, navigation, costs, parking, transport, quantity } = settings
  const demo = data.source === 'demo'
  const planner = createFlightPlanner(data, navigation, ship, costs, now, true)
  const priceLevels = (market: Market, selling: boolean) => {
    const reference = market.average || market.last || 0
    return knownLevels(selling ? market.buys : market.sells, 1, selling)
      .filter(row => !reference || !priceOutOfRange(row.price, reference))
  }

  function route(from: string, to: string, ticker: string) {
    if (from === to) return { legs: [{ label: '', minutes: 0, payments: [], reserved: 0 }], reasons: [] }
    const expected = ticker ? quantity : 0
    const { flights, reasons } = planner(from, to, ticker)
    const legs: Leg[] = flights.filter(row => row.quantity === expected).map(({ flight }) => ({
      label: `${from} → ${to} · ${modes[flight.mode]}`, minutes: flight.minutes, payments: flight.payments,
      reserved: flight.fuel.find(row => row.ticker === ticker)?.units ?? 0,
    }))
    const fixed = ticker ? transport.loadedFixed : transport.emptyFixed
    const unit = ticker ? transport.loadedUnit : 0
    if (!legs.length && fixed !== null && unit !== null) {
      const label = `${from} → ${to} · tarif manuel`
      legs.push({ label, minutes: null, payments: [{ currency: costs.currency, amount: fixed + unit * expected, label }], reserved: 0 })
    }
    return { legs, reasons: legs.length ? [] : [
      ...reasons.map(reason => `${from} → ${to} · ${reason}`),
      `${from} → ${to} · relevé SFC ${ticker ? `chargé (${expected} × ${ticker})` : 'à vide'} ou tarif manuel manquant.`,
    ] }
  }

  const collectionQuality = freshness(data.collectedAt, now)
  const materials = new Map(data.materials.map(material => [material.ticker, material]))
  const asksByMarket = new Map<Market, Level[]>()
  const bidsByMarket = new Map<Market, Level[]>()

  return (from: Market, to: Market): CircuitReport => {
    const qualities = [collectionQuality, freshness(from.observedAt, now), freshness(to.observedAt, now)]
    const quality: CircuitQuality = demo ? 'demo' : qualities.includes('unknown') ? 'unknown'
      : qualities.includes('stale') ? 'stale' : 'fresh'
    const asks = asksByMarket.get(from) ?? priceLevels(from, false)
    const bids = bidsByMarket.get(to) ?? priceLevels(to, true)
    asksByMarket.set(from, asks)
    bidsByMarket.set(to, bids)
    const offerDepth = bookDepth(asks)
    const demandDepth = bookDepth(bids)
    const sale = fill(bids, quantity)
    const unsold = quantity - sale.quantity
    const recentTrade = demo || (to.lastTradeAtMs !== null && now - to.lastTradeAtMs <= FRESH_WINDOW_MS && to.lastTradeAtMs <= now)
    const lastPrice = recentTrade && to.last && (!to.average || !priceOutOfRange(to.last, to.average)) ? to.last : null

    function dealFor(purchase: ReturnType<typeof fill>, legs: Leg[]): CircuitDeal {
      return {
        payments: [{ currency: from.currency, amount: purchase.value * (1 + costs.buyFee),
          label: `Achat ASK · ${from.exchange}, frais inclus` }, ...legs.flatMap(leg => leg.payments)],
        proceeds: { currency: to.currency, amount: sale.value * (1 - costs.sellFee), label: `Revente BID · ${to.exchange}, frais déduits` },
        purchased: quantity, sold: sale.quantity,
        remaining: { quantity: unsold, covered: lastPrice === null ? 0 : unsold, currency: to.currency,
          value: (lastPrice ?? 0) * unsold * (1 - costs.sellFee) },
      }
    }

    const deal = offerDepth >= quantity && sale.quantity > 0 ? dealFor(fill(asks, quantity), []) : null
    let issue: string | null = null
    let blocked = false
    if (offerDepth < Math.max(quantity, costs.minLiquidity) || demandDepth < Math.max(quantity, costs.minLiquidity)) {
      const offerUnknown = offerDepth < Math.max(quantity, costs.minLiquidity)
        && from.sells.some(order => order.price > 0 && order.quantity === null)
      const demandUnknown = demandDepth < Math.max(quantity, costs.minLiquidity)
        && to.buys.some(order => order.price > 0 && order.quantity === null)
      blocked = !offerUnknown && !demandUnknown
      issue = blocked
        ? `Volume ASK/BID utilisable dans les carnets observés · ${offerDepth} à l’achat / ${demandDepth} à la revente. Quantité demandée ${quantity}, seuil de profondeur ${costs.minLiquidity}.`
        : 'Volume ASK ou BID inconnu sur au moins un niveau nécessaire. Exécution complète non démontrée.'
    }
    const commercial: CircuitBooks = { quality, deal }
    const reject = (reasons: string[], impossible = false): CircuitReport => ({ commercial, circuits: [], reasons, impossible })
    const material = materials.get(from.ticker)
    if (material && ((ship.cargoT !== null && quantity * material.weight > ship.cargoT)
      || (ship.cargoM3 !== null && quantity * material.volume > ship.cargoM3)))
      return reject(['Capacité de fret dépassée pour la quantité demandée.'], true)
    if (issue) return reject([issue], blocked)
    if (!parking) return reject(['Marché de stationnement manquant.'])
    const empty = route(parking, from.exchange, '')
    const loaded = route(from.exchange, to.exchange, from.ticker)
    if (!demo && quality !== 'fresh') return reject([...empty.reasons, ...loaded.reasons])
    const circuits = empty.legs.flatMap(first => loaded.legs.flatMap(second => {
      const purchase = fill(remaining(asks, second.reserved), quantity)
      const legs = [first, second].filter(leg => leg.label)
      return purchase.quantity !== quantity ? [] : [{ from, to, legs, deal: dealFor(purchase, legs) }]
    }))
    if (circuits.length) {
      const unknownCapacity = ship.cargoT === null || ship.cargoM3 === null
      return { commercial, circuits, impossible: false, reasons: unknownCapacity
        ? ['Capacité de fret partiellement ou non renseignée · vérifier le chargement avec le tarif manuel.'] : [] }
    }
    const reasons = [...empty.reasons, ...loaded.reasons]
    return reasons.length ? reject(reasons)
      : reject(['Offres d’achat insuffisantes après réservation du carburant pour les trajets chiffrés.'], false)
  }
}
