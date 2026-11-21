import { z } from 'zod'
import type { Snapshot } from '../data.ts'
import { staticDataUrl } from '../staticData.ts'
import { bookIsUsable, knownLevels, rate, type Costs } from './execution.ts'

const positive = z.number().finite().positive()
const amount = z.number().finite().nonnegative()
const units = amount.int().safe()
export const flightQuoteSchema = z.object({
  from: z.string().min(1), to: z.string().min(1), ticker: z.string(),
  quantity: units, mode: z.enum(['stl', 'ftl', 'gateway']), minutes: positive,
  sf: units, ff: units, extra: amount, currency: z.string().min(1),
  distancePc: amount.nullable(), distanceKm: amount.nullable(), configuration: z.string().optional(),
}).refine(q => q.from !== q.to && (q.quantity ? q.ticker.length > 0 : !q.ticker)
  && (q.mode !== 'stl' || q.ff === 0))

export const shipNavigationSchema = z.object({
  stlEngine: z.string(), ftlEngine: z.string(), mass: amount.nullable(), cargoT: amount.nullable(),
  cargoM3: amount.nullable(), sfTank: units.nullable(), ffTank: units.nullable(),
  quotes: z.array(flightQuoteSchema),
})
export type FlightQuote = z.infer<typeof flightQuoteSchema>
export type ShipNavigation = z.infer<typeof shipNavigationSchema>
export const emptyNavigation: ShipNavigation = {
  stlEngine: '', ftlEngine: '', mass: null, cargoT: null, cargoM3: null,
  sfTank: null, ffTank: null, quotes: [],
}

const vector = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()])
const navSchema = z.object({
  schemaVersion: z.literal(1), source: z.literal('fio'), collectedAt: z.string().datetime({ offset: true }),
  stations: z.array(z.object({ exchange: z.string(), station: z.string(), system: z.string(), position: vector })),
  routes: z.array(z.object({ from: z.string(), to: z.string(), strategy: z.enum(['jumps', 'distance']),
    systems: z.array(z.string()).nonempty(), distancePc: amount })),
})

export type NavigationData = z.infer<typeof navSchema>
export type Flight = {
  mode: FlightQuote['mode']; minutes: number; distancePc: number | null; distanceKm: number | null
  fuel: { ticker: string; units: number; cost: number }[]; extra: number; total: number
  cargoT: number; cargoM3: number; mass: number
}
export const modes = { stl: 'STL', ftl: 'FTL conventionnel', gateway: 'Via portail' } as const

export function shipConfiguration(ship: ShipNavigation) {
  return JSON.stringify([ship.stlEngine.trim(), ship.ftlEngine.trim(), ship.mass])
}

export async function loadNavigation(signal: AbortSignal) {
  const response = await fetch(staticDataUrl('navigation.json'), { signal, cache: 'no-cache' })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return navSchema.parse(await response.json())
}

export function marketPaths(data: NavigationData | null, from: string, to: string) {
  return data?.routes.filter(route => route.from === from && route.to === to) ?? []
}

export function priceFuel(data: Snapshot, exchange: string, ticker: string, units: number, costs: Costs, now: number) {
  if (!Number.isSafeInteger(units) || units < 0) return { reason: `${ticker} : quantité de carburant invalide.` }
  if (!units) return { cost: 0 }
  const row = data.markets.find(item => item.exchange === exchange && item.ticker === ticker)
  if (!row) return { reason: `${ticker} · ${exchange} : carnet absent.` }
  if (!bookIsUsable(row, now, data.source === 'demo')) return { reason: `${ticker} · ${exchange} : carnet de carburant ancien.` }
  const conversion = rate(costs, row.currency)
  if (conversion === null) return { reason: `${ticker} · ${exchange} : taux ${row.currency} vers ${costs.currency} manquant.` }
  let remaining = units
  let value = 0
  for (const level of knownLevels(row.sells, conversion)) {
    const used = Math.min(remaining, level.quantity)
    value += used * level.price
    remaining -= used
    if (!remaining) break
  }
  const cost = value * (1 + costs.buyFee)
  return remaining || !Number.isFinite(cost) ? { reason: `${ticker} · ${exchange} : volume chiffrable insuffisant (${units} unités requises).` }
    : { cost }
}

