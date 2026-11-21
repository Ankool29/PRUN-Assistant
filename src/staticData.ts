export function staticDataUrl(filename: 'fio.json' | 'history.json') {
  const appBase = new URL(import.meta.env.BASE_URL, document.baseURI)
  return new URL(`data/${filename}`, appBase)
}
