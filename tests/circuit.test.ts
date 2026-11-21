import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { Market, Snapshot } from '../src/data.ts'
import { evaluateCircuit, type CircuitInput } from '../src/scanner/circuit.ts'
import { marketCircuitBuilder } from '../src/scanner/circuitMarket.ts'
import { scanCircuits } from '../src/scanner/circuitScan.ts'
import { createFxDesk, fxQuoteSchema, type FxQuote } from '../src/scanner/fxBook.ts'
import { emptyNavigation, type ShipNavigation } from '../src/scanner/navigation.ts'
import type { Costs } from '../src/scanner/execution.ts'

const observedAt = '2026-11-21T21:00:00Z'
const now = Date.parse(observedAt)
const cis: FxQuote = {
  base: 'CIS', reference: 'AIC', observedAt, bid: { rate: 1.8, lots: 3 }, ask: { rate: 2, lots: 1 }, fee: 0, fixedFee: 10,
}
const rates = { 'CIS/AIC': cis }
const input: CircuitInput = {
  deal: {
    payments: [{ currency: 'CIS', amount: 1000, label: 'Achat' }],
    proceeds: { currency: 'CIS', amount: 3000, label: 'Revente' },
    purchased: 10, sold: 10, remaining: { quantity: 0, covered: 0, currency: 'CIS', value: 0 },
  },
  reference: 'AIC', capital: 5000, holdings: {}, mode: 'close', rates, now,
}

test('FXOB exécute les deux sens aux cours distincts, avec frais et profondeur propres', () => {
  const desk = createFxDesk({ 'CIS/AIC': { ...cis, fee: 0.01 } }, 'AIC', now)
  assert.equal(desk.execute('CIS', 'ask', 2), null)
  assert.equal(desk.execute('CIS', 'ask', 0.5), null)
  assert.deepEqual(desk.execute('CIS', 'ask', 1), { base: 'CIS', side: 'ask', lots: 1, rate: 2, fee: 30, cash: 2030 })
  assert.equal(desk.execute('CIS', 'ask', 1), null)
  assert.deepEqual(desk.execute('CIS', 'bid', 3), { base: 'CIS', side: 'bid', lots: 3, rate: 1.8, fee: 64, cash: 5336 })
  assert.equal(desk.execute('CIS', 'bid', 1), null)
  assert.equal(createFxDesk(rates, 'CIS', now).execute('AIC', 'ask', 1), null)
  assert.equal(createFxDesk(rates, 'AIC', now + 3 * 3600_000 + 1).execute('CIS', 'bid', 1), null)
  assert.equal(fxQuoteSchema.safeParse({ ...cis, ask: { rate: 1.7, lots: 1 } }).success, false)
})

test('le circuit fermé rembourse les lots à la vente et compare le résultat au change direct frais inclus', () => {
  const result = evaluateCircuit(input)
  assert.ok(!('reason' in result))
  assert.equal(result.final, 8380)
  assert.equal(result.delta, 3380)
  assert.equal(result.benchmarkBudget, 2010)
  assert.deepEqual(result.benchmark, { destination: 1000, cash: 1790, remainder: 0, final: 1790, fees: 20 })
  assert.equal(result.advantage, 3600)
  assert.deepEqual(result.conversions.map(fill => [fill.side, fill.lots]), [['ask', 1], ['bid', 3]])
})

