import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { demo, loadFio, type Snapshot } from './data.ts'
import { formatTime } from './domain.ts'
import { Dashboard } from './pages/Dashboard.tsx'
import { Markets } from './pages/Markets.tsx'
import { Materials } from './pages/Materials.tsx'
import { Scanner } from './pages/Scanner.tsx'
import { Production } from './pages/Production.tsx'
import { Empty, Icon, SectionHead, Status, type IconName } from './ui.tsx'
import './styles.css'

const pages = [
  { id: 'tableau', title: 'Tableau de bord', icon: 'grid' },
  { id: 'marches', title: 'Marchés', icon: 'market' },
  { id: 'materiaux', title: 'Matériaux', icon: 'cube' },
  { id: 'production', title: 'Production', icon: 'factory' },
  { id: 'scanner', title: 'Scanner commercial', icon: 'scanner' },
] as const satisfies readonly { id: string; title: string; icon: IconName }[]

type LoadState = { phase: 'loading' | 'ready' | 'failed'; snapshot: Snapshot | null }

function App() {
  const [hash, setHash] = useState(window.location.hash)
  const [mode, setMode] = useState<'fio' | 'demo'>('fio')
  const [state, setState] = useState<LoadState>({ phase: 'loading', snapshot: null })
  const [attempt, setAttempt] = useState(0)
  const [now, setNow] = useState(Date.now)
  const [route, exchange = ''] = hash.slice(1).split('/')
  const page = pages.find(item => item.id === route) ?? pages[0]
  const data = mode === 'demo' ? demo : state.snapshot
  const loading = mode === 'fio' && state.phase === 'loading'
  const failed = mode === 'fio' && state.phase === 'failed'

  useEffect(() => {
    const onHashChange = () => {
      setHash(window.location.hash)
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onHashChange)
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => {
      window.removeEventListener('hashchange', onHashChange)
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    document.title = `${page.title} · PRUN Assistant`
  }, [page])

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    const timer = window.setTimeout(() => controller.abort(), 12_000)
    setState(previous => ({ ...previous, phase: 'loading' }))
    loadFio(controller.signal)
      .then(snapshot => { if (active) setState({ phase: 'ready', snapshot }) })
      .catch(() => { if (active) setState(previous => ({ ...previous, phase: 'failed' })) })
      .finally(() => window.clearTimeout(timer))
    return () => {
      active = false
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [attempt])

  return <>
    <a className="skip" href="#contenu" onClick={event => {
      event.preventDefault()
      document.getElementById('contenu')?.focus()
    }}>Aller au contenu</a>
    <header className="header"><div className="header-inner">
      <a className="brand" href="#tableau"><span className="brand-mark"><Icon name="layers" size={22}/></span><span>PRUN <b>Assistant</b></span></a>
      <div className="switch sources" role="group" aria-label="Source des données">
        <button aria-pressed={mode === 'fio'} onClick={() => setMode('fio')}>Données FIO</button>
        <button aria-pressed={mode === 'demo'} onClick={() => setMode('demo')}>Démo</button>
      </div>
    </div></header>
    <div className="workspace">
      <nav className="navigation" aria-label="Navigation principale">
        {pages.map(item => <a href={`#${item.id}`} key={item.id} aria-label={item.title} aria-current={item.id === page.id ? 'page' : undefined}>
          <Icon name={item.icon}/><span>{item.id === 'scanner' ? <><span className="scanner-short">Scanner</span><span className="scanner-full">{item.title}</span></> : item.title}</span>
        </a>)}
      </nav>
      <main id="contenu" tabIndex={-1}>
        <section className={`source-bar ${mode === 'demo' ? 'demo-bar' : ''}`} aria-label="État des données">
          <div className="source-message" role="status">
            {mode === 'demo' ? <><Status source="demo" timestamp={null} now={now}/><span>Mode démonstration</span></>
              : <>
                {data && <><Status source="fio" timestamp={data.collectedAt} now={now}/><span>Collecte du {formatTime(data.collectedAt)}</span></>}
                {loading && <span>Chargement de l’instantané FIO…</span>}
                {failed && <span className="error">{data ? 'Actualisation impossible. Instantané précédent affiché.' : 'Données FIO indisponibles.'}</span>}
              </>}
          </div>
          {mode === 'fio' && <button className="button refresh" disabled={loading} onClick={() => setAttempt(attempt + 1)}><Icon name="refresh" size={17}/>{failed ? 'Réessayer' : 'Actualiser'}</button>}
        </section>
        {page.id === 'tableau' && <Dashboard data={data} now={now}/>}
        {page.id !== 'tableau' && !data && <>
          <SectionHead title={page.title}>Catalogue Prosperous Universe</SectionHead>
          <Empty>{loading ? 'Chargement des données…' : 'Réessayez le chargement ou ouvrez la démonstration.'}</Empty>
        </>}
        {data && page.id === 'marches' && <Markets key={`${data.source}-${exchange}`} data={data} now={now} requestedExchange={exchange}/>}
        {data && page.id === 'materiaux' && <Materials key={data.source} data={data}/>}
        {data && page.id === 'production' && <Production key={data.source} data={data}/>}
        {data && page.id === 'scanner' && <Scanner key={data.source} data={data} now={now}/>}
        <footer>PRUN Assistant <span>·</span> Consultation en lecture seule</footer>
      </main>
    </div>
  </>
}

createRoot(document.getElementById('root')!).render(<App/>)
