import type { Market, Snapshot } from '../data.ts'
import { FRESH_WINDOW_MS, freshness } from '../domain.ts'
import { bookDepth, bookIsUsable, knownLevels, priceOutOfRange, type Costs, type Level } from './execution.ts'
import type { TransportRates } from './itinerary.ts'
import { createFlightPlanner, modes, type NavigationData, type ShipNavigation } from './navigation.ts'
import { remaining } from './trade.ts'
import type { CircuitDeal, Payment } from './circuit.ts'

type Leg = { label: string; minutes: number | null; payments: Payment[]; reserved: number }
export type MarketCircuit = { deal: CircuitDeal; from: Market; to: Market; legs: Leg[] }
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
      `${from} → ${to} · relevé SFC utilisable pour ${expected} unités ou tarif manuel manquant.`,
    ] }
  }

  return (from: Market, to: Market): { circuits: MarketCircuit[]; reasons: string[] } => {
    const reject = (...reasons: string[]) => ({ circuits: [], reasons })
    if (!parking) return reject('Marché de stationnement manquant.')
    if (!demo && freshness(data.collectedAt, now) !== 'fresh') return reject('Instantané FIO ancien ou non daté.')
    if ([from, to].some(market => !bookIsUsable(market, now, demo))) return reject('Carnet FIO ancien ou non daté.')
    const material = data.materials.find(row => row.ticker === from.ticker)
    if (material && ((ship.cargoT !== null && quantity * material.weight > ship.cargoT)
      || (ship.cargoM3 !== null && quantity * material.volume > ship.cargoM3)))
      return reject('Capacité de fret dépassée.')
    const asks = priceLevels(from, false)
    const bids = priceLevels(to, true)
    if (bookDepth(asks) < Math.max(quantity, costs.minLiquidity) || bookDepth(bids) < costs.minLiquidity)
      return reject('Profondeur du carnet ou quantité d’achat insuffisante.')
    const empty = route(parking, from.exchange, '')
    const loaded = route(from.exchange, to.exchange, from.ticker)
    const sale = fill(bids, quantity)
    const unsold = quantity - sale.quantity
    const recentTrade = demo || (to.lastTradeAtMs !== null && now - to.lastTradeAtMs <= FRESH_WINDOW_MS && to.lastTradeAtMs <= now)
    const lastPrice = recentTrade && to.last && (!to.average || !priceOutOfRange(to.last, to.average)) ? to.last : null
    const circuits = empty.legs.flatMap(first => loaded.legs.flatMap(second => {
      const purchase = fill(remaining(asks, second.reserved), quantity)
      const legs = [first, second].filter(leg => leg.label)
      return purchase.quantity !== quantity ? [] : [{
        from, to, legs, deal: {
          payments: [{ currency: from.currency, amount: purchase.value * (1 + costs.buyFee),
            label: `Achat · ${from.exchange}, frais inclus` }, ...legs.flatMap(leg => leg.payments)],
          proceeds: { currency: to.currency, amount: sale.value * (1 - costs.sellFee), label: `Revente · ${to.exchange}, frais déduits` },
          purchased: quantity, sold: sale.quantity,
          remaining: { quantity: unsold, covered: lastPrice === null ? 0 : unsold, currency: to.currency,
            value: (lastPrice ?? 0) * unsold * (1 - costs.sellFee) },
        },
      }]
    }))
    if (circuits.length) return { circuits, reasons: [] }
    const reasons = [...empty.reasons, ...loaded.reasons]
    return reject(...(reasons.length ? reasons : ['Offres d’achat insuffisantes après réservation du carburant.']))
  }
}