test('les marchés peuvent utiliser des devises distinctes, sans conversion effective si les soldes suffisent', () => {
  const ncc: FxQuote = { ...cis, base: 'NCC', bid: { rate: 1.5, lots: 10 }, ask: null }
  const deal = { ...input.deal,
    payments: [...input.deal.payments, { currency: 'AIC', amount: 100, label: 'Vol' }],
    proceeds: { ...input.deal.proceeds, currency: 'NCC' },
  }
  const mixed = { ...input, deal, rates: { ...rates, 'NCC/AIC': ncc } }
  const closed = evaluateCircuit(mixed)
  assert.ok(!('reason' in closed))
  assert.equal(closed.final, 7380)
  assert.equal(closed.delta, 2380)
  assert.deepEqual(closed.conversions.map(fill => [fill.base, fill.side]), [['CIS', 'ask'], ['NCC', 'bid']])
  const held = evaluateCircuit({ ...mixed, mode: 'hold', holdings: { CIS: 3000 } })
  assert.ok(!('reason' in held))
  assert.equal(held.margin, 2380)
  assert.equal(held.final, null)
  assert.deepEqual(held.wallet, { AIC: 4900, CIS: 2000, NCC: 3000 })
  assert.deepEqual(held.conversions, [])
  const unknown = evaluateCircuit({ ...mixed, mode: 'hold', rates, holdings: { CIS: 3000 } })
  assert.ok(!('reason' in unknown))
  assert.equal(unknown.margin, null)
  assert.equal(unknown.wallet.NCC, 3000)
})

test('les soldes incomplets, le fret invendu et son estimation restent séparés du capital fermé', () => {
  const deal = { ...input.deal, sold: 3, proceeds: { ...input.deal.proceeds, amount: 1500 },
    remaining: { quantity: 7, covered: 7, currency: 'CIS', value: 500 } }
  const result = evaluateCircuit({ ...input, deal })
  assert.ok(!('reason' in result))
  assert.equal(result.final, null)
  assert.equal(result.delta, null)
  assert.equal(result.wallet.AIC, 4780)
  assert.deepEqual(result.residual, [{ currency: 'CIS', amount: 500, value: 890 }])
  assert.equal(result.stockValue, 890)
  const noDepth = evaluateCircuit({ ...input, rates: { 'CIS/AIC': { ...cis, bid: { rate: 1.8, lots: 1 } } } })
  assert.ok(!('reason' in noDepth))
  assert.equal(noDepth.final, null)
  assert.equal(noDepth.residual[0].amount, 2000)
  assert.equal(noDepth.residual[0].value, null)
  const noCapital = evaluateCircuit({ ...input, capital: 2000 })
  assert.ok('reason' in noCapital)
  assert.match(noCapital.reason, /insuffisant/)
  assert.ok('reason' in evaluateCircuit({ ...input, rates: {} }))
})

const raw = JSON.parse(readFileSync(new URL('../public/data/fio.json', import.meta.url), 'utf8')) as Snapshot
const base = { currency: 'AIC', rates: {}, capital: 5000, buyFee: 0.01, sellFee: 0.01,
  minQuantity: 1, maxQuantity: 100, minReturn: 0, minLiquidity: 1 } satisfies Costs

