/**
 * Splits a SQL file into statements on `;`. `--` line comments and 'single quoted' strings (with backslash
 * and doubled-quote escapes) are respected, so a `;` inside them does not split. Comments are dropped.
 *
 * No imports: scripts/migrate-clickhouse.ts runs this file with plain Node type stripping inside the compose container.
 */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i] as string;
    if (c === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      cur += '\n';
    } else if (c === "'") {
      cur += c;
      for (i++; i < sql.length; i++) {
        const s = sql[i] as string;
        cur += s;
        if (s === '\\') {
          i++;
          cur += sql[i] ?? '';
        } else if (s === "'") {
          if (sql[i + 1] === "'") {
            i++;
            cur += "'";
          } else break;
        }
      }
    } else if (c === ';') {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
