import { useState } from 'react'
import { PAGE_SIZE } from '../ui.tsx'
import { formatPrice, numeric } from '../domain.ts'
import { Alternatives, Travel } from './details.tsx'
import { MapPaths } from './FlightSettings.tsx'
import type { NavigationData } from './navigation.ts'
import { stageLabels, type Stages } from './arbitrage.ts'
import type { Deficit, Diagnostics, Review } from './trade.ts'

export function Assessment({ diagnostics, reviews, deficits, snapshotUsable, invalid, parking, currency, navigation, speculation, stages }: {
  diagnostics: Diagnostics; reviews: Review[]; deficits: Deficit[]; snapshotUsable: boolean; invalid: boolean
  parking: string; currency: string; navigation: NavigationData | null; speculation: boolean; stages?: Stages
}) {
  const [visible, setVisible] = useState(PAGE_SIZE)
  const entries = Object.entries(diagnostics).sort((a, b) => b[1] - a[1])
  const exclusions = entries.reduce((total, [, count]) => total + count, 0)
  const byParking = (a: Review, b: Review) => Number(b.from.exchange === parking) - Number(a.from.exchange === parking)
  const reviewRows = [...reviews].sort((a, b) => byParking(a, b) || b.margin - a.margin)
  const deficitRows = [...deficits].sort((a, b) => byParking(a, b) || b.money.net - a.money.net)
  return <>
    <details className="scanner-options scanner-controls">
      <summary>Diagnostic · {numeric(exclusions)} exclusions</summary>
      <p>{speculation ? 'Les compteurs portent sur les carnets d’achat, les historiques de revente ou les comparaisons selon le contrôle.'
        : 'Chaque comparaison de carnets reçoit le premier motif d’exclusion rencontré.'}</p>
      {stages && <dl className="scanner-stage-counts" aria-label="Comparaisons franchissant chaque filtre">
        {(Object.keys(stageLabels) as (keyof Stages)[]).map(key => <div key={key}>
          <dt>{stageLabels[key]}</dt><dd>{numeric(stages[key])}</dd>
        </div>)}
      </dl>}
      {!parking && <p>Marché de stationnement non renseigné.</p>}
      {!snapshotUsable && <p>Analyse suspendue avant comparaison · instantané FIO trop ancien ou sans date fiable.</p>}
      {invalid && <p>Analyse suspendue avant comparaison · filtres ou taux de change invalides.</p>}
      {entries.length > 0 && <ul className="scanner-legs">{entries.map(([label, value]) =>
        <li key={label}><b>{numeric(value)}</b> · {label}</li>,
      )}</ul>}
      {!entries.length && parking && snapshotUsable && !invalid && <p>Aucune exclusion dans les données sélectionnées.</p>}
    </details>
    {parking && snapshotUsable && !invalid && <>
      <section className="scanner-result-group" aria-label="Opportunités à vérifier">
        <h3>À vérifier · {reviews.length}</h3>
        {reviewRows.length ? <div className="records">{reviewRows.slice(0, visible).map(row => <details className="record scanner-record"
          key={`${row.from.ticker}.${row.from.exchange}.${row.to.exchange}`}>
          <summary><span className="record-label"><span className="ticker">{row.from.ticker}</span><strong>{row.from.exchange} vers {row.to.exchange}</strong></span>
            <span className="scanner-gain"><b>{formatPrice(row.margin)} {currency}</b><small>Avant transport</small></span></summary>
          <div className="record-body">
            <p>{numeric(row.quantity)} unités · Marge commerciale après frais de marché. Bénéfice net indéterminé.</p>
            <ul>{row.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
            <MapPaths navigation={navigation} from={parking} to={row.from.exchange}/>
            <MapPaths navigation={navigation} from={row.from.exchange} to={row.to.exchange}/>
          </div>
        </details>)}</div> : <p className="muted">Aucune piste en attente de vérification du transport.</p>}
      </section>
      <section className="scanner-result-group" aria-label="Opportunités déficitaires">
        <h3>Déficitaires ou à l’équilibre · {deficits.length}</h3>
        {deficitRows.length ? <div className="records">{deficitRows.slice(0, visible).map(row => <details className="record scanner-record"
          key={`${row.from.ticker}.${row.from.exchange}.${row.to.exchange}`}>
          <summary><span className="record-label"><span className="ticker">{row.from.ticker}</span><strong>{row.from.exchange} vers {row.to.exchange}</strong></span>
            <span className="scanner-gain"><b className="error">{formatPrice(row.money.net)} {currency}</b><small>Net estimé</small></span></summary>
          <div className="record-body">
            <p>{numeric(row.quantity)} unités{speculation ? ' · Scénario neutre' : ''} · Marge avant transport {formatPrice(row.money.net + row.money.shipping)} {currency}.</p>
            <Travel route={row.route} quantity={row.quantity} currency={currency} navigation={navigation}/>
            <Alternatives items={row.alternatives} currency={currency} navigation={navigation}/>
          </div>
        </details>)}</div> : <p className="muted">Aucune piste chiffrée déficitaire avec ces filtres.</p>}
      </section>
      {(reviewRows.length > visible || deficitRows.length > visible) &&
        <button className="button" onClick={() => setVisible(visible + PAGE_SIZE)}>Afficher d’autres pistes analysées</button>}
    </>}
  </>
}
