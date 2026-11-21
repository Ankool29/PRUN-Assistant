import type { Market } from '../data.ts'
import { formatPrice, formatTime, numeric } from '../domain.ts'
import { Status } from '../ui.tsx'
import type { Arbitrage } from './arbitrage.ts'
import type { Financials } from './execution.ts'
import type { Itinerary } from './itinerary.ts'
import type { Speculation } from './speculation.ts'

export const percent = (value: number) => new Intl.NumberFormat('fr-FR', {
  style: 'percent', maximumFractionDigits: 2,
}).format(value)

function Finances({ money, currency }: { money: Financials; currency: string }) {
  const rows: [string, number][] = [
    ['Achat', money.buy], ['Revente', money.sell], ['Bénéfice brut', money.gross],
    ['Frais d’achat', money.buyFee], ['Frais de vente', money.sellFee], ['Transport', money.shipping],
    ['Capital mobilisé', money.invested], ['Bénéfice net estimé', money.net],
  ]
  return <dl className="facts">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{formatPrice(value)} {currency}</dd></div>)}</dl>
}

function Travel({ route, quantity, currency }: { route: Itinerary; quantity: number; currency: string }) {
  return <><h3>Itinéraire</h3>
    {route.legs.length ? <ol className="scanner-legs">{route.legs.map(leg => <li key={leg.kind}>
      {leg.from} vers {leg.to} · {leg.kind === 'empty' ? 'À vide' : 'Chargé'} · {formatPrice(leg.fixed + leg.unit * quantity)} {currency}
    </li>)}</ol> : <p>Achat et revente sur place.</p>}
  </>
}

function observationAge(timestamp: string | null, now: number) {
  if (timestamp === null) return 'âge indéterminé'
  const minutes = Math.max(0, Math.floor((now - Date.parse(timestamp)) / 60_000))
  return minutes >= 60 ? `il y a ${Math.floor(minutes / 60)} h ${minutes % 60} min` : `il y a ${minutes} min`
}

function BookTime({ markets, now, demo }: { markets: Market[]; now: number; demo: boolean }) {
  return <ul className="scanner-times">{markets.map(market =>
    <li key={market.exchange}><b>{market.exchange}</b> <Status source={demo ? 'demo' : 'fio'} timestamp={market.observedAt} now={now} short/>
      {!demo && <span>{formatTime(market.observedAt)} · {observationAge(market.observedAt, now)}</span>}</li>)}</ul>
}

function Summary({ ticker, title, money, risk, currency }: {
  ticker: string; title: string; money: Financials; risk: number; currency: string
}) {
  return <summary><span className="record-label"><span className="ticker">{ticker}</span><strong>{title}</strong></span>
    <span className="scanner-gain"><b>{formatPrice(money.net)} {currency}</b><small>{percent(money.yield)} · Risque {risk}/100</small></span>
  </summary>
}

export function ArbitrageDetails({ item, currency, rates, now, demo }: {
  item: Arbitrage; currency: string; rates: Readonly<Record<string, number>>; now: number; demo: boolean
}) {
  return <details className="record scanner-record">
    <Summary ticker={item.from.ticker} title={`${item.from.exchange} vers ${item.to.exchange}`} money={item.money} risk={item.risk} currency={currency}/>
    <div className="record-body">
      <BookTime markets={[item.from, item.to]} now={now} demo={demo}/>
      <h3>{item.mode === 'immediate' ? 'Vente aux ordres d’achat observés' : 'Vente future par ordre limite'}</h3>
      {item.mode === 'limit' && <p className="scanner-notice">Le produit de la vente dépend d’une exécution future. Le délai et la quantité exécutée sont inconnus.</p>}
      <p className="muted">{numeric(item.quantity)} unités simulées · Profondeur bilatérale {numeric(item.liquidity)} unités</p>
      {[...new Set([item.from.currency, item.to.currency])].filter(code => code !== currency).map(code =>
        <p className="muted" key={code}>1 {code} ≈ {numeric(rates[code])} {currency} (taux saisi)</p>)}
      <Travel route={item.route} quantity={item.quantity} currency={currency}/>
      <Finances currency={currency} money={item.money}/>
      <p className="muted">Le risque augmente avec l’âge des carnets, la proportion de la profondeur utilisée, le change et l’incertitude d’une vente limite.</p>
      <h3>Niveaux simulés <small>· {currency} par unité</small></h3>
      <table className="scanner-table">
        <thead><tr><th scope="col">Quantité</th><th scope="col">Achat</th><th scope="col">{item.mode === 'limit' ? 'Limite' : 'Vente'}</th></tr></thead>
        <tbody>{item.fills.map((fill, index) => <tr key={index}><td>{numeric(fill.quantity)}</td><td>{formatPrice(fill.buy)}</td><td>{formatPrice(fill.sell)}</td></tr>)}</tbody>
      </table>
    </div>
  </details>
}

