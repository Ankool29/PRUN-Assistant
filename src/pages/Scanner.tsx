import { useEffect, useMemo, useState } from 'react'
import type { Market, Snapshot } from '../data.ts'
import { displayName, formatTime, freshness, searchKey } from '../domain.ts'
import { Empty, PAGE_SIZE, Search, SectionHead, ShowMore } from '../ui.tsx'
import { analyzeArbitrage, type SaleMode } from '../scanner/arbitrage.ts'
import { scanSpeculation } from '../scanner/speculation.ts'
import { demoHistory, loadHistory, loadPairHistory, pairKey, type History, type HistorySeries } from '../scanner/history.ts'
import { validCosts, type Costs } from '../scanner/execution.ts'
import { ArbitrageDetails, SpeculationDetails } from '../scanner/details.tsx'
import { groupByDeparture, type TransportRates } from '../scanner/itinerary.ts'
import { unknownTariffs, useShipProfiles, type TariffForm } from '../scanner/ships.ts'

import { Assessment } from '../scanner/Assessment.tsx'
import { FlightSettings } from '../scanner/FlightSettings.tsx'
import { createFlightPlanner, loadNavigation, type NavigationData } from '../scanner/navigation.ts'

import { useExchangeRates } from '../scanner/exchangeRates.ts'
import { GrossPrices } from '../scanner/GrossPrices.tsx'

type Sort = 'net' | 'yield' | 'risk'
type Panel = 'arbitrage' | 'speculation'
type Scope = 'local' | 'all'
const defaults = {
  capital: '100000', buyFee: '1', sellFee: '1',
  minQuantity: '1', maxQuantity: '1000', minReturn: '0', minLiquidity: '1', target: '',
}

function NumericField({ label, value, onChange, step = 'any', min = 0, max, placeholder }: {
  label: string; value: string; onChange: (value: string) => void
  step?: string; min?: number; max?: number; placeholder?: string
}) {
  return <label className="field"><span>{label}</span>
    <input type="number" inputMode={step === '1' ? 'numeric' : 'decimal'} step={step} min={min} max={max}
      placeholder={placeholder} value={value} onChange={event => onChange(event.target.value)}/>
  </label>
}

function ExchangeField({ label, data, value, set, empty = 'Toutes' }: {
  label: string; data: Snapshot; value: string; set: (value: string) => void; empty?: string
}) {
  return <label className="field"><span>{label}</span>
    <select value={value} onChange={event => set(event.target.value)}>
      <option value="">{empty}</option>
      {data.exchanges.map(item => <option key={item.code} value={item.code}>{item.code} · {item.station}</option>)}
    </select>
  </label>
}

function useHistoryStore(enabled: boolean) {
  const [history, setHistory] = useState<History | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!enabled || history || failed) return
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)])
    loadHistory(signal).then(value => { if (!controller.signal.aborted) setHistory(value) })
      .catch(() => { if (!controller.signal.aborted) setFailed(true) })
    return () => controller.abort()
  }, [enabled, history, failed])

  return { history, failed, retry: () => setFailed(false) }
}

const parse = (value: string) => value.trim() ? Number(value) : NaN

function knownTariff(value: string) {
  const cost = parse(value)
  return Number.isFinite(cost) && cost >= 0 ? cost : null
}

