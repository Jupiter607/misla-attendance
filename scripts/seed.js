/**
 * Run with:  node scripts/seed.js
 * Requires .env.local with POSTGRES_URL set.
 * Loads dotenv manually so it works outside of Vercel runtime.
 */

import { readFileSync } from 'fs'
import { createRequire } from 'module'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── Load .env.local manually ─────────────────────────────────────────────────
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
  console.log('✓ Loaded .env.local')
} catch {
  console.warn('⚠  No .env.local found — relying on shell environment variables')
}

if (!process.env.POSTGRES_URL) {
  console.error('✗  POSTGRES_URL is not set. Copy .env.example → .env.local and fill in your values.')
  process.exit(1)
}

// ── Connect and run schema.sql ───────────────────────────────────────────────
const require = createRequire(import.meta.url)
const { sql }  = await import('@vercel/postgres')

const schemaPath = path.resolve(__dirname, '../schema.sql')
const schemaSql  = readFileSync(schemaPath, 'utf8')

// Split on semicolons, skip blank/comment-only statements
const statements = schemaSql
  .split(';')
  .map(s => s.trim())
  .filter(s => s && s.replace(/--[^\n]*/g, '').trim() !== '')

console.log(`\nRunning ${statements.length} SQL statements…\n`)

let ok = 0
let failed = 0

for (const stmt of statements) {
  const preview = stmt.replace(/\s+/g, ' ').slice(0, 72)
  try {
    await sql.query(stmt)
    console.log(`  ✓ ${preview}`)
    ok++
  } catch (err) {
    console.error(`  ✗ ${preview}`)
    console.error(`    → ${err.message}\n`)
    failed++
  }
}

console.log(`\n─────────────────────────────`)
console.log(`Succeeded : ${ok}`)
console.log(`Failed    : ${failed}`)

if (failed === 0) {
  console.log('\n✅ Database seeded successfully!\n')
} else {
  console.error('\n⚠  Some statements failed — check output above.\n')
  process.exit(1)
}
