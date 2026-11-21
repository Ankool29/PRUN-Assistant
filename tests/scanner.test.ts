import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Market } from '../src/data.ts'
import { scanArbitrage } from '../src/scanner/arbitrage.ts'
import { groupByDeparture, itinerary } from '../src/scanner/itinerary.ts'
import { type Costs } from '../src/scanner/execution.ts'
import { DAY_MS, parseDaily, type DailyPoint } from '../src/scanner/history.ts'
import { analyzeHistory, scanSpeculation } from '../src/scanner/speculation.ts'

const now = Date.parse('2026-11-20T12:00:00.000Z')
const updated = new Date(now).toISOString()
const costs: Costs = {
  currency: 'CIS', rates: {}, capital: 1000, buyFee: 0, sellFee: 0,
  minQuantity: 1, maxQuantity: 100,
  minReturn: 0, minLiquidity: 0,
}

function market(exchange: string, overrides: Partial<Market> = {}): Market {
  return {
    ticker: 'AL', exchange, currency: 'CIS', observedAt: updated,
    lastTradeAtMs: now, bid: null, ask: null, last: null, average: null,
    marketMakerBuy: null, marketMakerSell: null, supply: 0, demand: 0, buys: [], sells: [], ...overrides,
  }
}

const from = market('CI1', { sells: [{ price: 5, quantity: 5 }, { price: 7, quantity: 6 }, { price: 10, quantity: 50 }] })
const to = market('CI2', { buys: [{ price: 8, quantity: 7 }, { price: 9, quantity: 3 }] })
const tariffs = { emptyFixed: 0, loadedFixed: 0, loadedUnit: 0 }
const options = { now, demo: false, mode: 'immediate', from: '', to: '', target: null,
  departure: { parking: 'CI1', transport: tariffs },
} as const
function withFreight(loadedFixed: number, loadedUnit: number) {
  return { ...options, departure: { ...options.departure, transport: { ...tariffs, loadedFixed, loadedUnit } } }
}

test('carnet partiel, ordre des prix et décomposition des frais', () => {
  const [result] = scanArbitrage([from, to], { ...costs, buyFee: 0.1, sellFee: 0.1 }, withFreight(1, 0.5))
  assert.equal(result.quantity, 5)
  assert.deepEqual(result.fills, [{ buy: 5, sell: 9, quantity: 3 }, { buy: 5, sell: 8, quantity: 2 }])
  assert.equal(result.money.buy, 25)
  assert.equal(result.money.sell, 43)
  assert.equal(result.money.gross, 18)
  assert.equal(result.money.buyFee, 2.5)
  assert.equal(result.money.sellFee, 4.3)
  assert.equal(result.money.shipping, 3.5)
  assert.equal(result.money.invested, 31)
  assert.ok(Math.abs(result.money.net - 7.7) < 1e-9)
})

test('le rendement minimal peut réduire la quantité et le capital inclut la logistique', () => {
  const [result] = scanArbitrage([from, to], { ...costs, minReturn: 0.5 }, options)
  assert.equal(result.quantity, 7)
  assert.equal(result.money.net, 20)
  const [capital] = scanArbitrage([from, to], { ...costs, capital: 17 }, withFreight(5, 1))
  assert.equal(capital.quantity, 2)
  assert.equal(capital.money.invested, 17)
  assert.equal(scanArbitrage([from, to], { ...costs, capital: 16.99, minQuantity: 2 }, withFreight(5, 1)).length, 0)
})

test('le simulateur reproduit les résultats d’une recherche exhaustive sur de petits carnets', () => {
  const asks = [5, 5, 5, 5, 5, 7, 7, 7, 7, 7]
  const bids = [9, 9, 9, 8, 8, 8, 8, 8, 8, 8]
  for (const minReturn of [0, 0.2, 0.4, 0.5]) for (const capital of [5, 15, 28, 53, 100]) {
    const costsCase = { ...costs, minReturn, capital, minQuantity: 2, buyFee: 0.02, sellFee: 0.05 }
    let best = null
    for (let quantity = 2; quantity <= asks.length; quantity++) {
      const buy = asks.slice(0, quantity).reduce((a, b) => a + b)
      const sell = bids.slice(0, quantity).reduce((a, b) => a + b)
      const invested = buy * 1.02 + 2 + 0.3 * quantity
      const net = sell * 0.95 - invested
      if (invested <= capital && net > 0 && net / invested >= minReturn && (!best || net > best.net)) best = { quantity, net }
    }
    const [actual] = scanArbitrage([from, to], costsCase, withFreight(2, 0.3))
    assert.equal(actual?.quantity, best?.quantity, `capital=${capital}, rendement=${minReturn}`)
    if (best) assert.ok(Math.abs(actual.money.net - best.net) < 1e-9)
  }
})

