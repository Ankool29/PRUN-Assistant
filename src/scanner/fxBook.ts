import { z } from 'zod'
import { freshness } from '../domain.ts'

export const FX_LOT = 1000
const edge = z.object({ rate: z.number().finite().positive(), lots: z.number().int().safe().positive() })
export const fxQuoteSchema = z.object({
  base: z.string().min(1), reference: z.string().min(1), observedAt: z.string(),
  bid: edge.nullable(), ask: edge.nullable(),
  fee: z.number().finite().min(0).lt(1), fixedFee: z.number().finite().nonnegative(),
}).refine(q => q.base !== q.reference && !!(q.bid || q.ask) && (!q.bid || !q.ask || q.bid.rate <= q.ask.rate))
export type FxQuote = z.infer<typeof fxQuoteSchema>
export type FxBoard = Readonly<Record<string, FxQuote>>
export const fxKey = (base: string, reference: string) => `${base}/${reference}`
type Side = 'ask' | 'bid'
export type FxFill = { base: string; side: Side; lots: number; rate: number; fee: number; cash: number }

export function createFxDesk(board: FxBoard, reference: string, now: number) {
  const used = new Map<string, { ask: number; bid: number }>()
  function getQuote(base: string) {
    const quote = board[fxKey(base, reference)]
    return quote?.base === base && quote.reference === reference ? quote : null
  }

  function side(base: string, direction: Side) {
    const quote = getQuote(base)
    const level = quote?.[direction]
    if (!quote || !level || freshness(quote.observedAt, now) !== 'fresh') return null
    const usage = used.get(base) ?? { ask: 0, bid: 0 }
    return { quote, level, usage, available: level.lots - usage[direction] }
  }

  function issue(base: string, direction: Side) {
    const quote = getQuote(base)
    const pair = fxKey(base, reference)
    if (!quote) return `Relevé FXOB absent · ${pair}.`
    if (freshness(quote.observedAt, now) !== 'fresh') return `Relevé FXOB ancien ou non daté · ${pair}.`
    const label = direction === 'ask' ? 'vendeur' : 'acheteur'
    if (!quote[direction]) return `Cours ${label} absent · ${pair}.`
    return `Lots du côté ${label} insuffisants ou valeur nette non chiffrable · ${pair}.`
  }

  function execute(base: string, direction: Side, lots: number): FxFill | null {
    const price = side(base, direction)
    if (!price || !Number.isSafeInteger(lots) || lots <= 0 || lots > price.available) return null
    const raw = lots * FX_LOT * price.level.rate
    const fee = raw * price.quote.fee + price.quote.fixedFee
    const cash = direction === 'ask' ? raw + fee : raw - fee
    if (!Number.isFinite(cash) || cash <= 0) return null
    price.usage[direction] += lots
    used.set(base, price.usage)
    return { base, side: direction, lots, rate: price.level.rate, cash, fee }
  }

  function buyWithBudget(base: string, budget: number) {
    const price = side(base, 'ask')
    if (!price) return null
    const lots = Math.floor((budget - price.quote.fixedFee + 1e-8) / (FX_LOT * price.level.rate * (1 + price.quote.fee)))
    const affordable = Math.min(lots, price.available)
    const raw = affordable * FX_LOT * price.level.rate
    return execute(base, 'ask', raw + (raw * price.quote.fee + price.quote.fixedFee) <= budget + 1e-8 ? affordable : affordable - 1)
  }

  function sellBalance(base: string, balance: number) {
    const price = side(base, 'bid')
    if (!price) return null
    return execute(base, 'bid', Math.min(price.available, Math.floor((balance + 1e-8) / FX_LOT)))
  }

  // Valeur indicative, y compris pour un solde inférieur au lot de négociation.
  function value(base: string, amount: number, direction: Side): number | null {
    if (!Number.isFinite(amount) || amount < 0) return null
    if (!amount || base === reference) return amount
    const price = side(base, direction)
    if (!price || amount > price.available * FX_LOT + 1e-8) return null
    const raw = amount * price.level.rate
    const fee = raw * price.quote.fee + price.quote.fixedFee
    const net = direction === 'ask' ? raw + fee : raw - fee
    return Number.isFinite(net) && net >= 0 ? net : null
  }

  return { execute, buyWithBudget, sellBalance, value, issue }
}