test('deux trajets SFC paient le ravitaillement et les frais dans leurs devises natives', () => {
  function market(exchange: string, ticker: string, currency: string, orders: Partial<Market>) {
    return { ...raw.markets[0], exchange, ticker, currency, observedAt, lastTradeAtMs: now, last: null, average: null, ...orders }
  }
  const from = market('CI1', 'SF', 'CIS', { sells: [{ price: 10, quantity: 2 }, { price: 30, quantity: 5 }] })
  const to = market('NC1', 'SF', 'NCC', { buys: [{ price: 500, quantity: 5 }], last: 450 })
  const fuel = market('AI1', 'SF', 'AIC', { sells: [{ price: 20, quantity: 3 }] })
  const ship: ShipNavigation = { ...emptyNavigation, stlEngine: 'STL', mass: 80, cargoT: 1000, cargoM3: 1000,
    sfTank: 50, quotes: [
      { from: 'AI1', to: 'CI1', ticker: '', quantity: 0, mode: 'gateway', minutes: 20, sf: 3, ff: 0,
        extra: 30, currency: 'ICA', distancePc: null, distanceKm: null },
      { from: 'CI1', to: 'NC1', ticker: 'SF', quantity: 5, mode: 'gateway', minutes: 40, sf: 2, ff: 0,
        extra: 7, currency: 'NCC', distancePc: null, distanceKm: null },
    ],
  }
  const data = { ...raw, collectedAt: observedAt, markets: [from, to, fuel] }
  const transport = { emptyFixed: null, loadedFixed: null, loadedUnit: null }
  const build = marketCircuitBuilder({ data, now, parking: 'AI1', ship, navigation: null, transport, costs: base, quantity: 5 })
  const report = build(from, to)
  assert.equal(report.reasons.length, 0)
  const [circuit] = report.circuits
  assert.deepEqual(circuit.legs.map(leg => leg.minutes), [20, 40])
  assert.deepEqual(circuit.deal.payments.map(row => [row.currency, row.amount]),
    [['CIS', 151.5], ['AIC', 60.6], ['ICA', 30], ['CIS', 20.2], ['NCC', 7]])
  assert.equal(circuit.deal.proceeds.amount, 2475)
  const partial = build(from, { ...to, buys: [{ price: 500, quantity: 3 }] })
  assert.equal(partial.impossible, true)
  assert.deepEqual(partial.commercial.deal?.remaining, { quantity: 2, covered: 2, currency: 'NCC', value: 891 })
  const undated = build({ ...from, observedAt: null }, to)
  assert.equal(undated.commercial.quality, 'unknown')
  assert.ok(undated.commercial.deal)
  assert.deepEqual(undated.circuits, [])
})

test('rejeu des carnets FIO archivés FEO avec coût manuel déclaré et règlement sans change', () => {
  const captured = JSON.parse(readFileSync(new URL('./fixtures/m12-fio-feo.json', import.meta.url), 'utf8'))
  const [from, to] = ['CI2', 'CI1'].map(code => captured.markets.find((row: Market) => row.exchange === code) as Market)
  const evaluated = Date.parse(captured.evaluatedAt)
  const costs = { ...base, currency: 'CIS' }
  const data: Snapshot = { ...raw, collectedAt: new Date(evaluated).toISOString(), markets: captured.markets }
  const build = marketCircuitBuilder({ data, now: evaluated, parking: from.exchange, ship: emptyNavigation, navigation: null,
    transport: { emptyFixed: null, loadedFixed: 100, loadedUnit: 0 }, costs, quantity: 1 })
  const [circuit] = build(from, to).circuits
  assert.ok(circuit)
  const result = evaluateCircuit({ ...input, reference: costs.currency, capital: costs.capital, now: evaluated, deal: circuit.deal, rates: {} })
  assert.ok(!('reason' in result))
  assert.deepEqual(result.conversions, [])
  assert.equal(result.final, 5000 - circuit.deal.payments.reduce((sum, row) => sum + row.amount, 0) + circuit.deal.proceeds.amount)
})

