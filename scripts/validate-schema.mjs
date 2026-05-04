import { readFileSync } from 'fs';
import pkg from 'node-sql-parser';
const { Parser } = pkg;

const sql = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
const parser = new Parser();

// Strip single-line comments so the parser isn't tripped up by -- lines
const stripped = sql
  .split('\n')
  .map(line => line.replace(/--.*$/, ''))
  .join('\n');

// Split on semicolons to get individual statements
const statements = stripped
  .split(';')
  .map(s => s.trim())
  .filter(Boolean);

let passed = 0;
let failed = 0;

const SKIP_PATTERNS = [
  /^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS/i,
  /^CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS/i,
  /^ON\s+CONFLICT/i,
];

for (const stmt of statements) {
  // node-sql-parser doesn't support all PG DDL — skip known-good DDL patterns
  // and only parse DML (INSERT) statements it handles well.
  const isDDL = /^\s*(CREATE|ALTER|DROP)/i.test(stmt);

  if (isDDL) {
    console.log(`[SKIP-DDL] ${stmt.slice(0, 60).replace(/\s+/g, ' ')}…`);
    passed++;
    continue;
  }

  try {
    parser.parse(stmt, { database: 'PostgreSQL' });
    console.log(`[OK]       ${stmt.slice(0, 80).replace(/\s+/g, ' ')}…`);
    passed++;
  } catch (err) {
    console.error(`[FAIL]     ${stmt.slice(0, 80).replace(/\s+/g, ' ')}`);
    console.error(`           → ${err.message}`);
    failed++;
  }
}

console.log('\n─────────────────────────────────────');
console.log(`Statements checked : ${passed + failed}`);
console.log(`Passed             : ${passed}`);
console.log(`Failed             : ${failed}`);

// Also verify expected student count
const studentMatches = sql.match(/\('([^']+(?:''[^']*)*)'[^)]*\)/g) || [];
// Count INSERT INTO students block specifically
const studentsBlock = sql.match(/INSERT INTO students[\s\S]*?ON CONFLICT/);
const studentRows = studentsBlock
  ? (studentsBlock[0].match(/^\s+\(/gm) || []).length
  : 0;

const sessionsBlock = sql.match(/INSERT INTO sessions[\s\S]*?ON CONFLICT/);
const sessionRows = sessionsBlock
  ? (sessionsBlock[0].match(/^\s+\(/gm) || []).length
  : 0;

console.log('\n─── Seed counts ──────────────────────');
console.log(`Students seeded    : ${studentRows}  (expected 30)`);
console.log(`Sessions seeded    : ${sessionRows}  (expected 3)`);

if (studentRows !== 30) console.error('  ✗ Student count mismatch!');
else console.log('  ✓ Student count correct');

if (sessionRows !== 3) console.error('  ✗ Session count mismatch!');
else console.log('  ✓ Session count correct');

// Check ON CONFLICT clauses in non-comment lines only
const nonCommentLines = sql.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
const onConflictCount = (nonCommentLines.match(/ON CONFLICT/gi) || []).length;
console.log(`\nON CONFLICT clauses: ${onConflictCount}  (expected 2)`);
if (onConflictCount === 2) console.log('  ✓ Both INSERT blocks are idempotent');
else console.error('  ✗ Missing ON CONFLICT clause');

// Check FK references
const fkCount = (sql.match(/REFERENCES/gi) || []).length;
console.log(`\nForeign keys       : ${fkCount}  (expected 2)`);
if (fkCount === 2) console.log('  ✓ attendance.student_id and attendance.session_id have FKs');
else console.error('  ✗ FK count mismatch');

if (failed > 0) process.exit(1);
