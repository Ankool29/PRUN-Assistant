import { useEffect, useState, type FormEvent } from 'react'
import { z } from 'zod'
import { formatTime, freshness, numeric } from '../domain.ts'
import { fxKey, fxQuoteSchema, type FxBoard, type FxQuote } from './fxBook.ts'

const storageSchema = z.record(fxQuoteSchema)

export function useFxBoard(source: 'fio' | 'demo') {
  const key = `prun.scanner.fx-board.${source}.v1`
  const [board, setBoard] = useState<FxBoard>(() => {
    try { return storageSchema.parse(JSON.parse(localStorage.getItem(key) ?? '{}')) }
    catch { return {} }
  })
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(board)) }
    catch { /* Le carnet reste utilisable en mémoire. */ }
  }, [key, board])
  return [board, setBoard] as const
}

export function FxSettings({ currencies, reference, board, now, demo, save, remove }: {
  currencies: string[]; reference: string; board: FxBoard; now: number; demo: boolean
  save: (quote: FxQuote) => void; remove: (base: string) => void
}) {
  const available = currencies.filter(code => code !== reference)
  const [selected, setSelected] = useState('')
  const base = available.includes(selected) ? selected : available[0]
  return <details className="scanner-options">
    <summary>Relevés de change FXOB</summary>
    {base && <>
      <p className="muted">Relevez les cours et les lots disponibles de chaque côté dans APEX. Le cours représente le prix d’une unité de la devise de base, exprimé en {reference}. Un lot contient 1 000 unités de base.</p>
      <label className="field"><span>Devise de base FXOB</span><select value={base} onChange={e => setSelected(e.target.value)}>
        {available.map(code => <option key={code}>{code}</option>)}
      </select></label>
      <QuoteForm key={fxKey(base, reference)} base={base} reference={reference} quote={board[fxKey(base, reference)]}
        now={now} demo={demo} save={save} remove={() => remove(base)}/>
      <a href="https://handbook.apex.prosperousuniverse.com/tutorials/legacy-tutorials/foreign-exchange/" target="_blank" rel="noreferrer">Manuel du change APEX</a>
    </>}
    {!base && <p>Les marchés de la source sélectionnée partagent la même devise.</p>}
  </details>
}

function QuoteForm({ base, reference, quote, now, demo, save, remove }: {
  base: string; reference: string; quote?: FxQuote; now: number; demo: boolean
  save: (quote: FxQuote) => void; remove: () => void
}) {
  const [message, setMessage] = useState('')
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const raw = (key: string) => String(form.get(key) ?? '').trim()
    const level = (side: string) => {
      const rate = raw(`${side}Rate`)
      const lots = raw(`${side}Lots`)
      return rate || lots ? { rate: Number(rate), lots: Number(lots) } : null
    }
    const observedAt = raw('observed') ? `${raw('observed')}:00Z` : ''
    const result = fxQuoteSchema.safeParse({
      base, reference, observedAt, bid: level('bid'), ask: level('ask'),
      fee: Number(raw('fee')) / 100, fixedFee: Number(raw('fixed')),
    })
    if (!form.has('verified')) return setMessage('Confirmez la lecture du carnet et la devise des frais.')
    if (freshness(observedAt, now) !== 'fresh') return setMessage('Saisissez une heure UTC valide datant de moins de trois heures.')
    if (!result.success) return setMessage('Renseignez un cours positif et un nombre entier de lots pour chaque côté saisi. Le cours acheteur doit être inférieur ou égal au cours vendeur.')
    save(result.data)
    setMessage('Relevé enregistré dans ce navigateur.')
  }
  return <form className="circuit-fx-form" onSubmit={submit}>
    <p><strong>FXOB {fxKey(base, reference)}</strong>{quote && <> · {formatTime(quote.observedAt)} · {freshness(quote.observedAt, now) === 'fresh' ? 'récent' : 'à actualiser'}</>}</p>
    <div className="scanner-grid">
      <FxNumber label="Cours acheteur" name="bidRate" value={quote?.bid?.rate}/>
      <FxNumber label="Lots acheteurs" name="bidLots" value={quote?.bid?.lots} step="1"/>
      <FxNumber label="Cours vendeur" name="askRate" value={quote?.ask?.rate}/>
      <FxNumber label="Lots vendeurs" name="askLots" value={quote?.ask?.lots} step="1"/>
      <FxNumber label="Frais de change (%)" name="fee" value={quote ? quote.fee * 100 : undefined} required/>
      <FxNumber label={`Frais fixes par ordre (${reference})`} name="fixed" value={quote?.fixedFee} required/>
      <label className="field"><span>Observation du carnet (UTC)</span>
        <input type="datetime-local" name="observed" defaultValue={quote?.observedAt.slice(0, 16)} required/>
      </label>
    </div>
    <label className="circuit-check"><input type="checkbox" name="verified" required/>
      <span>{demo ? 'Je confirme que ce relevé est fictif.' : 'Je confirme avoir relevé ces cours et lots dans FXOB et vérifié les frais.'}</span>
    </label>
    <button className="button" type="submit">Enregistrer le relevé</button>
    {quote && <button className="button" type="button" onClick={() => { remove(); setMessage('Relevé supprimé.') }}>Supprimer le relevé</button>}
    {quote && <p className="muted">Profondeur enregistrée · {numeric(quote.bid?.lots ?? 0)} lots acheteurs et {numeric(quote.ask?.lots ?? 0)} lots vendeurs.</p>}
    {message && <p role="status">{message}</p>}
  </form>
}

function FxNumber({ label, name, value, step = 'any', required }: {
  label: string; name: string; value?: number; step?: string; required?: boolean
}) {
  return <label className="field"><span>{label}</span>
    <input type="number" name={name} inputMode={step === '1' ? 'numeric' : 'decimal'} min={0}
      step={step} defaultValue={value} required={required}/>
  </label>
}
