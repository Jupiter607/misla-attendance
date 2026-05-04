/**
 * One-time import of historical attendance data from the Jan-Mar 2026 Excel file.
 * Run with:
 *   POSTGRES_URL="..." node scripts/import-historical.mjs
 *
 * Safe to re-run — uses upserts throughout.
 */

import { readFileSync } from 'fs'
import { createRequire } from 'module'
import path from 'path'
import { fileURLToPath } from 'url'
import * as XLSX from 'xlsx'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── Load .env.local ────────────────────────────────────────────────────────────
const envPath = path.resolve(__dirname, '../.env.local')
try {
  const lines = readFileSync(envPath, 'utf8').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!process.env[key]) process.env[key] = val
  }
} catch { /* no .env.local — rely on shell env */ }

if (!process.env.POSTGRES_URL) {
  console.error('✗  POSTGRES_URL is not set.')
  process.exit(1)
}

const { sql } = await import('@vercel/postgres')

// ── Parse Excel ───────────────────────────────────────────────────────────────
const FILE = '/Users/donnelllayne/Downloads/misla-Student-Attendance-Tracker Jan-Mar.xlsx'
const wb = XLSX.read(readFileSync(FILE))
const STATUS_MAP = { P: 'present', U: 'absent', E: 'excused', T: 'late' }
const VALID = new Set(Object.keys(STATUS_MAP))

// Month sheets → year-month prefix
const SHEETS = [
  { sheet: 'Jan', prefix: '2026-01' },
  { sheet: 'Feb', prefix: '2026-02' },
  { sheet: 'Mar', prefix: '2026-03' },
]

// Parse each sheet into { students, sessions, attendance }
// Row 9 (index 9) = day-number headers: col[3]=day1, col[4]=day2 ... col[n]=day(n-2)
// Student rows start at index 10; col[0]=name, col[3+] = attendance values
function parseSheet({ sheet, prefix }) {
  const ws = wb.Sheets[sheet]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 })

  // Identify which column indices (days) have attendance data
  const studentRows = rows.slice(10).filter(r => {
    const name = r[0] && String(r[0]).trim()
    return name && !name.match(/^Y\d|TOTAL|total|^-/)
  })

  const usedCols = new Set()
  studentRows.forEach(r => {
    r.forEach((v, i) => { if (VALID.has(v)) usedCols.add(i) })
  })

  // col index → date string (col 3 = day 1 of the month)
  const colToDate = {}
  for (const col of usedCols) {
    const day = col - 2   // col 3 → day 1, col 4 → day 2, etc.
    if (day >= 1 && day <= 31) {
      colToDate[col] = `${prefix}-${String(day).padStart(2, '0')}`
    }
  }

  const sessions = [...new Set(Object.values(colToDate))].sort()

  const students = []
  const attendance = []  // { name, date, status }

  for (const row of studentRows) {
    const name = String(row[0]).trim()
    if (!students.includes(name)) students.push(name)

    for (const [col, date] of Object.entries(colToDate)) {
      const raw = row[col]
      if (VALID.has(raw)) {
        attendance.push({ name, date, status: STATUS_MAP[raw] })
      }
    }
  }

  return { sessions, students, attendance }
}

// ── Gather all data ───────────────────────────────────────────────────────────
const allSessions  = new Set()
const allStudents  = new Set()
const allAttendance = []  // { name, date, status }

for (const spec of SHEETS) {
  const { sessions, students, attendance } = parseSheet(spec)
  sessions.forEach(s => allSessions.add(s))
  students.forEach(s => allStudents.add(s))
  allAttendance.push(...attendance)
}

const sessionDates = [...allSessions].sort()
const studentNames = [...allStudents].sort()

console.log(`\n📋  Data extracted from Excel`)
console.log(`    Sessions  : ${sessionDates.length}  (${sessionDates[0]} → ${sessionDates[sessionDates.length - 1]})`)
console.log(`    Students  : ${studentNames.length}`)
console.log(`    Attendance: ${allAttendance.length} records\n`)

