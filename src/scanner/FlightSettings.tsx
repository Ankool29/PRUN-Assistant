import { useState } from 'react'
import type { Snapshot } from '../data.ts'
import { formatTime, numeric } from '../domain.ts'
import { flightQuoteSchema, marketPaths, modes, shipConfiguration, type FlightQuote, type NavigationData, type ShipNavigation } from './navigation.ts'

export function MapPaths({ navigation, from, to }: { navigation: NavigationData | null; from: string; to: string }) {
  if (!from || !to || from === to) return null
  const paths = marketPaths(navigation, from, to)
  if (!paths.length) return <p className="muted">{from} vers {to} · Chemin stellaire FIO indisponible.</p>
  if (paths[0].systems.length === 1) return <p>{from} vers {to} · Même système ({paths[0].systems[0]}). Distance STL à relever dans le SFC.</p>
  return <ul className="scanner-legs">{paths.map(path => <li key={path.strategy}>
    {from} vers {to} · {path.strategy === 'jumps' ? 'Moins de sauts' : 'Distance FTL minimale'} · {path.systems.length - 1} sauts · {numeric(path.distancePc)} pc
    <small className="flight-systems">{path.systems.join(' → ')}</small>
  </li>)}</ul>
}

const sample = {
  from: '', to: '', ticker: '', quantity: '0', mode: 'ftl' as FlightQuote['mode'],
  minutes: '', sf: '', ff: '', extra: '', currency: '', distancePc: '', distanceKm: '',
}
const valueOf = (value: string) => value.trim() ? Number(value) : null

