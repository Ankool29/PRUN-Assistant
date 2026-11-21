export type TransportRates = {
  emptyFixed: number | null
  loadedFixed: number | null
  loadedUnit: number | null
}

export type Departure = { parking: string; transport: TransportRates }
export type Leg = { from: string; to: string; kind: 'empty' | 'loaded'; fixed: number; unit: number }
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

export function groupByDeparture<T>(items: T[], parking: string, origin: (item: T) => string) {
  const local: T[] = []
  const reposition: T[] = []
  for (const item of items) {
    (origin(item) === parking ? local : reposition).push(item)
  }
  return { local, reposition }
}
