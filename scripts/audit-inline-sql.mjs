import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseServerSource, propertyName, serverRoot, walk } from './lib/server-source.mjs';

const statement = /^(?:SELECT(?:\s|$)|WITH\s+(?:RECURSIVE\s+)?[\w`]+\s+AS\s*\(|(?:INSERT(?:\s+IGNORE)?|REPLACE)\s+INTO\b|UPDATE\s+\S+[\s\S]*\bSET\b|DELETE\s+FROM\b|(?:ALTER|CREATE|DROP|TRUNCATE)\s+TABLE\b|SET\s+TRANSACTION\b)/i;
const fragment = /^(?:(?:FROM|JOIN|WHERE)\s+\S|(?:AND|OR)\s+[\w`]+\.\w+|(?:GROUP|ORDER)\s+BY\b|FOR\s+(?:UPDATE|SHARE)\b)/i;

export function scanRouteSql(source) {
  const matches = [];
  walk(parseServerSource(source), (node) => {
    const record = (kind) => matches.push({ line: node.loc.start.line, kind });
    if (node.type === 'CallExpression' && ['query', 'execute'].includes(propertyName(node.callee))
        && ['pool', 'conn', 'db', 'connection'].includes(node.callee.object.name)) record('direct query');
    const value = node.type === 'TemplateLiteral'
      ? node.quasis.map(part => part.value.raw).join(' ? ')
      : node.type === 'Literal' && typeof node.value === 'string' ? node.value : '';
    const sql = value.trim();
    if (statement.test(sql) || fragment.test(sql)) record('SQL text');
  });
  return matches.sort((a, b) => a.line - b.line);
}

export function budgetViolations(rows, baseline) {
  return Object.entries(rows).filter(([file, hits]) => hits.length > (baseline[file] ?? 0));
}

function main() {
  const root = path.join(serverRoot, 'routes');
  const rows = Object.fromEntries(fs.readdirSync(root, { recursive: true }).sort()
    .filter(name => /\.[cm]?js$/.test(name))
    .map(name => [name, scanRouteSql(fs.readFileSync(path.join(root, name), 'utf8'))])
    .filter(([, hits]) => hits.length));
  const counts = Object.fromEntries(Object.entries(rows).map(([name, hits]) => [name, hits.length]));
  if (process.argv.includes('--print-baseline')) {
    console.log(JSON.stringify(counts, null, 2));
    return;
  }
  const baseline = JSON.parse(fs.readFileSync(new URL('./route-sql-baseline.json', import.meta.url), 'utf8'));
  console.log(`Route SQL: ${Object.values(counts).reduce((sum, n) => sum + n, 0)} findings in ${Object.keys(counts).length} files`);
  const failures = budgetViolations(rows, baseline);
  for (const [name, hits] of process.argv.includes('--details') ? Object.entries(rows) : failures) {
    console.log(`  ${name} (${hits.length}; kept debt: ${baseline[name] ?? 0}): ${hits.map(hit => `${hit.line} ${hit.kind}`).join(', ')}`);
  }
  if (failures.length) {
    console.error('New route SQL detected. Give the query a named operation in lib/queries.');
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
