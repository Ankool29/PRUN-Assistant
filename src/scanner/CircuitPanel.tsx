import { useMemo, useState } from 'react'
import type { Market, Snapshot } from '../data.ts'
import { durationLabel, formatPrice, formatTime, numeric } from '../domain.ts'
import { Empty, PAGE_SIZE, ShowMore, Status } from '../ui.tsx'
import type { CircuitInput } from './circuit.ts'
import type { CircuitQuality } from './circuitMarket.ts'
import { circuitLabels, circuitQualityLabels, scanCircuits, type CircuitRow, type Valuation } from './circuitScan.ts'
import type { Costs } from './execution.ts'
import { FxSettings } from './FxSettings.tsx'
import { fxKey, type FxBoard, type FxQuote } from './fxBook.ts'
import type { TransportRates } from './itinerary.ts'
import type { NavigationData, ShipNavigation } from './navigation.ts'

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
  const [quality, setQuality] = useState<CircuitQuality | 'all'>('all')
  const [visible, setVisible] = useState(PAGE_SIZE)
  const quantity = quantityInput === '' ? costs.minQuantity : number(quantityInput)
  const quantityValid = Number.isSafeInteger(quantity) && quantity >= costs.minQuantity && quantity <= costs.maxQuantity
  const commercialReady = quantityValid && Number.isFinite(costs.minLiquidity) && costs.minLiquidity >= 0
    && Number.isFinite(costs.buyFee) && costs.buyFee >= 0 && costs.buyFee <= 1
    && Number.isFinite(costs.sellFee) && costs.sellFee >= 0 && costs.sellFee < 1
  const report = useMemo(() => commercialReady && parking ? scanCircuits({
    data, markets, now, parking, origin, destination, ship, navigation, transport, costs, quantity, settlementReady: !invalid,
    funding: { reference, capital: costs.capital, holdings: Object.fromEntries(currencies.filter(code => code !== reference)
      .map(code => [code, number(balances[code] || '0')])), mode, rates: board, now },
  }) : { rows: [], compared: 0, filtered: 0 },
  [commercialReady, data, markets, now, parking, origin, destination, ship, navigation, transport, costs, quantity,
    invalid, reference, currencies, balances, mode, board])
  const shown = report.rows.filter(row => quality === 'all' || row.quality === quality)
  const qualityRank = { fresh: 0, demo: 0, stale: 1, unknown: 2 }
  const mark = (row: CircuitRow) => row.score ?? (row.margin?.currency === reference ? row.margin.value : -Infinity)
  shown.sort((a, b) => Number(b.from.exchange === parking) - Number(a.from.exchange === parking)
    || qualityRank[a.quality] - qualityRank[b.quality] || Number(!!b.deal) - Number(!!a.deal) || mark(b) - mark(a))
  const categories = Object.entries(circuitLabels).map(([category, label]) => ({
    label, rows: shown.filter(row => row.category === category),
  }))
  return <>
    <section className="scanner-controls" aria-label="Paramètres des circuits">
      <h2>Circuits multidevises</h2>
      <p>{data.source === 'demo' ? 'Démonstration fictive.' : `Instantané FIO du ${formatTime(data.collectedAt)}.`} Simulation aux prix ASK à l’achat et BID à la revente.</p>
      <div className="scanner-grid scanner-mode">
        <label className="field"><span>Règlement du circuit</span>
          <select value={mode} onChange={e => { setMode(e.target.value as CircuitInput['mode']); setVisible(PAGE_SIZE) }}>
            <option value="close">Fermer en {reference}</option><option value="hold">Conserver les devises</option>
          </select></label>
        <label className="field"><span>Quantité du circuit</span>
          <input type="number" min={costs.minQuantity} max={costs.maxQuantity} step="1" inputMode="numeric" value={quantityInput}
            placeholder={String(costs.minQuantity)} onChange={e => { setQuantity(e.target.value); setVisible(PAGE_SIZE) }}/>
        </label>
        <label className="field"><span>Qualité des données</span>
          <select value={quality} onChange={e => { setQuality(e.target.value as typeof quality); setVisible(PAGE_SIZE) }}>
            <option value="all">Toutes les qualités</option>
            {(data.source === 'demo' ? ['demo'] as const : ['fresh', 'stale', 'unknown'] as const).map(key =>
              <option key={key} value={key}>{circuitQualityLabels[key]}</option>)}
          </select>
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
    <p className="scanner-notice">{numeric(report.compared)} paires examinées · {numeric(shown.length)} circuits visibles{report.filtered ? ` · ${numeric(report.filtered)} sous le rendement minimal` : ''}.</p>
    {data.source === 'fio' && shown.some(row => row.quality === 'stale' || row.quality === 'unknown') &&
      <p className="muted">Carnets anciens ou à la date indéterminée · consultation exploratoire uniquement. Leur exécution immédiate et leur bénéfice net restent indéterminés.</p>}
    {categories.map(group => <section key={group.label} className="scanner-result-group" aria-label={group.label}>
      <h3>{group.label} · {numeric(group.rows.length)}</h3>
      {group.rows.length ? <>
        <div className="records">{group.rows.slice(0, visible).map(row =>
          <CircuitDetails key={`${row.from.ticker}.${row.from.exchange}.${row.to.exchange}`}
            row={row} reference={reference} mode={mode} parking={parking} source={data.source} now={now}/>)}</div>
        {group.rows.length > visible &&
          <ShowMore shown={visible} total={group.rows.length} more={() => setVisible(visible + PAGE_SIZE)}/>}
      </> : <Empty>Aucun circuit pour ces filtres.</Empty>}
    </section>)}
  </>
}