export function Scanner({ data, now }: { data: Snapshot; now: number }) {
  const demo = data.source === 'demo'
  const currencies = [...new Set(data.exchanges.map(row => row.currency))].sort()
  const ships = useShipProfiles(data.source)
  const parked = data.exchanges.find(row => row.code === ships.current.parking)
  const parking = parked?.code ?? ''
  const [scope, setScope] = useState<Scope>('local')
  const [currencyOverride, setCurrency] = useState('')
  const currency = currencyOverride || parked?.currency || currencies[0]
  const [exchangeRates, setExchangeRates] = useExchangeRates(data.source)
  const rates = exchangeRates[currency] ?? {}
  const tariffForm = ships.current.byCurrency[currency] ?? unknownTariffs
  const transport: TransportRates = {
    emptyFixed: knownTariff(tariffForm.emptyFixed),
    loadedFixed: knownTariff(tariffForm.loadedFixed),
    loadedUnit: knownTariff(tariffForm.loadedUnit),
  }
  const [navigation, setNavigation] = useState<NavigationData | null>(null)
  useEffect(() => {
    if (demo) return
    const controller = new AbortController()
    loadNavigation(AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]))
      .then(value => { if (!controller.signal.aborted) setNavigation(value) }).catch(() => {})
    return () => controller.abort()
  }, [demo])
  const [panel, setPanel] = useState<Panel>('arbitrage')
  const [mode, setMode] = useState<SaleMode>('immediate')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('net')
  const [form, setForm] = useState(defaults)
  const [budgets, setBudgets] = useState<Record<string, string>>({})
  const capital = budgets[currency] ?? form.capital
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [manual, setManual] = useState<Record<string, HistorySeries>>({})
  const [request, setRequest] = useState<{ pair: string; phase: 'loading' | 'failed' } | null>(null)
  const { history, failed, retry } = useHistoryStore(!demo && panel === 'speculation')

  const costs: Costs = {
    currency, rates: Object.fromEntries(Object.entries(rates).map(([code, value]) => [code, parse(value)])),
    capital: parse(capital), buyFee: parse(form.buyFee) / 100, sellFee: parse(form.sellFee) / 100,
    minQuantity: parse(form.minQuantity), maxQuantity: parse(form.maxQuantity),
    minReturn: parse(form.minReturn) / 100, minLiquidity: parse(form.minLiquidity),
  }
  const departure = {
    parking, transport, planner: createFlightPlanner(data, navigation, ships.current.navigation, costs, now),
  }
  const term = searchKey(query)
  const marketNames = useMemo(() => new Map(data.materials.map(row => [row.ticker, searchKey(displayName(row.name))])), [data.materials])
  const matching = data.markets.filter(row => !term || searchKey(`${row.ticker} ${marketNames.get(row.ticker) ?? ''}`).includes(term))
  const origin = scope === 'local' ? parking : from
  const resaleMarkets = matching.filter(row => !to || row.exchange === to)
  const exact = resaleMarkets.length === 1 ? resaleMarkets[0] : resaleMarkets.find(row => to && searchKey(row.ticker) === term)
  const exactKey = exact && pairKey(exact.ticker, exact.exchange)
  const bundledPairs = useMemo(
    () => demo ? demoHistory(data, now) : history?.series ?? [],
    [data, demo, history, now],
  )
  const histories = [...bundledPairs.filter(row => !manual[pairKey(row.ticker, row.exchange)]), ...Object.values(manual)]
  const bundledMissing = !!exactKey && !histories.some(row => pairKey(row.ticker, row.exchange) === exactKey)
  const snapshotUsable = demo || freshness(data.collectedAt, now) === 'fresh'
  const target = mode === 'limit' && form.target.trim() ? parse(form.target) : null
  const hypothesisInvalid = panel === 'arbitrage' && target !== null && !(Number.isFinite(target) && target > 0)
  const ratesInvalid = Object.entries(rates).some(([code, value]) => code !== currency && value.trim() && !(Number.isFinite(parse(value)) && parse(value) > 0))
  const invalid = !validCosts(costs) || hypothesisInvalid

  const financeReady = !!parking && snapshotUsable && !invalid
  const arbitrageReport = panel === 'arbitrage' && (parking || scope === 'all')
    ? analyzeArbitrage(matching, costs, { now, demo, departure, mode, from: origin, to, target, rawOnly: !financeReady }) : null
  const arbitrage = arbitrageReport?.opportunities ?? []
  const speculative = parking && snapshotUsable && !invalid && panel === 'speculation'
    ? scanSpeculation(matching, histories, costs, { now, demo, departure, from: origin, to }) : null
  const report = arbitrageReport ?? speculative
  arbitrage.sort((a, b) => sort === 'risk' ? a.risk - b.risk || b.money.net - a.money.net : b.money[sort] - a.money[sort])
  speculative?.opportunities.sort((a, b) => {
    // Dans le groupe de départ, la revente sur place reste accessible après les trajets interbourses.
    const onSite = (item: typeof a) => Number(item.from.exchange === parking && item.to.exchange === parking)
    return onSite(a) - onSite(b) || (sort === 'risk'
      ? a.risk - b.risk || b.scenarios[1].money.net - a.scenarios[1].money.net
      : b.scenarios[1].money[sort] - a.scenarios[1].money[sort])
  })
  const rows = panel === 'arbitrage'
    ? arbitrage.map(item => ({
      origin: item.from.exchange, key: `${item.mode}.${item.from.ticker}.${item.from.exchange}.${item.to.exchange}`,
      content: <ArbitrageDetails item={item} currency={currency} rates={costs.rates} now={now} demo={demo} navigation={navigation}/>,
    }))
    : (speculative?.opportunities ?? []).map(item => ({
      origin: item.from.exchange, key: `${pairKey(item.to.ticker, item.to.exchange)}.${item.from.exchange}`,
      content: <SpeculationDetails item={item} currency={currency} rates={costs.rates} now={now} demo={demo} navigation={navigation}/>,
    }))
  const { local, reposition } = groupByDeparture(rows, parking, row => row.origin)
  const shown = Math.min(local.length, limit) + Math.min(reposition.length, limit)
  const resetDeparture = () => { setFrom(''); setTo(''); setLimit(PAGE_SIZE) }

  function tariff(key: keyof TariffForm, label: string) {
    return <NumericField label={label} value={tariffForm[key]} placeholder="Inconnu" onChange={value => {
      ships.update(item => ({ ...item, byCurrency: {
        ...item.byCurrency, [currency]: { ...tariffForm, [key]: value },
      } }))
      setLimit(PAGE_SIZE)
    }}/>
  }

  function field(key: keyof typeof defaults, label: string, props?: { step?: string; min?: number; max?: number; placeholder?: string }) {
    return <NumericField label={label} value={form[key]} {...props} onChange={value => {
      setForm(previous => ({ ...previous, [key]: value })); setLimit(PAGE_SIZE)
    }}/>
  }

  async function requestPair(row: Market) {
    const pair = pairKey(row.ticker, row.exchange)
    setRequest({ pair, phase: 'loading' })
    try {
      const value = await loadPairHistory(row, now, AbortSignal.timeout(12_000))
      setManual(previous => ({ ...previous, [pair]: value }))
      setRequest(null)
    } catch {
      setRequest({ pair, phase: 'failed' })
    }
  }

  return <>
    <SectionHead title="Scanner commercial">Comparez des exécutions simulées et explorez les écarts aux prix historiques.</SectionHead>
    <section className="scanner-controls" aria-label="Position du vaisseau">
      <div className="scanner-grid">
        <label className="field"><span>Vaisseau sélectionné</span><select value={ships.current.id} onChange={event => {
          ships.select(Number(event.target.value)); resetDeparture()
        }}>
          {ships.ships.map(item => <option key={item.id} value={item.id}>{item.name.trim() || `Vaisseau ${item.id}`}</option>)}
        </select></label>
        <ExchangeField label="Marché de stationnement" data={data} value={parking} empty="Choisir une bourse" set={value => {
          ships.update(item => ({ ...item, parking: value })); resetDeparture()
        }}/>
        <button className="button" onClick={() => { ships.add(); resetDeparture() }}>Ajouter un vaisseau</button>
      </div>
      <details className="scanner-options">
        <summary>Renommer le vaisseau</summary>
        <label className="field"><span>Nom du vaisseau</span>
          <input type="text" maxLength={40} value={ships.current.name} onChange={event => {
            const name = event.target.value
            ships.update(item => ({ ...item, name }))
          }}/>
        </label>
      </details>
      <FlightSettings key={ships.current.id} data={data} profile={ships.current.navigation} save={value =>
        ships.update(item => ({ ...item, navigation: value }))} parking={parking} currency={currency} navigation={navigation}/>
      <div className="switch scanner-scope" role="group" aria-label="Périmètre du scanner">
        <button aria-pressed={scope === 'local'} onClick={() => { setScope('local'); setLimit(PAGE_SIZE) }}>Départ de mon marché</button>
        <button aria-pressed={scope === 'all'} onClick={() => { setScope('all'); setLimit(PAGE_SIZE) }}>Toutes les bourses</button>
      </div>
    </section>
    <div className="switch scanner-tabs" role="group" aria-label="Moteur d’analyse">
      <button aria-pressed={panel === 'arbitrage'} onClick={() => {setPanel('arbitrage'); setLimit(PAGE_SIZE)}}>Arbitrage</button>
      <button aria-pressed={panel === 'speculation'} onClick={() => {setPanel('speculation'); setLimit(PAGE_SIZE)}}>Spéculation</button>
    </div>
    <section className="scanner-controls" aria-label="Filtres et paramètres de simulation">
      <div className="scanner-grid">
        {scope === 'all' && <ExchangeField label="Bourse d’achat" data={data} value={from} set={value => {setFrom(value); setLimit(PAGE_SIZE)}}/>}
        <ExchangeField label="Bourse de revente" data={data} value={to} set={value => {setTo(value); setLimit(PAGE_SIZE)}}/>
        <Search placeholder="Rechercher un matériau" value={query} onChange={value => {setQuery(value); setLimit(PAGE_SIZE)}}/>
        <label className="field"><span>Devise de référence</span><select value={currencyOverride} onChange={event => {setCurrency(event.target.value); setLimit(PAGE_SIZE)}}>
          <option value="">Automatique · {parked?.currency ?? currencies[0]}</option>
          {currencies.map(code => <option key={code}>{code}</option>)}
        </select></label>
        <NumericField label={`Capital (${currency})`} value={capital} onChange={value => {
          setBudgets(previous => ({ ...previous, [currency]: value })); setLimit(PAGE_SIZE)
        }}/>
        {field('minReturn', 'Rendement minimal (%)')}
        {field('minLiquidity', panel === 'arbitrage' ? 'Profondeur minimale (unités)' : 'Volume médian minimal (unités/j)')}
      </div>
      <details className="scanner-options">
        <summary>Frais, transport, quantités et change</summary>
        <div className="scanner-grid">
          {field('buyFee', 'Frais d’achat (%)', { max: 100 })}
          {field('sellFee', 'Frais de vente (%)', { max: 99.99 })}
          {tariff('emptyFixed', `Trajet à vide (${currency})`)}
          {tariff('loadedFixed', `Trajet chargé, montant fixe (${currency})`)}
          {tariff('loadedUnit', `Trajet chargé, par unité (${currency})`)}
          {field('minQuantity', 'Quantité minimale', { step: '1', min: 1 })}
          {field('maxQuantity', 'Quantité maximale', { step: '1', min: 1 })}
        </div>
      </details>
      <details className="scanner-options">
        <summary>Taux de change APEX · {currencies.filter(code => code !== currency && (knownTariff(rates[code] ?? '') ?? 0) > 0).length} sur {currencies.length - 1}</summary>
        <p className="muted scanner-gap-intro">Relevez le taux dans FX ou FXOB. Saisissez la valeur d’une unité de la devise locale en {currency}. Les taux sont des hypothèses de simulation, mémorisées dans ce navigateur.</p>
        <div className="scanner-grid">
          {currencies.filter(code => code !== currency).map(code => <NumericField key={code} label={`1 ${code} en ${currency}`}
            placeholder="Sans conversion" value={rates[code] ?? ''} onChange={value => {
              setExchangeRates(previous => ({ ...previous, [currency]: { ...rates, [code]: value } })); setLimit(PAGE_SIZE)
            }}/>)}
        </div>
        {ratesInvalid && <p role="status" className="error">Les taux invalides doivent être corrigés. Ils sont traités comme absents pour les paires concernées.</p>}
        <a className="button" href="https://handbook.apex.prosperousuniverse.com/tutorials/legacy-tutorials/foreign-exchange/" target="_blank" rel="noreferrer">Guide du change dans APEX</a>
      </details>
      <p className="muted">Les tarifs saisis sont des estimations par trajet, dans la devise affichée. Le trajet se termine à la bourse de revente. Renseignez un taux pour inclure une autre devise.</p>
      {panel === 'arbitrage' && <div className="scanner-grid scanner-mode">
        <label className="field"><span>Mode de revente</span><select value={mode} onChange={event => {setMode(event.target.value as SaleMode); setLimit(PAGE_SIZE)}}>
          <option value="immediate">Vente immédiate</option><option value="limit">Ordre limite futur</option>
        </select></label>
        {mode === 'limit' && field('target', `Prix limite unitaire (${currency})`, { placeholder: 'Meilleure offre de vente' })}
      </div>}
    </section>
    {panel === 'arbitrage' && <p className="scanner-notice">{mode === 'immediate'
      ? 'La vente immédiate suppose que les ordres observés restent disponibles jusqu’à l’arrivée des marchandises.'
      : 'Scénario conditionnel. Sans prix saisi, le scanner utilise la meilleure offre de vente observée à destination.'}</p>}
    {!parking && <Empty>Choisissez le marché de stationnement du vaisseau pour calculer les opportunités.</Empty>}
    {!!report?.reviews.length &&
      <p className="scanner-notice">Coût de transport inconnu ou non vérifié pour certaines pistes. Consultez « À vérifier » et renseignez un relevé SFC ou les tarifs de secours.</p>}
    {!snapshotUsable && <Empty>Instantané FIO ancien ou horodatage indéterminé. Actualisez les données pour relancer le scanner.</Empty>}
    {invalid && <Empty>Vérifiez les paramètres de simulation. Le capital doit être positif, et les quantités entières et cohérentes.</Empty>}
    {panel === 'speculation' && <section className="history-status" aria-label="État des historiques">
      <p>{demo ? 'Séries historiques fictives.'
        : history ? `Historique collecté le ${formatTime(history.collectedAt)} · ${history.series.length} paires embarquées${history.failed.length ? ` · ${history.failed.length} échecs` : ''}`
        : failed ? 'Historique embarqué indisponible.' : 'Chargement de l’historique embarqué…'}</p>
      <p className="muted">Scénarios sur les 30 derniers jours UTC complets. Les résultats dépendent du prix et de l’exécution réelle de la revente.</p>
      {failed && <button className="button" onClick={retry}>Recharger l’historique</button>}
      {speculative && <p>{speculative.usable} historiques exploitables · {speculative.stale} cotations anciennes · {speculative.uncovered} historiques absents · {speculative.insufficient.length} insuffisants</p>}
      {!demo && bundledMissing && exact && <button className="button" disabled={request?.phase === 'loading'} onClick={() => void requestPair(exact)}>
        {request?.phase === 'loading' ? 'Chargement FIO…' : `Charger l’historique de ${exactKey}`}
      </button>}
      {request?.phase === 'failed' && <p className="error" role="status">Historique FIO indisponible pour {request.pair}.</p>}
      {!demo && exactKey && manual[exactKey] && <p>Historique {exactKey} chargé directement depuis FIO.</p>}
      {!!speculative?.insufficient.length && <details className="scanner-options">
        <summary>Historiques insuffisants</summary>
        <ul>{speculative.insufficient.map(({ market, reason }) =>
          <li key={pairKey(market.ticker, market.exchange)}><b>{pairKey(market.ticker, market.exchange)}</b> · {reason}</li>)}</ul>
      </details>}
    </section>}
    {arbitrageReport && <p className="scanner-gap-intro">
      <b>{arbitrageReport.localCandidates}</b> pistes en devise locale avant transport
      {' · '}<button className="button" onClick={() => document.getElementById('scanner-raw-prices')?.scrollIntoView()}>Voir les prix bruts</button>
    </p>}
    <div className="section-title scanner-results">
      <h2>{panel === 'speculation' ? 'Scénarios rentables estimés' : 'Trajets rentables estimés'}</h2>
      <label className="field"><span>Classement</span><select value={sort} onChange={event => {setSort(event.target.value as Sort); setLimit(PAGE_SIZE)}}>
        <option value="net">Bénéfice net décroissant</option><option value="yield">Rendement décroissant</option><option value="risk">Risque croissant</option>
      </select></label>
    </div>
    {parking && snapshotUsable && !invalid && <>
      <section aria-label="Opportunités depuis mon marché" className="scanner-result-group">
        <h3>Depuis {parking} · {local.length} {local.length === 1 ? 'opportunité' : 'opportunités'}</h3>
        {local.length ? <div className="records">{local.slice(0, limit).map(row => <div key={row.key}>{row.content}</div>)}</div>
          : <Empty>Aucune opportunité rentable depuis le marché de stationnement avec ces filtres.</Empty>}
      </section>
      {scope === 'all' && <section aria-label="Opportunités avec trajet à vide" className="scanner-result-group">
        <h3>Avec trajet à vide · {reposition.length} {reposition.length === 1 ? 'opportunité' : 'opportunités'}</h3>
        {reposition.length ? <div className="records">{reposition.slice(0, limit).map(row => <div key={row.key}>{row.content}</div>)}</div>
          : <Empty>Aucune opportunité rentable avec un trajet à vide et les coûts renseignés.</Empty>}
      </section>}
      <ShowMore shown={shown} total={rows.length} more={() => setLimit(limit + PAGE_SIZE)}/>
    </>}
    <Assessment diagnostics={report?.diagnostics ?? {}} reviews={report?.reviews ?? []} deficits={report?.deficits ?? []}
      parking={parking} currency={currency} navigation={navigation} snapshotUsable={snapshotUsable} invalid={invalid}
      speculation={panel === 'speculation'} stages={arbitrageReport?.stages}/>
    {arbitrageReport && <GrossPrices quotes={arbitrageReport.gaps} localCandidates={arbitrageReport.localCandidates}
      source={data.source} now={now} currency={currency} financeReady={financeReady} selectCurrency={code => {
        setCurrency(code)
        setBudgets(previous => ({ ...previous, [code]: previous[code] ?? '' }))
        setLimit(PAGE_SIZE)
      }}/>}
  </>
}