test('une quantité minimale peut inclure une unité à marge nulle ou négative', () => {
  for (const price of [8, 9]) {
    const purchase = market('CI1', { sells: [{ price: 5, quantity: 2 }, { price, quantity: 3 }] })
    const sell = market('CI2', { buys: [{ price: 8, quantity: 5 }] })
    const [result] = scanArbitrage([purchase, sell], { ...costs, minQuantity: 3 }, options)
    assert.equal(result.quantity, 3)
    assert.equal(result.money.net, 14 - price)
    assert.equal(result.fills[1].quantity, 1)
  }
})

test('rejet des frais excessifs, marchés anciens, profondeur inconnue et prix aberrants', () => {
  const no = (a: Market, b: Market, override: Partial<Costs> = {}) => assert.equal(scanArbitrage([a, b], { ...costs, ...override }, options).length, 0)
  assert.equal(scanArbitrage([from, to], costs, withFreight(50, 0)).length, 0)
  no(from, to, { minLiquidity: 11 })
  no(from, { ...to, observedAt: new Date(now - 3 * 3600_000 - 1).toISOString() })
  no({ ...from, observedAt: null }, to)
  no({ ...from, sells: [{ price: 1, quantity: null }, { price: 1, quantity: 0 }, { price: 0, quantity: 50 }] }, to)
  no({ ...from, average: 100, sells: [{ price: 0.01, quantity: 5 }] }, to)
})

test('devises distinctes, vente aux bids et limite future sont séparées', () => {
  const destination = { ...to, currency: 'NCC', buys: [], sells: [{ price: 10, quantity: 1 }] }
  assert.deepEqual(scanArbitrage([from, destination], costs, { ...options, mode: 'limit' }), [])
  const converted = { ...costs, rates: { NCC: 1.5 }, maxQuantity: 7 }
  assert.deepEqual(scanArbitrage([from, destination], converted, options), [])
  const [limit] = scanArbitrage([from, destination], converted, { ...options, mode: 'limit' })
  assert.equal(limit.quantity, 7)
  assert.equal(limit.mode, 'limit')
  assert.equal(limit.liquidity, 0)
  assert.equal(limit.fills[0].sell, 15)
  assert.equal(limit.money.sell, 105)
})

const today = Math.floor(now / DAY_MS) * DAY_MS
function daily(length = 30): DailyPoint[] {
  return Array.from({ length }, (_, index) => {
    const close = index % 2 ? 100 : 90
    return { dayMs: today - (length - index) * DAY_MS, close, units: 20, turnover: close * 20 }
  })
}

test('série mesurable, clôture aberrante et volumes nuls', () => {
  const rows = daily()
  rows[0] = { ...rows[0], close: 10_000 }
  rows[1] = { ...rows[1], close: null, units: 0, turnover: 0 }
  const report = analyzeHistory(rows, now)
  assert.ok(report.stats)
  assert.ok(Math.abs(report.stats.mean - 95) < 1e-9)
  assert.equal(report.stats.median, 95)
  assert.equal(report.stats.outliers, 1)
  assert.equal(report.stats.medianUnits, 20)
  assert.ok(report.stats.volatility > 0)
  assert.ok(report.stats.trend > 0)
  assert.deepEqual(report.stats.prices, [90, 95, 100])
  const zero = daily().map(row => ({ ...row, close: null, units: 0 }))
  assert.match(analyzeHistory(zero, now).reason ?? '', /Moins de 14/)
})

test('historique troué, trop court ou ancien et bougie du jour incomplète', () => {
  assert.match(analyzeHistory(daily(13), now).reason ?? '', /Moins de 14/)
  assert.match(analyzeHistory(daily().slice(0, 25), now).reason ?? '', /ancien/)
  assert.match(analyzeHistory(daily().filter((_, i) => i % 2), now).reason ?? '', /voisins/)
  const raw = (date: number, interval = 'DAY_ONE') => ({
    DateEpochMs: date, Interval: interval, Open: 9, Close: 10, Low: 7, High: 10, Volume: 90, Traded: 10,
  })
  assert.deepEqual(parseDaily([raw(today - DAY_MS), raw(today), raw(today + 1, 'MINUTE_FIVE')], today),
    [{ dayMs: today - DAY_MS, close: 10, units: 10, turnover: 90 }])
  assert.throws(() => parseDaily([{ ...raw(today - DAY_MS), High: 8 }], today))
})