function CircuitDetails({ row, reference, mode, parking, source, now }: {
  row: CircuitRow; reference: string; mode: CircuitInput['mode']; parking: string
  source: Snapshot['source']; now: number
}) {
  const { from, to, margin, score, reasons, valuation } = row
  const deal = row.circuit?.deal ?? row.deal
  const legs = row.circuit?.legs
  const minutes = legs?.every(leg => leg.minutes !== null) ? legs.reduce((sum, leg) => sum + (leg.minutes ?? 0), 0) : null
  const amount = score !== null ? money(score, reference) : margin ? money(margin.value, margin.currency) : 'Indéterminé'
  const amountLabel = score !== null ? (mode === 'close' ? 'Net estimé' : 'Net indicatif') : margin ? 'Avant transport' : 'Marge indisponible'
  return <details className="record scanner-record">
    <summary>
      <span className="record-label"><span className="ticker">{from.ticker}</span><strong>{from.exchange} vers {to.exchange}</strong></span>
      <span className="scanner-gain"><b>{amount}</b><small>{amountLabel}</small></span>
    </summary>
    <div className="record-body">
      <dl className="facts">
        <div><dt>Départ</dt><dd>{from.exchange === parking ? 'Marché du vaisseau' : 'Trajet à vide requis'}</dd></div>
        <div><dt>Marge commerciale avant transport</dt><dd>{margin ? money(margin.value, margin.currency) : 'Indéterminée'}</dd></div>
        <div><dt>Quantité demandée</dt><dd>{numeric(row.quantity)}</dd></div>
        {deal && <div><dt>Quantité achetée / revendue</dt><dd>{numeric(deal.purchased)} / {numeric(deal.sold)}</dd></div>}
        <div><dt>Temps de vol estimé</dt><dd>{minutes === null ? 'Indéterminé' : durationLabel(minutes * 60_000)}</dd></div>
        {minutes !== null && minutes > 0 && score !== null && <div><dt>Marge par heure de vol</dt><dd>{money(score * 60 / minutes, reference)}</dd></div>}
      </dl>
      {margin && <p className="muted">{margin.kind === 'closed' ? 'Marge du circuit commercial fermé, frais FXOB compris.'
        : margin.kind === 'indicative' ? 'Équivalent indicatif aux cours FXOB récents. La clôture monétaire reste indéterminée.'
        : 'Marge dans la devise commune des deux marchés, frais de marché compris.'}</p>}
      {row.quality === 'stale' || row.quality === 'unknown'
        ? <p className="scanner-notice">Lecture exploratoire des carnets. Exécution immédiate non validée.</p>
        : <p className="muted">Le prix, la profondeur et la disponibilité des ordres peuvent changer avant l’arrivée.</p>}
      <ul className="scanner-times">{[from, to].map(market => <li key={market.exchange}>
        {market.exchange} {source === 'fio' && market.observedAt === null ? <span>Non daté</span>
          : <Status source={source} timestamp={market.observedAt} now={now} short/>}
        {source === 'fio' && market.observedAt && <span>{formatTime(market.observedAt)}</span>}
      </li>)}</ul>
      {!!legs?.length && <ul>{legs.map(leg => <li key={leg.label}>{leg.label}</li>)}</ul>}
      {deal && <>
        <h4>Dépenses et revente</h4>
        <ul>{[...deal.payments, deal.proceeds].map((payment, index) =>
          <li key={index}>{payment.label} · {money(payment.amount, payment.currency)}</li>)}</ul>
        {!!deal.remaining.quantity && <p>Stock invendu · {numeric(deal.remaining.quantity)} {from.ticker} · {deal.remaining.covered
          ? `estimation au dernier prix observé, frais déduits ${money(deal.remaining.value, deal.remaining.currency)}`
          : 'dernier prix récent utilisable absent'}{valuation && deal.remaining.covered > 0
          && ` · équivalent indicatif ${money(valuation.stockValue, reference)}`}.</p>}
      </>}
      {score === null && <p>Bénéfice net indéterminé.</p>}
      {!!reasons.length && <ul>{reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
      {valuation && <CircuitValuation result={valuation} reference={reference} mode={mode}/>}
      {!!row.alternatives?.length && <details className="scanner-options">
        <summary>Autres itinéraires chiffrés</summary>
        <ul>{row.alternatives.map(({ circuit, result, score }, index) => <li key={index}>
          {circuit.legs.map(leg => leg.label).join(' · ')} · {score === null
            ? ('reason' in result ? result.reason : 'Bénéfice net indéterminé.') : `Net ${money(score, reference)}`}
        </li>)}</ul>
      </details>}
    </div>
  </details>
}

function CircuitValuation({ result, reference, mode }: {
  result: Valuation; reference: string; mode: CircuitInput['mode']
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
      <h4>Conversion monétaire directe</h4>
      {benchmark && result.benchmarkBudget !== null ? <>
        <p>Au départ {money(result.benchmarkBudget, reference)} · {mode === 'close' ? 'capital mobilisé' : 'coûts estimés en devise de référence'}. Destination {money(benchmark.destination, result.benchmarkTarget)}. Frais aller-retour {money(benchmark.fees, reference)}.</p>
        <p>Retour en {reference} · {money(benchmark.final, reference)}{benchmark.remainder > 0 && <> · {money(benchmark.cash, reference)} en trésorerie et {money(benchmark.remainder, result.benchmarkTarget)} restants</>}.</p>
        {result.advantage !== null && <p>Avantage du commerce sur l’aller-retour monétaire · {money(result.advantage, reference)}.</p>}
        {result.benchmarkTarget !== reference && <p>{mode === 'close' ? 'Solde après la revente, avant le change de clôture' : 'Variation du solde après la revente'} · {money(destinationBalance, result.benchmarkTarget)}.</p>}
      </> : <p>Comparaison indéterminée · budget, cours vendeur ou lots convertibles insuffisants.</p>}
  </>
}
