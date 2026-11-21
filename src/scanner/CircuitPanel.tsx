import { useState } from 'react'
import type { Market, Snapshot } from '../data.ts'
import { durationLabel, formatPrice, formatTime, numeric } from '../domain.ts'
import { Empty, PAGE_SIZE, ShowMore, Status } from '../ui.tsx'
import { evaluateCircuit, type CircuitInput } from './circuit.ts'
import { marketCircuitBuilder, type MarketCircuit } from './circuitMarket.ts'
import type { Costs } from './execution.ts'
import { FxSettings } from './FxSettings.tsx'
import { fxKey, type FxBoard, type FxQuote } from './fxBook.ts'
import type { TransportRates } from './itinerary.ts'
import type { NavigationData, ShipNavigation } from './navigation.ts'

type Result = ReturnType<typeof evaluateCircuit>
type Props = {
  data: Snapshot; markets: Market[]; currencies: string[]; now: number; parking: string
  origin: string; destination: string; costs: Costs; invalid: boolean; ship: ShipNavigation
  navigation: NavigationData | null; transport: TransportRates; board: FxBoard
  save: (quote: FxQuote) => void; remove: (base: string) => void
}
const number = (value: string) => value.trim() ? Number(value) : NaN
const money = (amount: number | null, currency: string) => amount === null ? 'Indéterminé' : `${formatPrice(amount)} ${currency}`

