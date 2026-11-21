import { useState } from 'react'
import { formatPrice, formatTime, numeric } from '../domain.ts'
import { PAGE_SIZE, ShowMore, Status } from '../ui.tsx'
import type { GrossGap } from './arbitrage.ts'

type Filter = 'all' | 'native' | 'fx' | 'old'
export function GrossPrices({ quotes, localCandidates, source, now, currency, financeReady, selectCurrency }: {
  quotes: GrossGap[]; localCandidates: number; source: 'demo' | 'fio'; now: number; currency: string;
  financeReady: boolean; selectCurrency: (currency: string) => void
}) {
  const [filter, setFilter] = useState<Filter>('all')
  const [visible, setVisible] = useState(PAGE_SIZE)
  const rows = quotes.filter(quote => {
    const same = quote.from.currency === quote.to.currency
    if (filter === 'native') return same
    if (filter === 'fx') return !same && quote.difference === null && quote.purchase !== null && quote.resale !== null
    if (filter === 'old') return !quote.recent
    return true
  }).sort((a, b) => Number(b.recent) - Number(a.recent)
    || Number(!!b.localMarket) - Number(!!a.localMarket)
    || (b.relative ?? -Infinity) - (a.relative ?? -Infinity))
  return <section id="scanner-raw-prices" className="scanner-result-group" aria-label="Écarts de prix bruts">
    <h3>Écarts de prix bruts · {numeric(quotes.length)}</h3>
    <p className="muted scanner-gap-intro">{numeric(localCandidates)} pistes en devise locale ont une marge commerciale positive sur carnets récents, avant contrôle du capital et du transport.</p>
    <p className="muted scanner-gap-intro">Les prix affichés sont les observations {source === 'demo' ? 'fictives' : 'FIO'}. Les données anciennes restent consultables avec leur date.</p>
    <label className="field scanner-gap-filter"><span>Filtrer les prix bruts</span>
      <select value={filter} onChange={event => { setFilter(event.target.value as Filter); setVisible(PAGE_SIZE) }}>
        <option value="all">Toutes les paires</option><option value="native">Même devise</option>
        <option value="fx">Change manquant</option><option value="old">Carnets non récents</option>
      </select>
    </label>
    {rows.length ? <div className="records">{rows.slice(0, visible).map(row => {
      const both = row.purchase !== null && row.resale !== null
      const same = row.from.currency === row.to.currency
      return <details className="record" key={`${row.from.ticker}.${row.from.exchange}.${row.to.exchange}`}>
        <summary><span className="record-label"><span className="ticker">{row.from.ticker}</span><strong>{row.from.exchange} vers {row.to.exchange}</strong></span>
          <span className="scanner-gain">
            {row.difference === null ? <small>{both ? 'Change manquant' : 'Prix incomplets'}</small>
              : <><b>{formatPrice(row.difference)} {row.differenceCurrency}</b><small>{row.recent ? 'Écart brut / unité' : 'Écart de référence'}</small></>}
          </span>
        </summary>
        <div className="record-body">
          <dl className="facts">
            <div><dt>Achat · {row.from.exchange}</dt><dd>{formatPrice(row.purchase)} {row.from.currency}</dd></div>
            <div><dt>Demande à la revente · {row.to.exchange}</dt><dd>{formatPrice(row.resale)} {row.to.currency}</dd></div>
          </dl>
          <ul className="scanner-times">{[row.from, row.to].map(market => <li key={market.exchange}>
            {market.exchange} <Status source={source} timestamp={market.observedAt} now={now} short/>
            {source === 'fio' && <span>{formatTime(market.observedAt)}</span>}
          </li>)}</ul>
          {row.publishedOnly && <p>Prix indicatif sur au moins un côté · quantité non vérifiée.</p>}
          {!row.recent && <p>Comparaison financière suspendue pour ces carnets anciens ou sans date fiable.</p>}
          {both && !same && row.difference === null && <p>Écart monétaire et bénéfice net indéterminés · taux manquant pour comparer {row.from.currency} et {row.to.currency} en {currency}.</p>}
          {row.localMarket && <p>Marge de marché locale après frais · {formatPrice(row.localMarket.margin)} {row.from.currency} pour {numeric(row.localMarket.quantity)} unités, avant capital et transport.</p>}
          {row.recent && both && same && row.from.currency !== currency && <>
            <p>Le prix se compare en {row.from.currency}. Le calcul avec le capital en {currency} demande un taux de change ou un budget en {row.from.currency}.</p>
            <button className="button" onClick={() => selectCurrency(row.from.currency)}>Évaluer en {row.from.currency}</button>
          </>}
          {row.recent && both && row.difference !== null && (financeReady ? <p>Le diagnostic et les sections de résultat détaillent le capital, le transport et le bénéfice net.</p>
            : <p>Analyse financière indisponible avec l’instantané ou les paramètres actuels.</p>)}
        </div>
      </details>
    })}</div> : <p className="muted">Aucun prix brut pour ce filtre.</p>}
    <ShowMore shown={visible} total={rows.length} more={() => setVisible(visible + PAGE_SIZE)}/>
  </section>
}
