import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { Market, Snapshot } from '../src/data.ts'
import { analyzeArbitrage } from '../src/scanner/arbitrage.ts'
import type { Costs } from '../src/scanner/execution.ts'
import { createFlightPlanner, emptyNavigation, priceFuel, type FlightQuote } from '../src/scanner/navigation.ts'

const time = '2026-11-21T19:16:57.000Z'
const now = Date.parse(time)
const costs: Costs = { currency: 'CIS', rates: {}, capital: 10_000, buyFee: 0.01, sellFee: 0.01,
  minQuantity: 1, maxQuantity: 1000, minReturn: 0, minLiquidity: 1 }
function market(exchange: string, ticker: string, overrides: Partial<Market>): Market {
  return { exchange, ticker, observedAt: time, lastTradeAtMs: now, currency: 'CIS', bid: null, ask: null,
    average: null, last: null, marketMakerBuy: null, marketMakerSell: null, supply: 0, demand: 0,
    buys: [], sells: [], ...overrides }
}

const purchase = market('CI2', 'AL', { sells: [{ price: 100, quantity: 10 }] })
const sale = market('CI1', 'AL', { buys: [{ price: 200, quantity: 10 }] })
const sf = market('CI2', 'SF', { sells: [{ price: 3, quantity: 5 }, { price: 4, quantity: 5 }, { price: 1, quantity: null }] })
const ff = market('CI2', 'FF', { sells: [{ price: 10, quantity: 4 }] })
const raw = JSON.parse(readFileSync(new URL('../public/data/fio.json', import.meta.url), 'utf8')) as Snapshot
const data = { ...raw, markets: [purchase, sale, sf, ff] }
const transport = { emptyFixed: null, loadedFixed: null, loadedUnit: null }
const options = { from: 'CI2', to: '', now, demo: false, mode: 'immediate', target: null, departure: { parking: 'CI2', transport } } as const
const quote: FlightQuote = { from: 'CI2', to: 'CI1', ticker: 'AL', quantity: 10, mode: 'ftl',
  minutes: 120, sf: 10, ff: 4, extra: 11, currency: 'CIS', distanceKm: null, distancePc: 71 }
const profile = { ...emptyNavigation, mass: 500, cargoT: 1000, cargoM3: 1000, stlEngine: 'SFC', ftlEngine: 'SFC',
  sfTank: 100, ffTank: 100, quotes: [quote] }

test('avant transport, aucune piste à vérifier ne contient un bénéfice net', () => {
  const result = analyzeArbitrage([purchase, sale], costs, options)
  assert.equal(result.opportunities.length, 0)
  assert.equal(result.reviews[0].margin, 970)
  assert.ok(!('money' in result.reviews[0]))
  assert.equal(result.diagnostics['Transport à vérifier'], 1)
  assert.equal(result.diagnostics['Périmètre ou bourse filtrée'], 1)
  assert.equal(analyzeArbitrage([purchase, { ...sale, observedAt: null }], costs, options)
    .diagnostics['Carnet trop ancien ou sans date'], 1)
  assert.equal(analyzeArbitrage([purchase, { ...sale, buys: [] }], costs, options)
    .diagnostics['Carnet sans prix ou quantité exploitable'], 1)
  assert.equal(analyzeArbitrage([purchase, sale], { ...costs, minLiquidity: 11 }, options)
    .diagnostics['Liquidité sous le seuil'], 1)
  assert.equal(analyzeArbitrage([purchase, sale], { ...costs, capital: 99 }, options)
    .diagnostics['Capital insuffisant avant transport'], 1)
})

test('prix du carburant par niveaux, devises, profondeur, durée et déficit', () => {
  assert.equal(priceFuel(data, 'CI2', 'SF', 10, costs, now).cost, 35.35)
  assert.match(priceFuel(data, 'CI2', 'SF', 11, costs, now).reason ?? '', /volume/)
  assert.match(priceFuel(data, 'CI2', 'SF', 5, { ...costs, currency: 'NCC' }, now).reason ?? '', /taux/)
  assert.equal(priceFuel(data, 'CI2', 'SF', 10, { ...costs, currency: 'NCC', rates: { CIS: 2 } }, now).cost, 70.7)
  assert.match(priceFuel({ ...data, markets: [{ ...sf, observedAt: null }] }, 'CI2', 'SF', 10, costs, now).reason ?? '', /ancien/)
  const analyze = (quotes: FlightQuote[]) => analyzeArbitrage([purchase, sale], costs, {
    ...options, departure: { ...options.departure, planner: createFlightPlanner(data, null, { ...profile, quotes }, costs, now) },
  })
  const [found] = analyze([quote, { ...quote, mode: 'gateway', minutes: 70, extra: 100 }]).opportunities
  assert.equal(found.money.shipping, 86.75)
  assert.equal(found.money.net, 883.25)
  assert.equal(found.route.legs[0].flight?.minutes, 120)
  assert.equal(found.alternatives[0].route.legs[0].flight?.minutes, 70)
  assert.equal(analyze([{ ...quote, extra: 1000 }]).deficits[0].money.net, -105.75)
})

test('deux segments facturés avec un relevé distinct par départ et vérification des capacités', () => {
  const dataWithEmpty = { ...data, markets: [...data.markets, { ...sf, exchange: 'NC2' }, { ...ff, exchange: 'NC2' }] }
  const empty = { ...quote, from: 'NC2', to: 'CI2', quantity: 0, ticker: '', minutes: 70 }
  const analyzer = (cargoT: number, quotes: FlightQuote[]) => analyzeArbitrage([purchase, sale], costs, {
    ...options, departure: { parking: 'NC2', transport,
      planner: createFlightPlanner(dataWithEmpty, null, { ...profile, cargoT, quotes }, costs, now) },
  })
  const [result] = analyzer(1000, [quote, empty]).opportunities
  assert.equal(result.money.shipping, 173.5)
  assert.deepEqual(result.route.legs.map(leg => [leg.kind, leg.flight?.minutes]), [['empty', 70], ['loaded', 120]])
  assert.match(analyzer(0, [quote, empty]).reviews[0].reasons.join(' '), /Capacité de fret/)
  assert.match(analyzer(1000, [quote]).reviews[0].reasons.join(' '), /SFC à vide/)
})

test('le fret de carburant partage les niveaux avec le ravitaillement de départ', () => {
  const sellSf = { ...sale, ticker: 'SF', buys: [{ price: 100, quantity: 10 }] }
  const buySf = { ...sf, sells: [{ price: 3, quantity: 10 }, { price: 12, quantity: 10 }] }
  const shared = { ...data, markets: [buySf, ff, sellSf] }
  const planner = createFlightPlanner(shared, null, { ...profile, quotes: [{ ...quote, ticker: 'SF' }] }, costs, now)
  const [result] = analyzeArbitrage([buySf, sellSf], costs, { ...options, departure: { ...options.departure, planner } }).opportunities
  assert.equal(result.money.buy, 120)
  assert.deepEqual(result.fills, [{ buy: 12, sell: 100, quantity: 10 }])
})

test('reproduction du défaut M1.1 sur le carnet FIO réel FEO entre Arclight et Benten', () => {
  const captured = JSON.parse(readFileSync(new URL('./fixtures/m12-fio-feo.json', import.meta.url), 'utf8'))
  const report = analyzeArbitrage(captured.markets, { ...costs, capital: 100_000 }, {
    ...options, now: Date.parse(captured.evaluatedAt),
  })
  assert.equal(report.opportunities.length, 0)
  assert.equal(report.reviews.length, 1)
  assert.ok(Math.abs(report.reviews[0].margin - 6853.86) < 0.01)
})
