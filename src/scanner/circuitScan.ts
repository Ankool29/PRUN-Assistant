import type { Market } from '../data.ts'
import { evaluateCircuit, type CircuitDeal, type CircuitInput } from './circuit.ts'
import { marketCircuitBuilder, type CircuitQuality, type MarketCircuit } from './circuitMarket.ts'
import { createFxDesk } from './fxBook.ts'

export const circuitLabels = { evaluated: 'Évalués', review: 'À vérifier', blocked: 'Non réalisables' } as const
export const circuitQualityLabels = {
  fresh: 'Récents', stale: 'Anciens', unknown: 'Non datés ou horodatage indéterminé', demo: 'Fictifs',
} as const
type Category = keyof typeof circuitLabels
type CircuitEvaluation = ReturnType<typeof evaluateCircuit>
export type Valuation = Exclude<CircuitEvaluation, { reason: string }>
type PricedRoute = { circuit: MarketCircuit; result: CircuitEvaluation; score: number | null }
type CommercialMargin = { value: number; currency: string; kind: 'native' | 'closed' | 'indicative' }
export type CircuitRow = {
  category: Category; quality: CircuitQuality; from: Market; to: Market
  deal: CircuitDeal | null; quantity: number; margin: CommercialMargin | null
  reasons: string[]; score: number | null; circuit?: MarketCircuit; valuation?: Valuation; alternatives?: PricedRoute[]
}

type Funding = Omit<CircuitInput, 'deal'>
type Settings = Parameters<typeof marketCircuitBuilder>[0] & {
  markets: Market[]; origin: string; destination: string; funding: Funding; settlementReady?: boolean
}

function commercialMargin(deal: CircuitDeal | null, funding: Funding): CommercialMargin | null {
  if (!deal || deal.remaining.quantity) return null
  const purchase = deal.payments[0]
  const resale = deal.proceeds
  const { reference, rates, now, mode } = funding
  if (purchase.currency === resale.currency) {
    const margin = resale.amount - purchase.amount
    if (purchase.currency === reference || mode === 'hold') return { value: margin, currency: purchase.currency, kind: 'native' }
  }
  if (mode === 'close') {
    const result = evaluateCircuit({ ...funding, deal })
    if (!('reason' in result) && result.delta !== null) return { value: result.delta, currency: reference, kind: 'closed' }
  }
  if (purchase.currency === resale.currency)
    return { value: resale.amount - purchase.amount, currency: purchase.currency, kind: 'native' }

  const desk = createFxDesk(rates, reference, now)
  const cost = desk.value(purchase.currency, purchase.amount, 'ask')
  const proceeds = desk.value(resale.currency, resale.amount, 'bid')
  return cost === null || proceeds === null ? null : { value: proceeds - cost, currency: reference, kind: 'indicative' }
}

export function scanCircuits(settings: Settings) {
  const { markets, origin, destination, funding, quantity, costs, settlementReady = true } = settings
  const build = marketCircuitBuilder(settings)
  const groups = new Map<string, Market[]>()
  for (const market of markets) {
    const group = groups.get(market.ticker)
    if (group) group.push(market)
    else groups.set(market.ticker, [market])
  }
  const rows: CircuitRow[] = []
  let filtered = 0
  for (const group of groups.values()) for (const from of group) {
    if (origin && from.exchange !== origin) continue
    for (const to of group) {
      if (from.exchange === to.exchange || (destination && to.exchange !== destination)) continue
      const report = build(from, to)
      const { quality, deal } = report.commercial
      const margin = commercialMargin(deal, funding)
      const entry: Pick<CircuitRow, 'quality' | 'deal' | 'from' | 'to' | 'quantity' | 'margin'> = { quality, deal, from, to, quantity, margin }
      const candidates = (settlementReady ? report.circuits : []).map(circuit => {
        const result = evaluateCircuit({ ...funding, deal: circuit.deal })
        const score = 'reason' in result ? null : funding.mode === 'close' ? result.delta : result.margin
        return { circuit, result, score }
      }).sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity))
      const best = candidates.find(({ result, score }) => !('reason' in result) && score !== null
        && (score <= 0 || costs.minReturn === 0 || (result.benchmarkBudget !== null && score >= costs.minReturn * result.benchmarkBudget)))
      if (best && !('reason' in best.result) && best.score !== null) {
        rows.push({ ...entry, category: 'evaluated', score: best.score, reasons: report.reasons, circuit: best.circuit, valuation: best.result,
          alternatives: candidates.filter(row => row !== best) })
        continue
      }
      if (candidates.some(row => row.score !== null)) {
        filtered++
        continue
      }
      const blocked = report.impossible || (candidates.length > 0
        && candidates.every(({ result }) => 'reason' in result && result.blocked))
      const reasons = [...new Set([...report.reasons, ...candidates.flatMap(({ result }) => 'reason' in result ? [result.reason] : result.issues)])]
      if (deal && !deal.remaining.quantity && !margin)
        reasons.push('Change FXOB manquant ou non exploitable pour comparer les montants des deux devises.')
      if (!settlementReady && !blocked) reasons.push('Vérifiez le capital et les paramètres de règlement pour calculer le bénéfice net.')
      const partial = candidates.find(({ result }) => !('reason' in result)) ?? candidates[0]
      rows.push({ ...entry, category: blocked ? 'blocked' : 'review', score: null, reasons,
        circuit: partial?.circuit, alternatives: candidates.filter(row => row !== partial),
        valuation: partial && !('reason' in partial.result) ? partial.result : undefined })
    }
  }
  return { rows, filtered, compared: rows.length + filtered }
}
