// FIO publie des instants ISO avec fuseau. Normaliser la fraction de seconde
// évite de dépendre de la tolérance de Date.parse aux extensions de format.
const timestamp = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|([+-])(\d{2}):?(\d{2}))$/

export function quoteTime(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = timestamp.exec(value)
  if (!match || match[0] !== value) return null
  const [, yearText, monthText, dayText, hour, minute, second, fraction, zone, sign, offsetHour, offsetMinute] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]
    || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59
    || (sign && (Number(offsetHour) > 23 || Number(offsetMinute) > 59))) return null
  const offset = zone === 'Z' ? zone : `${sign}${offsetHour}:${offsetMinute}`
  const millis = (fraction ?? '').slice(0, 3).padEnd(3, '0')
  const parsed = Date.parse(`${yearText}-${monthText}-${dayText}T${hour}:${minute}:${second}.${millis}${offset}`)
  return Number.isFinite(parsed) ? parsed : null
}
