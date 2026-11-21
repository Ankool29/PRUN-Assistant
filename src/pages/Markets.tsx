import { useState } from 'react'
import type { Exchange, Market, Order, Snapshot } from '../data.ts'
import { displayName, formatPrice, formatTime, numeric, searchKey, spread } from '../domain.ts'
import { Empty, PAGE_SIZE, Search, SectionHead, ShowMore, Status } from '../ui.tsx'

function OrderSide({ title, orders, decimals }: { title: string; orders: Order[]; decimals: number }) {
  return <section className="order-side">
    <h4>{title}</h4>
    {orders.length ? <table><thead><tr><th scope="col">Prix unitaire</th><th scope="col">Quantité</th></tr></thead>
      <tbody>{orders.map((order, index) => <tr key={index}>
        <td>{formatPrice(order.price, decimals)}</td><td>{order.quantity === null ? 'Non indiquée' : numeric(order.quantity)}</td>
      </tr>)}</tbody></table> : <p className="muted">Aucun ordre publié.</p>}
  </section>
}

function MarketRow({ row, exchange, name, source, now }: {
  row: Market; exchange?: Exchange; name?: string; source: Snapshot['source']; now: number
}) {
  const [expanded, setExpanded] = useState(false)
  const price = (value: number | null) => formatPrice(value, exchange?.decimals)
  return <details className="record market-record" onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>
      <span className="record-label"><span className="ticker">{row.ticker}</span><strong>{name ? displayName(name) : row.ticker}</strong></span>
      <span className="record-prices"><span><small>Achat</small><b>{price(row.bid)}</b></span><span><small>Vente</small><b>{price(row.ask)}</b></span><span className="last-price"><small>Dernier</small><b>{price(row.last)}</b></span></span>
      <Status source={source} timestamp={row.observedAt} now={now} short/>
    </summary>
    {expanded && <div className="record-body">
      <dl className="facts">
        <div><dt>Écart vente − achat</dt><dd>{price(spread(row.bid, row.ask))} {row.currency}</dd></div>
        <div><dt>Dernier prix</dt><dd>{price(row.last)} {row.currency}</dd></div>
        <div><dt>Prix moyen</dt><dd>{price(row.average)} {row.currency}</dd></div>
        <div><dt>Offre / demande</dt><dd>{numeric(row.supply)} / {numeric(row.demand)}</dd></div>
        <div><dt>Achat / vente du teneur de marché</dt><dd>{price(row.marketMakerBuy)} / {price(row.marketMakerSell)} {row.currency}</dd></div>
        <div><dt>Cotation observée</dt><dd>{formatTime(row.observedAt)}</dd></div>
        <div><dt>Dernière transaction</dt><dd>{formatTime(row.lastTradeAtMs)}</dd></div>
      </dl>
      <h3>Carnet d’ordres <small>· {row.currency}</small></h3>
      <div className="orders"><OrderSide title="Ordres d’achat" orders={row.buys} decimals={exchange?.decimals ?? 2}/><OrderSide title="Ordres de vente" orders={row.sells} decimals={exchange?.decimals ?? 2}/></div>
    </div>}
  </details>
}

export function Markets({ data, now, requestedExchange }: { data: Snapshot; now: number; requestedExchange: string }) {
  const defaultExchange = data.exchanges.some(item => item.code === requestedExchange) ? requestedExchange
    : data.exchanges.find(item => item.code === 'AI1')?.code ?? data.exchanges[0].code
  const [code, setCode] = useState(defaultExchange)
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE_SIZE)
  const exchange = data.exchanges.find(item => item.code === code)
  const names = new Map(data.materials.map(item => [item.ticker, item.name]))
  const term = searchKey(query)
  const markets = data.markets.filter(row => row.exchange === code &&
    searchKey(`${row.ticker} ${displayName(names.get(row.ticker) ?? '')}`).includes(term))
  return <>
    <SectionHead title="Marchés">Consultez les cotations et ouvrez une ligne pour voir son carnet d’ordres.</SectionHead>
    <div className="filters">
      <label className="field"><span>Bourse</span><select value={code} onChange={event => {setCode(event.target.value); setLimit(PAGE_SIZE)}}>
        {data.exchanges.map(item => <option key={item.code} value={item.code}>{item.code} · {item.station}</option>)}
      </select></label>
      <Search value={query} onChange={value => {setQuery(value); setLimit(PAGE_SIZE)}} placeholder="Rechercher un matériau"/>
    </div>
    <div className="section-title listing-title"><h2>Cotations</h2><small>Devise {exchange?.currency}</small></div>
    {markets.length ? <div className="records">{markets.slice(0, limit).map(row =>
      <MarketRow key={`${row.exchange}.${row.ticker}`} row={row} exchange={exchange} name={names.get(row.ticker)} source={data.source} now={now}/>
    )}</div> : <Empty/>}
    <ShowMore shown={limit} total={markets.length} more={() => setLimit(limit + PAGE_SIZE)}/>
  </>
}
