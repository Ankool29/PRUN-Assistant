import { useEffect, useState } from 'react'
import { z } from 'zod'
import type { Snapshot } from '../data.ts'

const configuredRates = z.record(z.record(z.string()))

export function useExchangeRates(source: Snapshot['source']) {
  const key = `prun.scanner.fx.${source}.v1`
  const [rates, setRates] = useState<Record<string, Record<string, string>>>(() => {
    try {
      const stored = localStorage.getItem(key)
      if (stored) return configuredRates.parse(JSON.parse(stored))
    } catch {
      // Le réglage peut rester en mémoire si le stockage est inaccessible.
    }
    return {}
  })
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(rates)) } catch {
      // Le navigateur peut désactiver le stockage.
    }
  }, [key, rates])
  return [rates, setRates] as const
}