export function createFlightPlanner(data: Snapshot, nav: NavigationData | null, ship: ShipNavigation, costs: Costs, now: number) {
  const stationSystems = new Map(nav?.stations.map(row => [row.exchange, row.system]))
  const cache = new Map<FlightQuote, ReturnType<typeof estimate>>()

  function estimate(quote: FlightQuote) {
    const missing: string[] = []
    if (quote.configuration !== undefined && quote.configuration !== shipConfiguration(ship)) {
      missing.push('Relevé SFC à mettre à jour après modification des moteurs ou de la masse.')
    }
    if (ship.mass === null || ship.mass <= 0) missing.push('Masse à vide du vaisseau.')
    if (!ship.stlEngine.trim()) missing.push('Moteur STL du vaisseau.')
    if (quote.ff && !ship.ftlEngine.trim()) missing.push('Moteur FTL du vaisseau.')
    const source = stationSystems.get(quote.from)
    const dest = stationSystems.get(quote.to)
    if (source && dest && (source === dest) !== (quote.mode === 'stl')) missing.push('Mode incompatible avec les systèmes de départ et d’arrivée.')
    if (quote.mode === 'ftl' && !quote.ff) missing.push('Quantité de FF requise pour le vol FTL conventionnel.')
    const material = data.materials.find(row => row.ticker === quote.ticker)
    const cargoT = (material?.weight ?? 0) * quote.quantity
    const cargoM3 = (material?.volume ?? 0) * quote.quantity
    if (quote.quantity) {
      if (!material) missing.push('Masse ou volume FIO du matériau absent.')
      if (ship.cargoT === null) missing.push('Capacité restante de fret en tonnes.')
      else if (cargoT > ship.cargoT + 1e-8) missing.push('Capacité de fret en tonnes dépassée.')
      if (ship.cargoM3 === null) missing.push('Capacité restante de fret en m³.')
      else if (cargoM3 > ship.cargoM3 + 1e-8) missing.push('Capacité de fret en m³ dépassée.')
    }
    const fuel: Flight['fuel'] = []
    for (const [ticker, qty, tank] of [['SF', quote.sf, ship.sfTank], ['FF', quote.ff, ship.ffTank]] as const) {
      if (!qty) continue
      if (tank === null) missing.push(`Capacité du réservoir ${ticker} en unités.`)
      else if (qty > tank) missing.push(`Capacité du réservoir ${ticker} dépassée.`)
      const priced = priceFuel(data, quote.from, ticker, qty, costs, now)
      if (priced.reason) missing.push(priced.reason)
      else if (priced.cost !== undefined) fuel.push({ ticker, units: qty, cost: priced.cost })
    }
    const conversion = quote.extra ? rate(costs, quote.currency) : 1
    if (conversion === null) missing.push(`Taux ${quote.currency} vers ${costs.currency} pour les frais.`)
    const extra = quote.extra * (conversion ?? NaN)
    const total = extra + fuel.reduce((sum, row) => sum + row.cost, 0)
    if (!Number.isFinite(total) && !missing.length) missing.push('Montant de transport non chiffrable.')
    if (missing.length) return { missing }
    const flight: Flight = { mode: quote.mode, minutes: quote.minutes, distancePc: quote.distancePc, distanceKm: quote.distanceKm,
      fuel, extra, total, cargoT, cargoM3, mass: ship.mass! + cargoT }
    return { flight }
  }

  return (from: string, to: string, ticker: string) => {
    const matching = ship.quotes.filter(row => row.from === from && row.to === to && row.ticker === ticker)
    const reasons: string[] = []
    const flights = matching.flatMap(quote => {
      const result = cache.get(quote) ?? estimate(quote)
      cache.set(quote, result)
      if (result.missing) reasons.push(...result.missing)
      return result.flight ? [{ quantity: quote.quantity, flight: result.flight }] : []
    })
    if (!matching.length) reasons.push(ticker ? `Relevé SFC chargé absent pour ${ticker}.` : 'Relevé SFC à vide absent.')
    return { flights, reasons: [...new Set(reasons)] }
  }
}

export type FlightPlanner = ReturnType<typeof createFlightPlanner>
