import type { Snapshot } from '../data.ts'
import { formatTime, freshness, numeric } from '../domain.ts'
import { Empty, Icon, type IconName } from '../ui.tsx'

export function Dashboard({ data, now }: { data: Snapshot | null; now: number }) {
  const metrics: [string, number | undefined, IconName, string][] = [
    ['Bourses', data?.exchanges.length, 'market', '#marches'],
    ['Matériaux', data?.materials.length, 'cube', '#materiaux'],
    ['Recettes', data?.recipes.length, 'factory', '#production'],
    ['Cotations', data?.markets.length, 'layers', '#marches'],
  ]
  const freshCounts = new Map<string, number>()
  const marketCounts = new Map<string, number>()
  for (const row of data?.markets ?? []) {
    marketCounts.set(row.exchange, (marketCounts.get(row.exchange) ?? 0) + 1)
    if (freshness(row.observedAt, now) === 'fresh') {
      freshCounts.set(row.exchange, (freshCounts.get(row.exchange) ?? 0) + 1)
    }
  }

  return <>
    <section className="hero" aria-labelledby="dashboard-title">
      <div className="hero-content">
        <div className="overline"><span/> PROSPEROUS UNIVERSE</div>
        <h1 id="dashboard-title">Tableau de bord</h1>
        <p>Suivez les marchés et consultez les matériaux et recettes de l’univers.</p>
        <a className="button primary" href="#marches"><Icon name="market" size={19}/>Explorer les marchés</a>
      </div>
      <div className="hero-art" aria-hidden="true"><i/><i/><i/><b/><b/><b/></div>
    </section>
    <section className="dashboard-section" aria-labelledby="overview">
      <h2 id="overview">Vue d’ensemble</h2>
      <div className="metrics">{metrics.map(([label, value, icon, link]) =>
        <a href={link} className="metric" key={label}>
          <span className="metric-icon"><Icon name={icon}/></span>
          <span className="metric-number">{numeric(value ?? null)}</span>
          <span className="muted">{label}</span>
        </a>)}</div>
    </section>
    <section className="dashboard-section" aria-labelledby="exchanges">
      <div className="section-title"><h2 id="exchanges">Bourses</h2><small>{data?.collectedAt && `Collecte du ${formatTime(data.collectedAt)}`}</small></div>
      {data ? <div className="exchange-list">{data.exchanges.map(exchange => <a className="exchange-row" href={`#marches/${exchange.code}`} key={exchange.code}>
        <span className="ticker">{exchange.code}</span>
        <span className="exchange-name"><strong>{exchange.station}</strong><small>{exchange.currency}</small></span>
        <span className="exchange-count">{data.source === 'fio' ? `${freshCounts.get(exchange.code) ?? 0} / ${marketCounts.get(exchange.code) ?? 0} récentes` : `${marketCounts.get(exchange.code) ?? 0} cotations fictives`}</span>
        <Icon name="chevron" size={16}/>
      </a>)}</div> : <Empty>Données de bourse indisponibles.</Empty>}
    </section>
  </>
}
