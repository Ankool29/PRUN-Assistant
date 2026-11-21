import { createFxDesk, FX_LOT, type FxBoard, type FxFill } from './fxBook.ts'

const EPSILON = 1e-8
type Wallet = Record<string, number>
export type Payment = { currency: string; amount: number; label: string }
export type CircuitDeal = {
  payments: Payment[]
  proceeds: Payment
  purchased: number
  sold: number
  remaining: { quantity: number; covered: number; currency: string; value: number }
}
export type CircuitInput = {
  deal: CircuitDeal
  reference: string
  capital: number
  holdings: Readonly<Wallet>
  mode: 'hold' | 'close'
  rates: FxBoard
  now: number
}

export function directConversion(reference: string, target: string, budget: number, rates: FxBoard, now: number) {
  if (!Number.isFinite(budget) || budget < 0) return null
  if (reference === target) return { destination: budget, cash: budget, remainder: 0, final: budget, fees: 0 }
  const desk = createFxDesk(rates, reference, now)
  const purchase = desk.buyWithBudget(target, budget)
  if (!purchase) return null
  const destination = purchase.lots * FX_LOT
  const sale = desk.sellBalance(target, destination)
  const cash = budget - purchase.cash + (sale?.cash ?? 0)
  const remainder = destination - (sale?.lots ?? 0) * FX_LOT
  return { destination, cash, remainder, final: remainder ? null : cash, fees: purchase.fee + (sale?.fee ?? 0) }
}

export function evaluateCircuit(input: CircuitInput) {
  const { deal, reference, capital, holdings, mode, rates, now } = input
  const opening = mode === 'hold' ? { ...holdings, [reference]: capital } : { [reference]: capital }
  const wallet: Wallet = { ...opening }
  const payments: Wallet = {}
  const unavailable = (reason: string, blocked = false) => ({ reason, blocked } as const)
  if (!Number.isFinite(capital) || capital < 0 || Object.values(opening).some(value => !Number.isFinite(value) || value < 0)) {
    return unavailable('Capital ou solde initial invalide.')
  }
  for (const payment of deal.payments) {
    const total = (payments[payment.currency] ?? 0) + payment.amount
    if (!Number.isFinite(total) || !Number.isFinite(payment.amount) || payment.amount < 0) return unavailable(`Coût inconnu · ${payment.label}.`)
    payments[payment.currency] = total
  }
  if (!Number.isFinite(deal.proceeds.amount) || deal.proceeds.amount < 0) return unavailable('Recette non valorisable.')

  const desk = createFxDesk(rates, reference, now)
  const flows = createFxDesk(rates, reference, now)
  const conversions: FxFill[] = []
  for (const [currency, amount] of Object.entries(payments)) {
    const missing = amount - (wallet[currency] ?? 0)
    if (missing > EPSILON) {
      if (mode === 'hold' || currency === reference) return unavailable(`Solde insuffisant en ${currency} pour ${amount.toFixed(2)} ${currency} de dépenses.`, true)
      const lots = Math.ceil((missing - EPSILON) / FX_LOT)
      const conversion = desk.execute(currency, 'ask', lots)
      if (!conversion) return unavailable(`${desk.issue(currency, 'ask')} ${lots} lots requis.`)
      if (wallet[reference] + EPSILON < conversion.cash) return unavailable(`Capital ${reference} insuffisant pour acheter ${lots} lots de ${currency}, frais inclus.`, true)
      conversions.push(conversion)
      wallet[reference] -= conversion.cash
      wallet[currency] = (wallet[currency] ?? 0) + lots * FX_LOT
    }
    wallet[currency] = Math.max(0, (wallet[currency] ?? 0) - amount)
  }
  const raised = capital - wallet[reference]
  const target = deal.proceeds.currency
  const proceeds = deal.proceeds.amount
  wallet[target] = (wallet[target] ?? 0) + proceeds
  if (!Number.isFinite(wallet[target])) return unavailable('Solde après revente invalide.')
  const beforeClosing = { ...wallet }

  const spent = Object.entries(payments).map(([currency, amount]) => flows.value(currency, amount, 'ask'))
  const spendValue = spent.every(value => value !== null) ? spent.reduce<number>((sum, value) => sum + value!, 0) : null
  const changes = Object.keys(wallet).map(currency => {
    const difference = wallet[currency] - (opening[currency] ?? 0)
    const value = flows.value(currency, Math.abs(difference), difference >= 0 ? 'bid' : 'ask')
    return { currency, difference, value: value === null ? null : difference >= 0 ? value : -value }
  })
  const margin = mode === 'hold' && changes.every(row => row.value !== null)
    ? changes.reduce((sum, row) => sum + row.value!, 0) : null

  const issues: string[] = []
  if (mode === 'close') {
    for (const [currency, cash] of Object.entries(wallet)) {
      if (currency === reference || cash <= EPSILON) continue
      const conversion = desk.sellBalance(currency, cash)
      if (conversion) {
        conversions.push(conversion)
        wallet[reference] += conversion.cash
        wallet[currency] = Math.max(0, cash - conversion.lots * FX_LOT)
      }
      if (wallet[currency] > EPSILON) {
        const detail = wallet[currency] < FX_LOT ? 'Lot incomplet.' : desk.issue(currency, 'bid')
        issues.push(`Solde en ${currency} · ${detail}`)
      }
    }
  } else if (margin === null) {
    for (const row of changes.filter(row => row.value === null))
      issues.push(flows.issue(row.currency, row.difference > 0 ? 'bid' : 'ask'))
  }
  const residual = Object.entries(wallet).filter(([currency, amount]) => currency !== reference && amount > EPSILON)
    .map(([currency, amount]) => ({ currency, amount, value: desk.value(currency, amount, 'bid') }))
  const stockValue = deal.remaining.covered ? desk.value(deal.remaining.currency, deal.remaining.value, 'bid') : null
  if (deal.remaining.quantity > 0) issues.push('Marchandises invendues · leur valeur est séparée de la trésorerie.')
  const final = mode === 'close' && !residual.length && !deal.remaining.quantity ? wallet[reference] : null
  const delta = final === null ? null : final - capital
  const benchmarkBudget = mode === 'close' ? raised : spendValue
  const benchmarkTarget = target === reference ? deal.payments.find(row => row.currency !== reference && row.amount > 0)?.currency ?? target : target
  const benchmark = benchmarkBudget === null ? null : directConversion(reference, benchmarkTarget, benchmarkBudget, rates, now)
  const advantage = delta !== null && benchmark?.final != null && benchmarkBudget !== null
    ? delta - (benchmark.final - benchmarkBudget) : null

  return { wallet, changes, residual, margin, final, delta, conversions, issues, stockValue, benchmark, benchmarkBudget,
    advantage, benchmarkTarget, beforeClosing }
}