const scenarioLabels = ['Pessimiste', 'Neutre', 'Optimiste']
export function SpeculationDetails({ item, currency, rates, now, demo }: {
  item: Speculation; currency: string; rates: Readonly<Record<string, number>>; now: number; demo: boolean
}) {
  const { stats, to: market, from, scenarios } = item
  const resale = from.exchange === market.exchange ? `${market.exchange} · revente sur place` : `${from.exchange} vers ${market.exchange}`
  return <details className="record scanner-record">
    <Summary ticker={market.ticker} title={`${resale} · scénario neutre`} money={scenarios[1].money} risk={item.risk} currency={currency}/>
    <div className="record-body">
      <BookTime markets={from === market ? [market] : [from, market]} now={now} demo={demo}/>
      <h3>Référence historique <small>· {market.currency}</small></h3>
      <dl className="facts">
        <div><dt>Moyenne / médiane</dt><dd>{formatPrice(stats.mean)} / {formatPrice(stats.median)}</dd></div>
        <div><dt>Décote / seuil</dt><dd>{percent(item.discount)} / {percent(stats.threshold)}</dd></div>
        <div><dt>Volatilité quotidienne</dt><dd>{percent(stats.volatility)}</dd></div>
        <div><dt>Tendance par jour</dt><dd>{percent(stats.trend)}</dd></div>
        <div><dt>Volume médian par jour</dt><dd>{numeric(stats.medianUnits)} unités</dd></div>
        <div><dt>Montant échangé moyen</dt><dd>{formatPrice(stats.turnover)} {market.currency}/j</dd></div>
        <div><dt>Jours valides / observés</dt><dd>{stats.pricedDays} / {stats.observedDays} sur 30</dd></div>
        <div><dt>Clôtures aberrantes écartées</dt><dd>{stats.outliers}</dd></div>
        <div><dt>Dernier jour négocié valide</dt><dd>{demo ? 'Jour fictif' : formatTime(stats.lastDay)}</dd></div>
      </dl>
      <h3>Scénarios de revente <small>· {currency}</small></h3>
      <p className="scanner-notice">Ces résultats reposent sur les quantiles 20 %, 50 % et 80 % des clôtures passées. Une revente peut ne pas s’exécuter ou entraîner une perte.</p>
      <table className="scanner-table">
        <thead><tr><th scope="col">Scénario</th><th scope="col">Prix/u</th><th scope="col">Net</th><th scope="col">Rendement</th></tr></thead>
        <tbody>{scenarios.map((item, i) => <tr key={scenarioLabels[i]}>
          <th scope="row">{scenarioLabels[i]}</th><td>{formatPrice(item.price)}</td><td>{formatPrice(item.money.net)}</td><td>{percent(item.money.yield)}</td>
        </tr>)}</tbody>
      </table>
      <h3>Calcul du scénario neutre</h3>
      {[...new Set([from.currency, market.currency])].filter(code => code !== currency).map(code =>
        <p className="muted" key={code}>1 {code} ≈ {numeric(rates[code])} {currency} (taux saisi)</p>)}
      <Travel route={item.route} quantity={item.quantity} currency={currency}/>
      <Finances currency={currency} money={scenarios[1].money}/>
      <p className="muted">Le risque tient compte de l’âge de la cotation, de la volatilité, de la couverture historique, du volume engagé et de la perte pessimiste.</p>
      <h3>Achat simulé <small>· {numeric(item.quantity)} unités</small></h3>
      <table className="scanner-table"><thead><tr><th scope="col">Quantité</th><th scope="col">Prix/u ({currency})</th></tr></thead>
        <tbody>{item.levels.map((level, index) => <tr key={index}><td>{numeric(level.quantity)}</td><td>{formatPrice(level.price)}</td></tr>)}</tbody></table>
    </div>
  </details>
}