// ── Get (or create) MISLA Bootcamp 2026 class ─────────────────────────────────
let { rows: classRows } = await sql`SELECT id, name FROM classes WHERE name = 'MISLA Bootcamp 2026'`
if (!classRows.length) {
  const { rows } = await sql`
    INSERT INTO classes (name, description)
    VALUES ('MISLA Bootcamp 2026', 'Made In South Los Angeles Tech Bootcamp — Jan–Mar 2026')
    RETURNING id, name
  `
  classRows = rows
}
const classId = classRows[0].id
console.log(`✓  Class: "${classRows[0].name}" (id=${classId})`)

// ── Upsert sessions ───────────────────────────────────────────────────────────
console.log(`\n📅  Upserting ${sessionDates.length} sessions…`)
let sessOk = 0
for (const date of sessionDates) {
  try {
    await sql`
      INSERT INTO sessions (class_id, session_date)
      VALUES (${classId}, ${date}::date)
      ON CONFLICT (class_id, session_date) DO NOTHING
    `
    sessOk++
  } catch (err) {
    console.error(`  ✗ Session ${date}: ${err.message}`)
  }
}
console.log(`  ✓ ${sessOk} sessions inserted/confirmed`)

// Build session date → id lookup
const { rows: sessRows } = await sql`
  SELECT id, session_date::text AS session_date FROM sessions WHERE class_id = ${classId}
`
const sessMap = {}
for (const r of sessRows) {
  sessMap[r.session_date.slice(0, 10)] = r.id
}

// ── Upsert students ───────────────────────────────────────────────────────────
console.log(`\n👥  Upserting ${studentNames.length} students…`)
let studOk = 0
for (const name of studentNames) {
  try {
    await sql`
      INSERT INTO students (class_id, full_name)
      VALUES (${classId}, ${name})
      ON CONFLICT (class_id, full_name) DO NOTHING
    `
    studOk++
  } catch (err) {
    console.error(`  ✗ Student "${name}": ${err.message}`)
  }
}
console.log(`  ✓ ${studOk} students inserted/confirmed`)

// Build student name → id lookup
const { rows: studRows } = await sql`
  SELECT id, full_name FROM students WHERE class_id = ${classId}
`
const studMap = {}
for (const r of studRows) {
  studMap[r.full_name.trim()] = r.id
}

// ── Upsert attendance ─────────────────────────────────────────────────────────
console.log(`\n📝  Upserting ${allAttendance.length} attendance records…`)
let attOk = 0, attSkip = 0, attFail = 0

for (const rec of allAttendance) {
  const studentId = studMap[rec.name]
  const sessionId = sessMap[rec.date]
  if (!studentId || !sessionId) { attSkip++; continue }

  try {
    await sql`
      INSERT INTO attendance (student_id, session_id, status)
      VALUES (${studentId}, ${sessionId}, ${rec.status})
      ON CONFLICT (student_id, session_id) DO UPDATE SET status = EXCLUDED.status
    `
    attOk++
  } catch (err) {
    console.error(`  ✗ ${rec.name} / ${rec.date}: ${err.message}`)
    attFail++
  }
}
console.log(`  ✓ ${attOk} records saved  |  ${attSkip} skipped (no match)  |  ${attFail} errors`)

// ── Remove placeholder seeded sessions with no real attendance ─────────────────
console.log(`\n🗑   Removing placeholder seed sessions with zero attendance…`)
const { rows: placeholders } = await sql`
  SELECT s.id, s.session_date::text AS session_date
  FROM sessions s
  LEFT JOIN attendance a ON a.session_id = s.id
  WHERE s.class_id = ${classId}
    AND s.session_date IN ('2026-01-10', '2026-01-17', '2026-01-24')
    AND a.id IS NULL
`
for (const p of placeholders) {
  await sql`DELETE FROM sessions WHERE id = ${p.id}`
  console.log(`  ✓ Removed ${p.session_date} (no attendance)`)
}
if (!placeholders.length) console.log('  (none to remove)')

console.log(`\n✅  Import complete!\n`)
