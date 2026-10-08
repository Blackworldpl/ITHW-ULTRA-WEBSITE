export function csv(rows: unknown[][]): string {
  const cell = (value:unknown) => {
    let text = value instanceof Date?value.toISOString():String(value??'');
    if (typeof value!=='number' && /^[\s]*[=+@-]/.test(text)) text=`'${text}`;
    return `"${text.replaceAll('"','""')}"`;
  };
  return '\uFEFF'+rows.map(row=>row.map(cell).join(';')).join('\r\n');
}