export function CircuitPanel({ data, markets, currencies, now, parking, origin, destination, costs, invalid,
  ship, navigation, transport, board, save, remove }: Props) {
  const reference = costs.currency
  const [mode, setMode] = useState<CircuitInput['mode']>('close')
  const [quantityInput, setQuantity] = useState('')
  const [balances, setBalances] = useState<Record<string, string>>({})
  const [visible, setVisible] = useState(PAGE_SIZE)
  const quantity = quantityInput === '' ? costs.minQuantity : number(quantityInput)
  const quantityValid = Number.isSafeInteger(quantity) && quantity >= costs.minQuantity && quantity <= costs.maxQuantity
  const holdings = Object.fromEntries(currencies.filter(code => code !== reference).map(code => [code, number(balances[code] || '0')]))
  const rows: { circuit: MarketCircuit; result: Result; score: number | null }[] = []
  const diagnostics = new Map<string, number>()
  const count = (reason: string) => diagnostics.set(reason, (diagnostics.get(reason) ?? 0) + 1)
  let compared = 0
  let filtered = 0
  if (!invalid && quantityValid && parking) {
    const build = marketCircuitBuilder({ data, now, parking, ship, navigation, transport, costs, quantity })
    const groups = new Map<string, Market[]>()
    for (const market of markets) {
      const group = groups.get(market.ticker)
      if (group) group.push(market)
      else groups.set(market.ticker, [market])
    }
    for (const group of groups.values()) for (const from of group) {
      if (origin && from.exchange !== origin) continue
      for (const to of group) {
        if (from.exchange === to.exchange || (destination && to.exchange !== destination)) continue
        compared++
        const report = build(from, to)
        report.reasons.forEach(count)
        for (const circuit of report.circuits) {
          const result = evaluateCircuit({ deal: circuit.deal, reference, capital: costs.capital, holdings, mode, rates: board, now })
          if ('reason' in result) {
            count(result.reason)
            rows.push({ result, circuit, score: null })
            continue
          }
          const score = mode === 'close' ? result.delta : circuit.deal.remaining.quantity ? null : result.margin
          if (score !== null && score > 0 && costs.minReturn > 0
            && (result.benchmarkBudget === null || score < costs.minReturn * result.benchmarkBudget)) {
            filtered++
            continue
          }
          rows.push({ result, circuit, score })
        }
      }
    }
  }
  rows.sort((a, b) => Number(b.circuit.from.exchange === parking) - Number(a.circuit.from.exchange === parking)
    || (b.score ?? -Infinity) - (a.score ?? -Infinity))
  const groups = [
    { label: 'Circuits rentables', rows: rows.filter(row => row.score !== null && row.score > 0) },
    { label: 'Circuits à l’équilibre ou déficitaires', rows: rows.filter(row => row.score !== null && row.score <= 0) },
    { label: 'Rentabilité indéterminée', rows: rows.filter(row => row.score === null) },
  ]
  return <>
    <section className="scanner-controls" aria-label="Paramètres des circuits">
      <h2>Circuits multidevises</h2>
      <p>{data.source === 'demo' ? 'Démonstration fictive.' : `Instantané FIO du ${formatTime(data.collectedAt)}.`} Achat et revente sur les carnets de marchandises observés. Toute conversion reste simulée.</p>
      <div className="scanner-grid scanner-mode">
        <label className="field"><span>Règlement du circuit</span>
          <select value={mode} onChange={e => { setMode(e.target.value as CircuitInput['mode']); setVisible(PAGE_SIZE) }}>
            <option value="close">Fermer en {reference}</option><option value="hold">Conserver les devises</option>
          </select></label>
        <label className="field"><span>Quantité du circuit</span>
          <input type="number" min={costs.minQuantity} max={costs.maxQuantity} step="1" inputMode="numeric" value={quantityInput}
            placeholder={String(costs.minQuantity)} onChange={e => { setQuantity(e.target.value); setVisible(PAGE_SIZE) }}/>
        </label>
        {mode === 'hold' && currencies.filter(code => code !== reference).map(code =>
          <label className="field" key={code}><span>Solde initial ({code})</span>
            <input type="number" min="0" step="any" inputMode="decimal" value={balances[code] ?? ''} placeholder="0"
              onChange={e => setBalances(previous => ({ ...previous, [code]: e.target.value }))}/>
          </label>)}
      </div>
      <p className="muted">{mode === 'hold'
        ? 'Les dépenses sont payées avec les soldes déclarés. Le change sert à comparer les variations de trésorerie.'
        : 'Le scanner simule l’achat des devises nécessaires puis le retour en devise initiale. Les lots incomplets restent au portefeuille.'}</p>
      <FxSettings currencies={currencies} reference={reference} board={board} now={now} demo={data.source === 'demo'} save={save} remove={remove}/>
    </section>
    {!quantityValid && <Empty>Choisissez une quantité entière comprise dans les limites du scanner.</Empty>}
    <p className="scanner-notice">{numeric(compared)} paires examinées · {numeric(rows.length)} variantes détaillées{filtered ? ` · ${numeric(filtered)} sous le rendement minimal` : ''}.</p>
    {diagnostics.size > 0 && <details className="scanner-options">
      <summary>Pourquoi certains circuits sont écartés</summary>
      <ul>{[...diagnostics].sort((a, b) => b[1] - a[1]).map(([reason, count]) =>
        <li key={reason}>{reason} · {numeric(count)}</li>)}</ul>
    </details>}
    {groups.map(group => <section key={group.label} className="scanner-result-group" aria-label={group.label}>
      <h3>{group.label} · {numeric(group.rows.length)}</h3>
      <div className="records">{group.rows.slice(0, visible).map(({ circuit, result, score }, index) =>
        <CircuitDetails key={`${circuit.from.ticker}.${circuit.from.exchange}.${circuit.to.exchange}.${index}`}
          circuit={circuit} result={result} reference={reference} mode={mode} score={score} parking={parking} source={data.source} now={now}/>)}</div>
      <ShowMore shown={Math.min(visible, group.rows.length)} total={group.rows.length} more={() => setVisible(visible + PAGE_SIZE)}/>
    </section>)}
  </>
}