export function FlightSettings({ data, profile, save, parking, currency, navigation }: {
  data: Snapshot; profile: ShipNavigation; save: (value: ShipNavigation) => void
  parking: string; currency: string; navigation: NavigationData | null
}) {
  const [form, setForm] = useState(sample)
  const [invalid, setInvalid] = useState(false)
  const from = form.from || parking
  const quotes = profile.quotes
  const count = quotes.length
  const field = (key: keyof typeof sample, label: string, integer = false) =>
    <label className="field"><span>{label}</span><input type="number" min={0} step={integer ? '1' : 'any'}
      value={form[key]} placeholder="À relever" onChange={event => setForm({ ...form, [key]: event.target.value })}/></label>
  const characteristics = [
    ['mass', 'Masse à vide (t)'], ['cargoT', 'Capacité de fret restante (t)'], ['cargoM3', 'Capacité de fret restante (m³)'],
    ['sfTank', 'Réservoir SF (unités)'], ['ffTank', 'Réservoir FF (unités)'],
  ] as const
  const add = () => {
    const result = flightQuoteSchema.safeParse({
      from, to: form.to, ticker: Number(form.quantity) > 0 ? form.ticker.trim().toUpperCase() : '',
      quantity: valueOf(form.quantity), mode: form.mode, minutes: valueOf(form.minutes),
      sf: valueOf(form.sf), ff: valueOf(form.ff), extra: valueOf(form.extra), currency: form.currency || currency,
      distancePc: valueOf(form.distancePc), distanceKm: valueOf(form.distanceKm), configuration: shipConfiguration(profile),
    })
    if (!result.success || (result.data.ticker && !data.materials.some(row => row.ticker === result.data.ticker))) {
      setInvalid(true)
      return
    }
    const quote = result.data
    const serialized = JSON.stringify(quote)
    if (!quotes.some(row => JSON.stringify(row) === serialized)) save({ ...profile, quotes: [...quotes, quote] })
    setInvalid(false)
    setForm(sample)
  }

  return <details className="scanner-options">
    <summary>Navigation et carburant · {count} {count === 1 ? 'relevé' : 'relevés'} SFC</summary>
    <p className="muted">La carte FIO donne le chemin FTL de référence. Renseignez le profil, puis relevez les durées et consommations du vaisseau dans SFC pour chaque trajet et chargement. Le scanner chiffre ensuite le carburant au marché de départ.</p>
    {navigation && <p className="muted">Carte FIO du {formatTime(navigation.collectedAt)}.</p>}
    <div className="scanner-grid flight-fields">
      {(['stlEngine', 'ftlEngine'] as const).map(key => <label key={key} className="field">
        <span>{key === 'stlEngine' ? 'Moteur STL' : 'Moteur ou réacteur FTL'}</span>
        <input type="text" value={profile[key]} maxLength={60}
          onChange={event => save({ ...profile, [key]: event.target.value })}/>
      </label>)}
      {characteristics.map(([key, label]) => <label className="field" key={key}>
        <span>{label}</span><input type="number" min={0} step={key.endsWith('Tank') ? '1' : 'any'} value={profile[key] ?? ''}
          onChange={event => {
            const number = valueOf(event.target.value)
            const valid = number !== null && Number.isFinite(number) && number >= 0
              && (!key.endsWith('Tank') || Number.isSafeInteger(number))
            save({ ...profile, [key]: valid ? number : null })
          }}/>
      </label>)}
    </div>
    <h3>Nouveau relevé SFC</h3>
    <div className="scanner-grid flight-fields">
      {(['from', 'to'] as const).map(key => <label key={key} className="field">
        <span>{key === 'from' ? 'Départ du relevé' : 'Arrivée du relevé'}</span>
        <select value={key === 'from' ? from : form.to} onChange={event => setForm({ ...form, [key]: event.target.value })}>
          <option value="">Choisir une bourse</option>{data.exchanges.map(row => <option key={row.code} value={row.code}>{row.code} · {row.station}</option>)}
        </select>
      </label>)}
      <label className="field"><span>Mode du relevé</span><select value={form.mode} onChange={event => setForm({ ...form, mode: event.target.value as FlightQuote['mode'] })}>
        {Object.entries(modes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      {field('quantity', 'Quantité du fret (0 à vide)', true)}
      {Number(form.quantity) > 0 && <label className="field"><span>Ticker du fret</span>
        <input type="text" value={form.ticker} onChange={event => setForm({ ...form, ticker: event.target.value })}/></label>}
      {field('minutes', 'Durée SFC (minutes)')}
      {field('sf', 'Carburant SF (unités)', true)}
      {field('ff', 'Carburant FF (unités)', true)}
      {field('distanceKm', 'Distance STL SFC (km, facultatif)')}
      {field('distancePc', 'Distance FTL SFC (pc, facultatif)')}
      {field('extra', 'Autres frais et péages')}
      <label className="field"><span>Devise des frais du relevé</span><select value={form.currency || currency} onChange={event => setForm({ ...form, currency: event.target.value })}>
        {[...new Set(data.exchanges.map(row => row.currency))].sort().map(code => <option key={code}>{code}</option>)}
      </select></label>
    </div>
    <p className="muted">Saisissez 0 lorsqu’un carburant ou des frais sont explicitement absents. Pour un portail, reportez le péage total dans les frais et les consommations du vaisseau depuis SFC.</p>
    <MapPaths navigation={navigation} from={from} to={form.to}/>
    <button className="button" onClick={add}>Enregistrer le relevé SFC</button>
    {invalid && <p role="status" className="error">Vérifiez les bourses, le fret, la durée, les unités et les frais du relevé. Un vol STL exige 0 FF.</p>}
    {quotes.length > 0 && <ul className="scanner-legs">{quotes.map((row, i) => <li key={JSON.stringify(row)}>
      {row.from} vers {row.to} · {modes[row.mode]} · {row.quantity ? `${row.quantity} ${row.ticker}` : 'À vide'} · {numeric(row.minutes)} min
      <button className="button" aria-label={`Retirer le relevé ${i + 1}`}
        onClick={() => save({ ...profile, quotes: quotes.filter((_, index) => index !== i) })}>Retirer</button>
    </li>)}</ul>}
  </details>
}
