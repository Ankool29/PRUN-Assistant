import type { Flight, FlightPlanner } from './navigation.ts'

export type TransportRates = {
  emptyFixed: number | null
  loadedFixed: number | null
  loadedUnit: number | null
}

export type Departure = { parking: string; transport: TransportRates; planner?: FlightPlanner }
export type Leg = { from: string; to: string; kind: 'empty' | 'loaded'; fixed: number; unit: number; flight?: Flight }
export type Itinerary = { legs: Leg[]; fixed: number; unit: number }

function known(cost: number | null): cost is number {
  return cost !== null && Number.isFinite(cost) && cost >= 0
}

export function itinerary(departure: Departure, buy: string, sell: string): Itinerary | null {
  const { parking, transport } = departure
  if (!parking) return null
  const legs: Leg[] = []
  if (parking !== buy) {
    if (!known(transport.emptyFixed)) return null
    legs.push({ from: parking, to: buy, kind: 'empty', fixed: transport.emptyFixed, unit: 0 })
  }
  if (buy !== sell) {
    if (!known(transport.loadedFixed) || !known(transport.loadedUnit)) return null
    legs.push({ from: buy, to: sell, kind: 'loaded', fixed: transport.loadedFixed, unit: transport.loadedUnit })
  }
  const fixed = legs.reduce((sum, leg) => sum + leg.fixed, 0)
  return Number.isFinite(fixed) ? { legs, fixed, unit: legs.at(-1)?.unit ?? 0 } : null
}

type Choice = { route: Itinerary; quantity: number | null }

export function resolveTransport(departure: Departure, buy: string, sell: string, ticker: string): {
  choices: Choice[]; reasons: string[]
} {
  if (!departure.parking) return { choices: [], reasons: ['Marché de stationnement du vaisseau.'] }
  const reasons: string[] = []
  let choices: Choice[] = [{ route: { legs: [], fixed: 0, unit: 0 }, quantity: null }]
  const add = (from: string, to: string, kind: Leg['kind'], fixed: number | null, unit: number | null) => {
    if (from === to) return
    const quoted = departure.planner?.(from, to, kind === 'loaded' ? ticker : '') ?? { flights: [], reasons: [] }
    const variants: { leg: Leg; quantity: number | null }[] = quoted.flights.flatMap(({ flight, quantity }) => flight.total === null ? [] : [{
      leg: { from, to, kind, fixed: flight.total, unit: 0, flight },
      quantity: kind === 'loaded' ? quantity : null,
    }])
    if (!variants.length && known(fixed) && known(unit)) variants.push({ leg: { from, to, kind, fixed, unit }, quantity: null })
    if (!variants.length) reasons.push(...[...quoted.reasons,
      kind === 'empty' ? 'Forfait manuel à vide manquant.' : 'Forfait ou coût unitaire chargé manquant.',
    ].map(reason => `${from} → ${to} · ${reason}`))
    choices = choices.flatMap(choice => variants.flatMap(({ leg, quantity }) => {
      const total = choice.route.fixed + leg.fixed
      return Number.isFinite(total) ? [{
        route: { legs: [...choice.route.legs, leg], fixed: total, unit: choice.route.unit + leg.unit },
        quantity: quantity ?? choice.quantity,
      }] : []
    }))
  }
  const { transport, parking } = departure
  add(parking, buy, 'empty', transport.emptyFixed, 0)
  add(buy, sell, 'loaded', transport.loadedFixed, transport.loadedUnit)
  return { choices, reasons: reasons.length || choices.length ? reasons : ['Total du transport non chiffrable.'] }
}

export function groupByDeparture<T>(items: T[], parking: string, origin: (item: T) => string) {
  const local: T[] = []
  const reposition: T[] = []
  for (const item of items) {
    (origin(item) === parking ? local : reposition).push(item)
  }
  return { local, reposition }
}