test('la découverte reste visible sans SFC, avec des dates anciennes ou sans capital exploitable', () => {
  const from = { ...raw.markets[0], ticker: 'AL', exchange: 'CI2', currency: 'CIS', observedAt, average: null, last: null,
    sells: [{ price: 100, quantity: 2 }, { price: 90, quantity: 1 }], buys: [] }
  const to = { ...from, exchange: 'CI1', sells: [], buys: [{ price: 200, quantity: 2 }, { price: 220, quantity: 1 }] }
  const settings = {
    data: { ...raw, collectedAt: observedAt, markets: [from, to] }, markets: [from, to],
    origin: 'CI2', destination: 'CI1', parking: 'CI2', ship: emptyNavigation, navigation: null, now, quantity: 2,
    costs: { ...base, currency: 'CIS', buyFee: 0, sellFee: 0 },
    transport: { emptyFixed: null, loadedFixed: null, loadedUnit: null },
    funding: { reference: 'CIS', capital: 500, holdings: {}, mode: 'close' as const, rates: {}, now },
  }
  const [unpriced] = scanCircuits(settings).rows
  assert.equal(unpriced.category, 'review')
  assert.deepEqual(unpriced.margin, { value: 230, currency: 'CIS', kind: 'native' })
  assert.equal(unpriced.score, null)
  assert.match(unpriced.reasons.join(' '), /SFC.*chargé/)
  const transport = { ...settings.transport, loadedFixed: 190, loadedUnit: 0 }
  const [known] = scanCircuits({ ...settings, transport }).rows
  assert.equal(known.category, 'evaluated')
  assert.equal(known.score, 40)
  const [unfunded] = scanCircuits({ ...settings, transport, settlementReady: false }).rows
  assert.equal(unfunded.category, 'review')
  assert.equal(unfunded.margin?.value, 230)
  const [blocked] = scanCircuits({ ...settings, transport, ship: { ...emptyNavigation, cargoT: 0 } }).rows
  assert.equal(blocked.category, 'blocked')
  assert.match(blocked.reasons[0], /Capacité/)
  assert.equal(blocked.margin?.value, 230)

  for (const [time, quality] of [['2026-11-21T18:00:00.123456+01:00', 'stale'], [null, 'unknown']] as const) {
    const [old] = scanCircuits({ ...settings, markets: [from, { ...to, observedAt: time }], transport }).rows
    assert.equal(old.category, 'review')
    assert.equal(old.quality, quality)
    assert.equal(old.margin?.value, 230)
    assert.equal(old.score, null)
    assert.equal(old.valuation, undefined)
  }
  const [oldSnapshot] = scanCircuits({ ...settings, transport, data: { ...settings.data, collectedAt: '2026-11-20T20:55:00Z' } }).rows
  assert.equal(oldSnapshot.category, 'review')
  assert.equal(oldSnapshot.quality, 'stale')
  assert.equal(oldSnapshot.score, null)
})

test('les flux natifs restent disponibles sans change et la marge fermée inclut le taux BID et les frais', () => {
  const from = { ...raw.markets[0], ticker: 'AL', exchange: 'AI1', currency: 'AIC', observedAt, average: null, last: null,
    sells: [{ price: 4000, quantity: 1 }], buys: [] }
  const to = { ...from, exchange: 'CI1', currency: 'CIS', sells: [], buys: [{ price: 3000, quantity: 1 }] }
  const settings = {
    data: { ...raw, collectedAt: observedAt, markets: [from, to] }, markets: [from, to],
    origin: 'AI1', destination: 'CI1', parking: 'AI1', ship: emptyNavigation, navigation: null, now, quantity: 1,
    costs: { ...base, buyFee: 0, sellFee: 0 }, transport: { emptyFixed: null, loadedFixed: null, loadedUnit: null },
    funding: { reference: 'AIC', capital: 5000, holdings: {}, mode: 'close' as const, rates: {}, now },
  }
  const [unknown] = scanCircuits(settings).rows
  assert.equal(unknown.category, 'review')
  assert.equal(unknown.margin, null)
  assert.equal(unknown.deal?.payments[0].amount, 4000)
  assert.equal(unknown.deal?.proceeds.amount, 3000)
  const [marked] = scanCircuits({ ...settings, funding: { ...settings.funding, rates } }).rows
  assert.deepEqual(marked.margin, { value: 1390, currency: 'AIC', kind: 'closed' })
  assert.equal(marked.score, null)
  const [insufficient] = scanCircuits({ ...settings, markets: [from, { ...to, buys: [] }] }).rows
  assert.equal(insufficient.category, 'blocked')
  const [missingDepth] = scanCircuits({ ...settings, markets: [from, { ...to, buys: [{ price: 3000, quantity: null }] }] }).rows
  assert.equal(missingDepth.category, 'review')
  assert.match(missingDepth.reasons[0], /Volume ASK ou BID inconnu/)
})
