type CsvValue = string | number | boolean | null | undefined

function escapeCell(value: CsvValue): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/** RFC 4180 CSV with a header row taken from `columns`. */
export function toCsv<Row extends Record<string, CsvValue>>(
  rows: readonly Row[],
  columns: readonly (keyof Row & string)[]
): string {
  const lines = [columns.join(',')]
  for (const row of rows) lines.push(columns.map((column) => escapeCell(row[column])).join(','))
  return `${lines.join('\r\n')}\r\n`
}