test('scénarios spéculatifs calculés sur un achat réel du carnet et capital limité', () => {
  const entry = market('CI1', { sells: [{ price: 75, quantity: 10 }, { price: 80, quantity: 20 }] })
  const history = [{ ticker: 'AL', exchange: 'CI1', points: daily() }]
  const result = scanSpeculation([entry], history, { ...costs, capital: 990, buyFee: 0.1, sellFee: 0.05 }, options)
  assert.equal(result.usable, 1)
  const [item] = result.opportunities
  assert.equal(item.quantity, 11)
  assert.deepEqual(item.levels, [{ price: 75, quantity: 10 }, { price: 80, quantity: 1 }])
  assert.deepEqual(item.scenarios.map(item => item.price), [90, 95, 100])
  assert.ok(item.scenarios[0].money.net < item.scenarios[1].money.net)
  assert.ok(item.scenarios[1].money.net < item.scenarios[2].money.net)
  const scan = (entry: Market, c: Costs = costs) => scanSpeculation([entry], history, c, options).opportunities
  assert.equal(scan(entry, { ...costs, minLiquidity: 21 }).length, 0)
  assert.equal(scan(entry, { ...costs, capital: 74 }).length, 0)
  assert.equal(scan(entry, { ...costs, sellFee: 0.4 }).length, 0)
  assert.equal(scan({ ...entry, observedAt: null }).length, 0)
  assert.equal(scan({ ...entry, sells: [{ price: 0.01, quantity: 10 }] }).length, 0)
  assert.equal(scanSpeculation([entry], [], costs, options).uncovered, 1)
})

test('un trajet est évalué depuis le stationnement, avec zéro uniquement s’il est explicite', () => {
  const transport = { emptyFixed: null, loadedFixed: 3, loadedUnit: 1 }
  assert.deepEqual(itinerary({ parking: 'CI1', transport }, 'CI1', 'CI2')?.legs.map(row => row.kind), ['loaded'])
  assert.equal(itinerary({ parking: 'CI2', transport }, 'CI1', 'CI2'), null)
  assert.equal(itinerary({ parking: '', transport }, 'CI1', 'CI2'), null)
  assert.equal(itinerary({ parking: 'CI1', transport: { ...transport, loadedUnit: null } }, 'CI1', 'CI2'), null)
  assert.deepEqual(itinerary({ parking: 'CI1', transport }, 'CI1', 'CI1'), { legs: [], fixed: 0, unit: 0 })
  const explicit = itinerary({ parking: 'CI2', transport: { ...transport, emptyFixed: 0 } }, 'CI1', 'CI2')
  assert.deepEqual(explicit?.legs.map(row => [row.from, row.to, row.kind, row.fixed]), [
    ['CI2', 'CI1', 'empty', 0], ['CI1', 'CI2', 'loaded', 3],
  ])
})

test('l’arbitrage déduit le trajet à vide et le trajet chargé du capital et du bénéfice', () => {
  const departure = { parking: 'AI1', transport: { emptyFixed: 4, loadedFixed: 2, loadedUnit: 1 } }
  const [result] = scanArbitrage([from, to], { ...costs, capital: 30 }, { ...options, departure })
  assert.equal(result.quantity, 4)
  assert.equal(result.money.shipping, 10)
  assert.equal(result.money.invested, 30)
  assert.equal(result.money.net, 5)
  assert.equal(scanArbitrage([from, to], { ...costs, capital: 30, minQuantity: 5 }, { ...options, departure }).length, 0)
  assert.equal(scanArbitrage([from, to], costs, { ...options, departure: {
    ...departure, transport: { ...departure.transport, emptyFixed: null },
  } }).length, 0)
})

test('la spéculation utilise l’historique de destination et facture chaque segment à chaque scénario', () => {
  const purchase = market('CI1', { sells: [{ price: 75, quantity: 10 }] })
  const betterRemote = market('AI1', { sells: [{ price: 70, quantity: 10 }] })
  const destination = market('CI2')
  const snapshots = [betterRemote, purchase, destination]
  const series = [{ ticker: 'AL', exchange: 'CI2', points: daily() }]
  const departure = { parking: 'CI1', transport: { emptyFixed: 5, loadedFixed: 7, loadedUnit: 2 } }
  const results = scanSpeculation(snapshots, series, costs, { ...options, departure, to: 'CI2' }).opportunities
  assert.equal(results.length, 2)
  assert.equal(results[0].from.exchange, 'AI1')
  assert.equal(results[0].to.exchange, 'CI2')
  const groups = groupByDeparture(results, 'CI1', row => row.from.exchange)
  assert.equal(groups.local[0].scenarios[1].money.shipping, 27)
  assert.ok(groups.reposition[0].scenarios.every(row => row.money.shipping === 32))
  assert.equal(groups.reposition[0].scenarios[1].money.net, 218)
  assert.equal(groups.reposition[0].route.legs.length, 2)
  const knownOnly = scanSpeculation(snapshots, series, costs, { ...options, departure: {
    ...departure, transport: { ...departure.transport, emptyFixed: null },
  } }).opportunities
  assert.deepEqual(knownOnly.map(row => row.from.exchange), ['CI1'])
  const limited = scanSpeculation(snapshots, series, { ...costs, capital: 242 }, {
    ...options, departure, from: 'CI1', to: 'CI2',
  }).opportunities[0]
  assert.equal(limited.quantity, 3)
  assert.equal(limited.scenarios[1].money.invested, 238)
})