function CircuitDetails({ circuit, result, reference, mode, score, parking, source, now }: {
  circuit: MarketCircuit; result: Result; reference: string; mode: CircuitInput['mode']; score: number | null; parking: string
  source: Snapshot['source']; now: number
}) {
  const { from, to, deal, legs } = circuit
  const minutes = legs.every(leg => leg.minutes !== null) ? legs.reduce((sum, leg) => sum + (leg.minutes ?? 0), 0) : null
  const ledger = <ul>{[...deal.payments, deal.proceeds].map((row, index) =>
    <li key={index}>{row.label} · {money(row.amount, row.currency)}</li>)}</ul>
  const stock = !!deal.remaining.quantity && <p>Stock invendu · {numeric(deal.remaining.quantity)} {from.ticker} · {deal.remaining.covered
    ? `estimation au dernier prix observé, frais déduits ${money(deal.remaining.value, deal.remaining.currency)}`
    : 'dernier prix récent utilisable absent'}{!('reason' in result) && deal.remaining.covered > 0
      && ` · équivalent indicatif ${money(result.stockValue, reference)}`}.</p>
  return <details className="record scanner-record">
    <summary>
      <span className="record-label"><span className="ticker">{from.ticker}</span><strong>{from.exchange} vers {to.exchange}</strong></span>
      <span className="scanner-gain"><b>{money(score, reference)}</b><small>{from.exchange === parking ? 'Départ local' : 'Trajet à vide'}</small></span>
    </summary>
    <div className="record-body">
      <dl className="facts">
        <div><dt>Quantité achetée / revendue</dt><dd>{numeric(deal.purchased)} / {numeric(deal.sold)}</dd></div>
        <div><dt>Temps de vol estimé</dt><dd>{minutes === null ? 'Indéterminé' : durationLabel(minutes * 60_000)}</dd></div>
        {minutes !== null && minutes > 0 && score !== null && <div><dt>Marge par heure de vol</dt><dd>{money(score * 60 / minutes, reference)}</dd></div>}
      </dl>
      <p className="muted">Le prix, la profondeur et la disponibilité des ordres peuvent changer avant l’arrivée.</p>
      <ul className="scanner-times">{[from, to].map(market => <li key={market.exchange}>
        {market.exchange} <Status source={source} timestamp={market.observedAt} now={now} short/>
        {source === 'fio' && <span>{formatTime(market.observedAt)}</span>}
      </li>)}</ul>
      {!!legs.length && <ul>{legs.map(leg => <li key={leg.label}>{leg.label}</li>)}</ul>}
      <h4>Dépenses et revente</h4>
      {ledger}
      {stock}
      {'reason' in result ? <p>{result.reason}</p> : <CircuitValuation result={result} reference={reference} mode={mode}/>}
    </div>
  </details>
}

function CircuitValuation({ result, reference, mode }: {
  result: Exclude<Result, { reason: string }>; reference: string; mode: CircuitInput['mode']
}) {
  const benchmark = result.benchmark
  const destinationBalance = mode === 'close' ? result.beforeClosing[result.benchmarkTarget] ?? 0
    : result.changes.find(row => row.currency === result.benchmarkTarget)?.difference ?? 0
  return <>
    <p><strong>{mode === 'close' ? 'Capital final fermé' : 'Marge indicative sur les flux de trésorerie'}</strong>
        {' · '}{money(mode === 'close' ? result.final : result.margin, reference)}</p>
      <h4>Conversions simulées</h4>
      {result.conversions.length ? <ul>{result.conversions.map(row => <li key={`${row.base}.${row.side}`}>
        {row.side === 'ask' ? 'Achat' : 'Vente'} · {numeric(row.lots)} lots de {row.base} · {numeric(row.rate)} {reference} par {row.base} · {money(row.cash, reference)} · frais {money(row.fee, reference)}
      </li>)}</ul> : <p>Aucune conversion simulée.</p>}
      <h4>Trésorerie finale par devise</h4>
      <ul>{Object.entries(result.wallet).filter(([code, amount]) => code === reference || amount > 0).map(([code, amount]) => {
        const residual = result.residual.find(row => row.currency === code)
        return <li key={code}>{money(amount, code)}{residual && <> · valeur indicative {money(residual.value, reference)}</>}</li>
      })}</ul>
      {mode === 'hold' && <ul>{result.changes.filter(row => row.difference).map(row =>
        <li key={row.currency}>Flux {money(row.difference, row.currency)} · équivalent indicatif {money(row.value, reference)}</li>)}</ul>}
      {result.issues.length > 0 && <ul>{result.issues.map(reason => <li key={reason}>{reason}</li>)}</ul>}
      <h4>Conversion monétaire directe</h4>
      {benchmark && result.benchmarkBudget !== null ? <>
        <p>Au départ {money(result.benchmarkBudget, reference)} · {mode === 'close' ? 'capital mobilisé' : 'coûts estimés en devise de référence'}. Destination {money(benchmark.destination, result.benchmarkTarget)}. Frais aller-retour {money(benchmark.fees, reference)}.</p>
        <p>Retour en {reference} · {money(benchmark.final, reference)}{benchmark.remainder > 0 && <> · {money(benchmark.cash, reference)} en trésorerie et {money(benchmark.remainder, result.benchmarkTarget)} restants</>}.</p>
        {result.advantage !== null && <p>Avantage du commerce sur l’aller-retour monétaire · {money(result.advantage, reference)}.</p>}
        {result.benchmarkTarget !== reference && <p>{mode === 'close' ? 'Solde après la revente, avant le change de clôture' : 'Variation du solde après la revente'} · {money(destinationBalance, result.benchmarkTarget)}.</p>}
      </> : <p>Comparaison indéterminée · budget, cours vendeur ou lots convertibles insuffisants.</p>}
  </>
}
