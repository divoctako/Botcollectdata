// Split migration scripts without splitting semicolons in quoted SQL/comments.
export function splitSql(source) {
  const statements = [];
  let current = '';
  let quote = null;
  let lineComment = false;
  let blockComment = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i]; const next = source[i + 1];
    if (lineComment) { if (char === '\n') { lineComment = false; current += '\n'; } continue; }
    if (blockComment) { if (char === '*' && next === '/') { blockComment = false; i++; current += ' '; } continue; }
    if (quote) {
      current += char;
      if (char === quote) {
        if (next === quote) { current += next; i++; }
        else quote = null;
      }
      continue;
    }
    if (char === '-' && next === '-') { lineComment = true; i++; continue; }
    if (char === '/' && next === '*') { blockComment = true; i++; continue; }
    if (char === "'" || char === '"' || char === '`') { quote = char; current += char; continue; }
    if (char === ';') {
      if (current.trim()) statements.push(current.trim());
      current = ''; continue;
    }
    current += char;
  }
  if (quote || blockComment) throw new Error('Incomplete SQL script');
  if (current.trim()) statements.push(current.trim());
  return statements;
}
