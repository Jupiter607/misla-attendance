import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import * as XLSX from 'xlsx'
import './App.css'

// ─── Status config ────────────────────────────────────────────────────────────
const CYCLE  = [null, 'present', 'excused', 'absent', 'late']
const LABEL  = { present: 'P', excused: 'E', absent: 'U', late: 'T' }
const STATUS_LABEL = { present: 'Present', excused: 'Excused', absent: 'Unexcused absent', late: 'Tardy' }
const COLORS = {
  present: { bg: '#dcfce7', fg: '#15803d' },
  excused: { bg: '#dbeafe', fg: '#1d4ed8' },
  absent:  { bg: '#fee2e2', fg: '#b91c1c' },
  late:    { bg: '#fef3c7', fg: '#92400e' },
}

// ─── Date helpers ─────────────────────────────────────────────────────────────
function toDateStr(v) {
  if (!v) return ''
  const s = typeof v === 'string' ? v : new Date(v).toISOString()
  return s.slice(0, 10)
}
function fmtShort(d) {
  const [, m, day] = toDateStr(d).split('-')
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${M[+m - 1]} ${+day}`
}
function monthKey(d)   { return toDateStr(d).slice(0, 7) }
function monthLabel(k) {
  const [y, m] = k.split('-')
  const M = ['January','February','March','April','May','June',
             'July','August','September','October','November','December']
  return `${M[+m - 1]} ${y}`
}

// ─── Demo data ────────────────────────────────────────────────────────────────
const DEMO_CLASSES = [
  { id: 1, name: 'MISLA Bootcamp 2026', description: 'Made In South Los Angeles Tech Bootcamp' },
]
const DEMO_STUDENTS = [
  'Steve Eteaki','Daniel Bisuano','Giovanni Hernandez','Karmyn Luong',
  'Amtul Anderson','Monique Gutierrez','Esther Caballero','Giovanni McEastland',
  'Che Lia Spriggs','Sergey Ulyanov','Arthur Seltzer','Cathalyn Roberts',
  'Eliot Williamson',"Ja'Corey Sherman",'Danny Flores','Tanya Nevarez',
  'Roderick Towns','Andrew Hubbell III','Jessica Marroquin','Mikaela Vera Cruz',
  'Lawrence Marquez','Romina Estrada','Evi Alonzo','Adan Oceguera',
  'CJ Calica','Joshua Randolph','Jada Randolph','Anthony Lewis',
  'Maverick Mathews','Jordan Taylor',
].map((full_name, i) => ({ id: i + 1, class_id: 1, full_name }))

const DEMO_SESSIONS = [
  { id: 1, class_id: 1, session_date: '2026-01-10', label: 'January Week 1', locked: false },
  { id: 2, class_id: 1, session_date: '2026-01-17', label: 'January Week 2', locked: false },
  { id: 3, class_id: 1, session_date: '2026-01-24', label: 'January Week 3', locked: false },
]

function makeDemoAttendance() {
  const map = {}
  DEMO_STUDENTS.forEach(s => {
    DEMO_SESSIONS.forEach(sess => {
      const r = Math.random()
      if      (r < 0.72) map[`${s.id}_${sess.id}`] = 'present'
      else if (r < 0.84) map[`${s.id}_${sess.id}`] = 'excused'
      else if (r < 0.93) map[`${s.id}_${sess.id}`] = 'absent'
      else if (r < 0.97) map[`${s.id}_${sess.id}`] = 'late'
    })
  })
  return map
}

const IS_DEMO = import.meta.env.VITE_DEMO === 'true'

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [classes,       setClasses]       = useState([])
  const [students,      setStudents]      = useState([])
  const [sessions,      setSessions]      = useState([])
  const [attendance,    setAttendance]    = useState({})
  const [loading,       setLoading]       = useState(true)
  const [saving,        setSaving]        = useState(new Set())
  const [error,         setError]         = useState(null)

  // UI
  const [selectedClassId, setSelectedClassId] = useState(null)
  const [selectedMonth,   setSelectedMonth]   = useState('all')
  const [search,          setSearch]          = useState('')
  const [filter,          setFilter]          = useState('all')
  const [showAddStudent,  setShowAddStudent]  = useState(false)
  const [showAddSession,  setShowAddSession]  = useState(false)
  const [showAddClass,    setShowAddClass]    = useState(false)
  const [newName,         setNewName]         = useState('')
  const [newDate,         setNewDate]         = useState('')
  const [newLabel,        setNewLabel]        = useState('')
  const [newClassName,    setNewClassName]    = useState('')
  const [newClassDesc,    setNewClassDesc]    = useState('')
  const [showHelp,        setShowHelp]        = useState(false)
  const [showImport,      setShowImport]      = useState(false)
  const [importPreview,   setImportPreview]   = useState([])   // [{ name, duplicate }]
  const [importFile,      setImportFile]      = useState(null)
  const [pendingDelete,   setPendingDelete]   = useState(null) // { cls, students, sessions, attendance }
  const [confirmDelete,   setConfirmDelete]   = useState(null) // cls object awaiting confirm
  const [confirm,         setConfirm]         = useState(null) // generic confirm: { title, message, danger, onConfirm }
  const [classMenuId,     setClassMenuId]     = useState(null) // id of tab with open ⋮ menu
  const [classMenuPos,    setClassMenuPos]    = useState({ top: 0, right: 0 })
  const [renamingClassId, setRenamingClassId] = useState(null) // id of tab currently being renamed
  const undoTimerRef   = useRef(null)
  const classMenuRef   = useRef(null)
  const renameInputRef = useRef(null)

  // ── Load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (IS_DEMO) {
      setClasses(DEMO_CLASSES)
      setStudents(DEMO_STUDENTS)
      setSessions(DEMO_SESSIONS)
      setAttendance(makeDemoAttendance())
      setSelectedClassId(DEMO_CLASSES[0].id)
      setSelectedMonth('2026-01')
      setLoading(false)
      return
    }
    Promise.all([
      fetch('/api/classes').then(r => r.json()),
      fetch('/api/students').then(r => r.json()),
      fetch('/api/sessions').then(r => r.json()),
      fetch('/api/attendance').then(r => r.json()),
    ])
      .then(([cls, s, sess, att]) => {
        setClasses(cls)
        setStudents(s)
        setSessions(sess.map(se => ({
          ...se,
          session_date: toDateStr(se.session_date),
          locked: !!se.locked,
        })))
        const map = {}
        att.forEach(a => { map[`${a.student_id}_${a.session_id}`] = a.status })
        setAttendance(map)
        if (cls.length) {
          setSelectedClassId(cls[0].id)
          const classSess = sess.filter(se => se.class_id === cls[0].id)
          if (classSess.length) setSelectedMonth(monthKey(classSess[classSess.length - 1].session_date))
        }
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  // Reset filters when switching class
  useEffect(() => {
    setSearch('')
    setFilter('all')
    const classSess = sessions.filter(s => s.class_id === selectedClassId)
    if (classSess.length) setSelectedMonth(monthKey(classSess[classSess.length - 1].session_date))
    else setSelectedMonth('all')
  }, [selectedClassId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close class ⋮ menu on outside click / scroll
  useEffect(() => {
    if (!classMenuId) return
    function handleOutside(e) {
      if (classMenuRef.current && !classMenuRef.current.contains(e.target)) {
        setClassMenuId(null)
      }
    }
    function handleScroll() { setClassMenuId(null) }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('touchstart', handleOutside)
    window.addEventListener('scroll', handleScroll, true)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('touchstart', handleOutside)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [classMenuId])

  // Auto-focus rename input when it mounts
  useEffect(() => {
    if (renamingClassId && renameInputRef.current) {
      renameInputRef.current.select()
    }
  }, [renamingClassId])

  // Global Esc-to-close + body scroll lock when any modal is open
  useEffect(() => {
    const anyOpen =
      showHelp || showImport || showAddStudent || showAddSession ||
      showAddClass || confirmDelete || confirm
    if (!anyOpen) return

    const original = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function onKey(e) {
      if (e.key !== 'Escape') return
      // Close most-recently-opened first
      if (confirm)         setConfirm(null)
      else if (confirmDelete)   setConfirmDelete(null)
      else if (showHelp)        setShowHelp(false)
      else if (showImport)      { setShowImport(false); setImportPreview([]); setImportFile(null) }
      else if (showAddStudent)  setShowAddStudent(false)
      else if (showAddSession)  setShowAddSession(false)
      else if (showAddClass)    setShowAddClass(false)
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = original
    }
  }, [showHelp, showImport, showAddStudent, showAddSession, showAddClass, confirmDelete, confirm])

  // ── Derived ───────────────────────────────────────────────────────────────
  const classStudents = useMemo(() =>
    students.filter(s => s.class_id === selectedClassId),
    [students, selectedClassId]
  )
  const classSessions = useMemo(() =>
    sessions.filter(s => s.class_id === selectedClassId),
    [sessions, selectedClassId]
  )
  const months = useMemo(() => {
    const seen = new Set()
    classSessions.forEach(s => seen.add(monthKey(s.session_date)))
    return Array.from(seen).sort()
  }, [classSessions])

  const visibleSessions = useMemo(() => {
    if (selectedMonth === 'all') return classSessions
    return classSessions.filter(s => monthKey(s.session_date) === selectedMonth)
  }, [classSessions, selectedMonth])

  const getStats = useCallback((studentId) => {
    let p = 0, e = 0, u = 0, t = 0
    visibleSessions.forEach(sess => {
      const st = attendance[`${studentId}_${sess.id}`]
      if      (st === 'present') p++
      else if (st === 'excused') e++
      else if (st === 'absent')  u++
      else if (st === 'late')    t++
    })
    const total = visibleSessions.length
    const pct = total > 0 ? Math.round(((p + e) / total) * 100) : null
    return { p, e, u, t, pct }
  }, [attendance, visibleSessions])

  const visibleStudents = useMemo(() => {
    let list = [...classStudents]
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(s => s.full_name.toLowerCase().includes(q))
    }
    if (filter === 'atrisk') {
      list = list.filter(s => { const { pct } = getStats(s.id); return pct !== null && pct < 70 })
    } else if (filter === 'perfect') {
      list = list.filter(s => getStats(s.id).pct === 100)
    }
    return list
  }, [classStudents, search, filter, getStats])

  // ── Attendance cell click ─────────────────────────────────────────────────
  const handleCell = useCallback(async (studentId, sessionId) => {
    const sess = sessions.find(s => s.id === sessionId)
    if (sess?.locked) return // locked sessions are read-only
    const key     = `${studentId}_${sessionId}`
    const current = attendance[key] ?? null
    const next    = CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length]
    setAttendance(prev => ({ ...prev, [key]: next }))
    if (IS_DEMO) return
    setSaving(prev => new Set(prev).add(key))
    try {
      const res = await fetch('/api/attendance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: studentId, session_id: sessionId, status: next ?? '' }),
      })
      if (!res.ok) throw new Error(await res.text())
    } catch (err) {
      console.error(err)
      setAttendance(prev => ({ ...prev, [key]: current }))
    } finally {
      setSaving(prev => { const s = new Set(prev); s.delete(key); return s })
    }
  }, [attendance, sessions])

  // ── Mark all present (skips locked sessions) ──────────────────────────────
  async function markAllPresent() {
    // Find the most recent visible session that is NOT locked.
    const target = [...visibleSessions].reverse().find(s => !s.locked)
    if (!target) return
    const updates = {}
    classStudents.forEach(s => { updates[`${s.id}_${target.id}`] = 'present' })
    setAttendance(prev => ({ ...prev, ...updates }))
    if (IS_DEMO) return
    await Promise.all(classStudents.map(s =>
      fetch('/api/attendance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: s.id, session_id: target.id, status: 'present' }),
      })
    ))
  }

  // ── Lock / unlock a session ───────────────────────────────────────────────
  function toggleSessionLock(id) {
    const sess = sessions.find(s => s.id === id)
    if (!sess) return
    const willLock = !sess.locked
    const dateLabel = `${fmtShort(sess.session_date)}${sess.label ? ` — ${sess.label}` : ''}`

    setConfirm({
      title: willLock ? 'Lock this session?' : 'Unlock this session?',
      name: dateLabel,
      message: willLock
        ? 'Locking prevents anyone from accidentally changing attendance for this session. You can unlock it again anytime from this same menu.'
        : 'Unlocking allows attendance for this session to be edited again.',
      danger: false,
      confirmLabel: willLock ? '🔒 Lock Session' : '🔓 Unlock Session',
      onConfirm: async () => {
        setConfirm(null)
        setSessions(prev => prev.map(s => s.id === id ? { ...s, locked: willLock } : s))
        if (IS_DEMO) return
        try {
          const res = await fetch(`/api/sessions?id=${id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ locked: willLock }),
          })
          if (!res.ok) throw new Error(await res.text())
        } catch (err) {
          console.error(err)
          // Roll back on failure
          setSessions(prev => prev.map(s => s.id === id ? { ...s, locked: !willLock } : s))
        }
      },
    })
  }

  // ── Class operations ──────────────────────────────────────────────────────
  async function addClass(e) {
    e.preventDefault()
    if (!newClassName.trim()) return
    if (IS_DEMO) {
      const id = Math.max(0, ...classes.map(c => c.id)) + 1
      const cls = { id, name: newClassName.trim(), description: newClassDesc.trim() }
      setClasses(prev => [...prev, cls])
      setSelectedClassId(id)
      setNewClassName(''); setNewClassDesc(''); setShowAddClass(false)
      return
    }
    const res = await fetch('/api/classes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newClassName.trim(), description: newClassDesc.trim() || null }),
    })
    const cls = await res.json()
    setClasses(prev => [...prev, cls])
    setSelectedClassId(cls.id)
    setNewClassName(''); setNewClassDesc(''); setShowAddClass(false)
  }

  function removeClass(id) {
    const cls = classes.find(c => c.id === id)
    if (!cls) return
    setConfirmDelete(cls)
  }

  function confirmRemoveClass() {
    const cls = confirmDelete
    if (!cls) return
    setConfirmDelete(null)

    // Capture full snapshot for undo
    const snapStudents   = students.filter(s => s.class_id === cls.id)
    const snapSessions   = sessions.filter(s => s.class_id === cls.id)
    const snapStudentIds = new Set(snapStudents.map(s => s.id))
    const snapAttendance = Object.fromEntries(
      Object.entries(attendance).filter(([k]) => snapStudentIds.has(Number(k.split('_')[0])))
    )

    // Remove from local state immediately
    setClasses(prev => prev.filter(c => c.id !== cls.id))
    setStudents(prev => prev.filter(s => s.class_id !== cls.id))
    setSessions(prev => prev.filter(s => s.class_id !== cls.id))
    setAttendance(prev => {
      const next = { ...prev }
      Object.keys(snapAttendance).forEach(k => delete next[k])
      return next
    })
    if (selectedClassId === cls.id) {
      const remaining = classes.filter(c => c.id !== cls.id)
      setSelectedClassId(remaining.length ? remaining[0].id : null)
    }

    // Store undo snapshot; delay actual API delete 8 seconds
    setPendingDelete({ cls, students: snapStudents, sessions: snapSessions, attendance: snapAttendance })
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    undoTimerRef.current = setTimeout(async () => {
      setPendingDelete(null)
      if (!IS_DEMO) await fetch(`/api/classes?id=${cls.id}`, { method: 'DELETE' })
    }, 8000)
  }

  async function updateClassName(id, name) {
    const trimmed = name.trim()
    setRenamingClassId(null)
    if (!trimmed) return
    setClasses(prev => prev.map(c => c.id === id ? { ...c, name: trimmed } : c))
    if (IS_DEMO) return
    await fetch(`/api/classes?id=${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed }),
    })
  }

  function undoRemoveClass() {
    if (!pendingDelete) return
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    const { cls, students: s, sessions: sess, attendance: att } = pendingDelete
    setClasses(prev => [...prev, cls].sort((a, b) => a.id - b.id))
    setStudents(prev => [...prev, ...s])
    setSessions(prev => [...prev, ...sess])
    setAttendance(prev => ({ ...prev, ...att }))
    setSelectedClassId(cls.id)
    setPendingDelete(null)
  }

  // ── Student operations ────────────────────────────────────────────────────
  async function addStudent(e) {
    e.preventDefault()
    if (!newName.trim() || !selectedClassId) return
    const name = newName.trim()
    if (IS_DEMO) {
      const id = Math.max(0, ...students.map(s => s.id)) + 1
      setStudents(prev => [...prev, { id, class_id: selectedClassId, full_name: name }]
        .sort((a, b) => a.full_name.localeCompare(b.full_name)))
      setNewName(''); setShowAddStudent(false); return
    }
    const res = await fetch('/api/students', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: name, class_id: selectedClassId }),
    })
    const student = await res.json()
    setStudents(prev => [...prev, student].sort((a, b) => a.full_name.localeCompare(b.full_name)))
    setNewName(''); setShowAddStudent(false)
  }

  function removeStudent(id) {
    const student = students.find(s => s.id === id)
    if (!student) return
    setConfirm({
      title: 'Remove student?',
      name: student.full_name,
      message: 'This will permanently delete all of their attendance records.',
      danger: true,
      confirmLabel: 'Remove Student',
      onConfirm: async () => {
        setConfirm(null)
        setStudents(prev => prev.filter(s => s.id !== id))
        if (IS_DEMO) return
        await fetch(`/api/students?id=${id}`, { method: 'DELETE' })
      },
    })
  }

  // ── Bulk import ───────────────────────────────────────────────────────────
  function downloadTemplate() {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([
      ['full_name'],
      ['Jordan Taylor'],
      ['Alex Rivera'],
      ['Sam Chen'],
    ])
    ws['!cols'] = [{ wch: 30 }]
    XLSX.utils.book_append_sheet(wb, ws, 'Students')
    XLSX.writeFile(wb, 'MISLA-student-import-template.xlsx')
  }

  function handleImportFile(file) {
    if (!file) return
    setImportFile(file)
    const reader = new FileReader()
    reader.onload = e => {
      const wb = XLSX.read(e.target.result, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
      // Find header row — look for a column named full_name (case-insensitive)
      const headerRow = rows.findIndex(r =>
        r.some(c => String(c).trim().toLowerCase().replace(/[^a-z_]/g, '') === 'full_name')
      )
      const colIdx = headerRow >= 0
        ? rows[headerRow].findIndex(c => String(c).trim().toLowerCase().replace(/[^a-z_]/g, '') === 'full_name')
        : 0
      const dataRows = headerRow >= 0 ? rows.slice(headerRow + 1) : rows.slice(1)
      const existingNames = new Set(classStudents.map(s => s.full_name.toLowerCase()))
      const names = dataRows
        .map(r => String(r[colIdx] ?? '').trim())
        .filter(n => n.length > 0)
        .map(name => ({ name, duplicate: existingNames.has(name.toLowerCase()) }))
      setImportPreview(names)
    }
    reader.readAsArrayBuffer(file)
  }

  async function confirmImport() {
    const toAdd = importPreview.filter(r => !r.duplicate).map(r => r.name)
    if (!toAdd.length || !selectedClassId) return
    if (IS_DEMO) {
      let nextId = Math.max(0, ...students.map(s => s.id)) + 1
      const newStudents = toAdd.map(name => ({ id: nextId++, class_id: selectedClassId, full_name: name }))
      setStudents(prev => [...prev, ...newStudents].sort((a, b) => a.full_name.localeCompare(b.full_name)))
    } else {
      const added = await Promise.all(toAdd.map(name =>
        fetch('/api/students', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ full_name: name, class_id: selectedClassId }),
        }).then(r => r.json())
      ))
      setStudents(prev =>
        [...prev, ...added].sort((a, b) => a.full_name.localeCompare(b.full_name))
      )
    }
    setShowImport(false)
    setImportPreview([])
    setImportFile(null)
  }

  // ── Session operations ────────────────────────────────────────────────────
  async function addSession(e) {
    e.preventDefault()
    if (!newDate || !selectedClassId) return
    if (IS_DEMO) {
      const id = Math.max(0, ...sessions.map(s => s.id)) + 1
      const sess = { id, class_id: selectedClassId, session_date: newDate, label: newLabel.trim() || null, locked: false }
      setSessions(prev => [...prev, sess].sort((a, b) => new Date(a.session_date) - new Date(b.session_date)))
      setSelectedMonth(monthKey(newDate))
      setNewDate(''); setNewLabel(''); setShowAddSession(false); return
    }
    const res = await fetch('/api/sessions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_date: newDate, label: newLabel.trim() || null, class_id: selectedClassId }),
    })
    const sess = await res.json()
    setSessions(prev =>
      [...prev, { ...sess, session_date: toDateStr(sess.session_date), locked: !!sess.locked }]
        .sort((a, b) => new Date(a.session_date) - new Date(b.session_date))
    )
    setSelectedMonth(monthKey(newDate))
    setNewDate(''); setNewLabel(''); setShowAddSession(false)
  }

  function removeSession(id) {
    const sess = sessions.find(s => s.id === id)
    if (!sess) return
    if (sess.locked) {
      setConfirm({
        title: 'Session is locked',
        message: 'This session is locked. Unlock it first (🔒 button in the column header) before removing.',
        danger: false,
        confirmLabel: 'OK',
        onConfirm: () => setConfirm(null),
      })
      return
    }
    setConfirm({
      title: 'Remove session?',
      name: `${fmtShort(sess.session_date)}${sess.label ? ` — ${sess.label}` : ''}`,
      message: 'This will permanently delete all attendance records for this session.',
      danger: true,
      confirmLabel: 'Remove Session',
      onConfirm: async () => {
        setConfirm(null)
        setSessions(prev => prev.filter(s => s.id !== id))
        if (IS_DEMO) return
        await fetch(`/api/sessions?id=${id}`, { method: 'DELETE' })
      },
    })
  }

  async function updateSessionLabel(id, label) {
    const sess = sessions.find(s => s.id === id)
    if (sess?.locked) return // labels are read-only on locked sessions
    const trimmed = label.trim() || null
    setSessions(prev => prev.map(s => s.id === id ? { ...s, label: trimmed } : s))
    if (IS_DEMO) return
    await fetch(`/api/sessions?id=${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: trimmed }),
    })
  }

  // ── Export ────────────────────────────────────────────────────────────────
  function exportExcel() {
    const cls     = classes.find(c => c.id === selectedClassId)
    const headers = [
      'Student',
      ...visibleSessions.map(s => s.label || fmtShort(s.session_date)),
      'P', 'E', 'U', 'T', 'Attendance %',
    ]
    const rows = visibleStudents.map(student => {
      const { p, e, u, t, pct } = getStats(student.id)
      return [
        student.full_name,
        ...visibleSessions.map(sess => LABEL[attendance[`${student.id}_${sess.id}`]] ?? ''),
        p, e, u, t, pct !== null ? `${pct}%` : '—',
      ]
    })
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
    ws['!cols'] = [{ wch: 24 }, ...visibleSessions.map(() => ({ wch: 10 })), ...Array(4).fill({ wch: 5 }), { wch: 14 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Attendance')
    const mLabel = selectedMonth === 'all' ? 'All' : monthLabel(selectedMonth).replace(' ', '-')
    XLSX.writeFile(wb, `MISLA-${(cls?.name ?? 'Attendance').replace(/\s+/g, '-')}-${mLabel}.xlsx`)
  }

  // ── Render states ─────────────────────────────────────────────────────────
  if (loading) return (
    <div className="loading-screen">
      <div className="spinner" />
      <p>Loading…</p>
    </div>
  )

  if (error) return (
    <div className="loading-screen">
      <p className="error-msg">⚠ {error}</p>
      <p>Add your Postgres connection string to <code>.env.local</code> then restart.</p>
    </div>
  )

  const hasSessions  = visibleSessions.length > 0
  const markTarget   = [...visibleSessions].reverse().find(s => !s.locked) // most recent unlocked
  const activeClass  = classes.find(c => c.id === selectedClassId)

  // ── No classes yet ────────────────────────────────────────────────────────
  if (!classes.length) return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <img src="https://misla.org/assets/icon/logo.png" alt="MISLA" className="misla-logo" />
          <div className="header-divider" />
          <h1>Attendance Tracker</h1>
        </div>
        <div className="header-right">
          <button type="button" className="btn btn-icon" onClick={() => setShowHelp(true)} aria-label="Instructor guide" title="Instructor Guide">
            <span aria-hidden="true">?</span>
          </button>
        </div>
      </header>
      {pendingDelete && (
        <div className="undo-bar">
          <span>"{pendingDelete.cls.name}" was deleted.</span>
          <button className="undo-btn" onClick={undoRemoveClass}>↩ Undo</button>
        </div>
      )}
      <div className="welcome-screen">
        <img src="https://misla.org/assets/icon/logo.png" alt="MISLA" className="welcome-logo" />
        <h2>Welcome to MISLA Attendance</h2>
        <p>Create your first class to get started tracking attendance.</p>
        <button className="btn btn-primary btn-lg" onClick={() => setShowAddClass(true)}>
          + Create Your First Class
        </button>
      </div>
      {showAddClass && (
        <AddClassModal
          newClassName={newClassName} setNewClassName={setNewClassName}
          newClassDesc={newClassDesc} setNewClassDesc={setNewClassDesc}
          onSubmit={addClass} onClose={() => setShowAddClass(false)}
        />
      )}
    </div>
  )

  return (
    <div className="app">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="app-header">
        <div className="header-left">
          <img src="https://misla.org/assets/icon/logo.png" alt="MISLA" className="misla-logo" />
          <div className="header-divider" />
          <h1><span className="title-full">Attendance Tracker</span><span className="title-short">Attendance</span></h1>
          <select
            className="month-select"
            value={selectedMonth}
            onChange={e => setSelectedMonth(e.target.value)}
          >
            <option value="all">All sessions</option>
            {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </div>
        <div className="header-right">
          {/* Utility group */}
          <div className="header-group">
            <button type="button" className="btn btn-icon" onClick={() => setShowHelp(true)} aria-label="Instructor guide" title="Instructor Guide">
              <span aria-hidden="true">?</span>
            </button>
            <button type="button" className="btn btn-icon" onClick={() => { setImportPreview([]); setImportFile(null); setShowImport(true) }} aria-label="Bulk import students from Excel" title="Bulk import students">
              <span aria-hidden="true">⬆</span>
            </button>
            <button type="button" className="btn btn-icon" onClick={exportExcel} aria-label="Export attendance to Excel" title="Export to Excel">
              <span aria-hidden="true">⬇</span>
            </button>
          </div>

          {/* Action group */}
          <div className="header-group">
            <button
              type="button" className="btn btn-ghost"
              onClick={markAllPresent}
              disabled={!hasSessions || !markTarget}
              title={
                !hasSessions ? 'No sessions yet — add a session first'
                : !markTarget ? 'All visible sessions are locked — unlock one to mark attendance'
                : `Mark all present — ${markTarget.label || fmtShort(markTarget.session_date)}`
              }
            >
              <span aria-hidden="true">✓</span><span className="btn-text"> All Present</span>
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setShowAddSession(true)} title="Add a new session date">
              <span aria-hidden="true">+</span><span className="btn-text"> Session</span>
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setShowAddStudent(true)} title="Add a new student">
              <span aria-hidden="true">+</span><span className="btn-text"> Student</span>
            </button>
          </div>
        </div>
      </header>

      {/* ── Demo banner ─────────────────────────────────────────────────────── */}
      {IS_DEMO && (
        <div className="demo-banner">
          DEMO MODE — nothing saves. Remove <code>VITE_DEMO=true</code> from <code>.env.local</code> and add <code>POSTGRES_URL</code> to go live.
        </div>
      )}

      {/* ── Class tabs ──────────────────────────────────────────────────────── */}
      <div className="class-tabs-bar" role="tablist" aria-label="Classes">
        <div className="class-tabs">
          {classes.map(cls => {
            const isActive   = selectedClassId === cls.id
            const menuOpen   = classMenuId === cls.id
            const isRenaming = renamingClassId === cls.id
            return (
              <div
                key={cls.id}
                className={`class-tab-wrap${isActive ? ' active' : ''}`}
              >
                {/* Tab select button */}
                <button
                  className={`class-tab${isActive ? ' active' : ''}`}
                  role="tab"
                  aria-selected={isActive}
                  aria-label={`${cls.name} class`}
                  onClick={() => { setSelectedClassId(cls.id); setClassMenuId(null) }}
                >
                  {isRenaming ? (
                    <input
                      ref={renameInputRef}
                      className="class-tab-rename-input"
                      defaultValue={cls.name}
                      aria-label={`Rename class ${cls.name}`}
                      onBlur={e => updateClassName(cls.id, e.target.value || cls.name)}
                      onKeyDown={e => {
                        if (e.key === 'Enter')  { e.preventDefault(); e.target.blur() }
                        if (e.key === 'Escape') { e.target.value = cls.name; updateClassName(cls.id, cls.name) }
                        e.stopPropagation()
                      }}
                      onClick={e => e.stopPropagation()}
                    />
                  ) : (
                    <span className="class-tab-name">{cls.name}</span>
                  )}
                </button>

                {/* ⋮ options button — only on active tab */}
                {isActive && !isRenaming && (
                  <div className="class-tab-menu-wrap">
                    <button
                      className={`class-tab-menu-btn${menuOpen ? ' open' : ''}`}
                      aria-label={`Options for ${cls.name}`}
                      aria-haspopup="menu"
                      aria-expanded={menuOpen}
                      title="Class options"
                      onClick={e => {
                        e.stopPropagation()
                        if (menuOpen) { setClassMenuId(null); return }
                        const rect = e.currentTarget.getBoundingClientRect()
                        setClassMenuPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right })
                        setClassMenuId(cls.id)
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Escape') setClassMenuId(null)
                        if (e.key === 'ArrowDown') {
                          e.preventDefault()
                          const rect = e.currentTarget.getBoundingClientRect()
                          setClassMenuPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right })
                          setClassMenuId(cls.id)
                          setTimeout(() => classMenuRef.current?.querySelector('[role="menuitem"]')?.focus(), 30)
                        }
                      }}
                    >
                      ⋮
                    </button>
                    {menuOpen && createPortal(
                      <ul
                        className="class-tab-menu"
                        role="menu"
                        ref={classMenuRef}
                        aria-label={`${cls.name} options`}
                        style={{ top: classMenuPos.top, right: classMenuPos.right }}
                        onKeyDown={e => {
                          if (e.key === 'Escape') { setClassMenuId(null) }
                          if (e.key === 'ArrowDown') { e.preventDefault(); e.currentTarget.querySelector('[role="menuitem"]:last-child')?.focus() }
                          if (e.key === 'ArrowUp')   { e.preventDefault(); e.currentTarget.querySelector('[role="menuitem"]:first-child')?.focus() }
                        }}
                      >
                        <li role="none">
                          <button
                            type="button"
                            role="menuitem"
                            className="class-menu-item"
                            onClick={e => { e.stopPropagation(); setClassMenuId(null); setRenamingClassId(cls.id) }}
                          >
                            <span className="class-menu-icon" aria-hidden="true">✏</span>
                            Rename class
                          </button>
                        </li>
                        <li role="none" className="class-menu-separator" aria-hidden="true" />
                        <li role="none">
                          <button
                            type="button"
                            role="menuitem"
                            className="class-menu-item class-menu-item--danger"
                            onClick={e => { e.stopPropagation(); setClassMenuId(null); removeClass(cls.id) }}
                          >
                            <span className="class-menu-icon" aria-hidden="true">🗑</span>
                            Delete class
                          </button>
                        </li>
                      </ul>,
                      document.body
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <button className="class-tab-add" onClick={() => setShowAddClass(true)} title="Create a new class" aria-label="Create a new class">
          + <span className="btn-text">New Class</span>
        </button>
      </div>

      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div className="toolbar">
        <input
          className="search-input"
          type="search"
          placeholder="Search students…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="filter-tabs" role="group" aria-label="Filter students">
          {[['all','All'],['atrisk','At-Risk < 70%'],['perfect','Perfect']].map(([v, l]) => (
            <button
              type="button" key={v}
              className={`filter-tab${filter === v ? ' active' : ''}`}
              aria-pressed={filter === v}
              onClick={() => setFilter(v)}
            >{l}</button>
          ))}
        </div>
        <span className="record-count">{visibleStudents.length} / {classStudents.length} students</span>
      </div>

      {/* ── Table ───────────────────────────────────────────────────────────── */}
      <div className="table-wrap">
        <table className="att-table">
          <colgroup>
            <col className="col-name" />
            {visibleSessions.map(s => <col key={s.id} className="col-sess" />)}
            <col className="col-stat" /><col className="col-stat" />
            <col className="col-stat" /><col className="col-stat" />
            <col className="col-pct" />
          </colgroup>
          <thead>
            <tr>
              <th className="th-name sticky-col">Student</th>
              {visibleSessions.map(sess => (
                <th key={sess.id} className={`th-sess${sess.locked ? ' locked' : ''}`}>
                  <div className="sess-th-inner">
                    <span className="sess-date">
                      {fmtShort(sess.session_date)}
                      {sess.locked && <span className="sess-lock-badge" aria-hidden="true"> 🔒</span>}
                    </span>
                    <input
                      key={`${sess.id}-${sess.label ?? ''}`}
                      className="sess-label-input"
                      type="text"
                      defaultValue={sess.label ?? ''}
                      placeholder="Add label…"
                      title={sess.locked ? 'Session is locked' : 'Click to edit session label'}
                      aria-label={`Label for session ${fmtShort(sess.session_date)}`}
                      readOnly={sess.locked}
                      disabled={sess.locked}
                      onBlur={e => updateSessionLabel(sess.id, e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                    />
                    <button
                      type="button"
                      className={`lock-btn${sess.locked ? ' locked' : ''}`}
                      onClick={() => toggleSessionLock(sess.id)}
                      aria-label={sess.locked ? `Unlock session ${fmtShort(sess.session_date)}` : `Lock session ${fmtShort(sess.session_date)}`}
                      aria-pressed={sess.locked}
                      title={sess.locked ? 'Locked — click to unlock' : 'Lock to prevent changes'}
                    >
                      <span aria-hidden="true">{sess.locked ? '🔒' : '🔓'}</span>
                    </button>
                    <button
                      type="button"
                      className="remove-btn"
                      onClick={() => removeSession(sess.id)}
                      disabled={sess.locked}
                      aria-label="Remove session"
                      title={sess.locked ? 'Unlock the session before removing' : `Remove session ${fmtShort(sess.session_date)}`}
                    >×</button>
                  </div>
                </th>
              ))}
              {!hasSessions && <th className="th-empty">No sessions yet — click "+ Session" above</th>}
              <th className="th-stat stat-p">P</th>
              <th className="th-stat stat-e">E</th>
              <th className="th-stat stat-u">U</th>
              <th className="th-stat stat-t">T</th>
              <th className="th-pct">Attendance</th>
            </tr>
          </thead>
          <tbody>
            {visibleStudents.map(student => {
              const { p, e, u, t, pct } = getStats(student.id)
              return (
                <tr key={student.id} className={pct !== null && pct < 70 && hasSessions ? 'row-atrisk' : ''}>
                  <td className="td-name sticky-col">
                    <span className="student-name">{student.full_name}</span>
                    <button className="remove-btn" onClick={() => removeStudent(student.id)} aria-label="Remove student" title={`Remove ${student.full_name}`}>×</button>
                  </td>
                  {visibleSessions.map(sess => {
                    const key      = `${student.id}_${sess.id}`
                    const status   = attendance[key] ?? null
                    const col      = COLORS[status]
                    const isSav    = saving.has(key)
                    const isLocked = !!sess.locked
                    return (
                      <td key={sess.id}
                        className={`td-cell${isSav ? ' saving' : ''}${isLocked ? ' locked' : ''}`}
                        style={col ? { background: col.bg, color: col.fg } : undefined}
                        onClick={() => handleCell(student.id, sess.id)}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCell(student.id, sess.id) } }}
                        tabIndex={isLocked ? -1 : 0}
                        role={isLocked ? undefined : 'button'}
                        aria-disabled={isLocked || undefined}
                        aria-label={
                          isLocked
                            ? `${student.full_name} on ${fmtShort(sess.session_date)}: ${status ? STATUS_LABEL[status] : 'not recorded'}. Session is locked.`
                            : `${student.full_name} on ${fmtShort(sess.session_date)}: ${status ? STATUS_LABEL[status] : 'not recorded'}. Press Enter to cycle.`
                        }
                        title={
                          isLocked
                            ? `Locked — ${status ? STATUS_LABEL[status] : 'no record'}`
                            : status ? `${STATUS_LABEL[status]} — click to change` : 'Click to mark'
                        }
                      >
                        {isSav ? <span className="dot-spin">·</span> : (LABEL[status] ?? '')}
                      </td>
                    )
                  })}
                  {!hasSessions && <td className="td-empty" />}
                  <td className="td-stat stat-p">{p > 0 ? p : ''}</td>
                  <td className="td-stat stat-e">{e > 0 ? e : ''}</td>
                  <td className="td-stat stat-u">{u > 0 ? u : ''}</td>
                  <td className="td-stat stat-t">{t > 0 ? t : ''}</td>
                  <td className="td-pct">
                    {pct !== null ? (
                      <div className="pct-wrap">
                        <div className="pct-bar" style={{
                          width: `${pct}%`,
                          background: pct >= 90 ? '#22c55e' : pct >= 70 ? '#f37524' : '#ef4444',
                        }} />
                        <span className="pct-text">{pct}%</span>
                      </div>
                    ) : <span className="pct-dash">—</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {visibleStudents.length === 0 && (
          <div className="empty-state">
            {classStudents.length === 0 ? (
              <>
                <div className="empty-icon" aria-hidden="true">👋</div>
                <h3>No students in this class yet</h3>
                <p>Add students one at a time, or import a whole roster from Excel.</p>
                <div className="empty-actions">
                  <button type="button" className="btn btn-primary" onClick={() => setShowAddStudent(true)}>+ Add Student</button>
                  <button type="button" className="btn btn-outline" onClick={() => { setImportPreview([]); setImportFile(null); setShowImport(true) }}>⬆ Import from Excel</button>
                </div>
              </>
            ) : (
              <>
                <div className="empty-icon" aria-hidden="true">🔍</div>
                <h3>No students match your filters</h3>
                <p>Try clearing the search or switching to "All".</p>
                <div className="empty-actions">
                  <button type="button" className="btn btn-outline" onClick={() => { setSearch(''); setFilter('all') }}>Clear filters</button>
                </div>
              </>
            )}
          </div>
        )}
        {classStudents.length > 0 && !hasSessions && (
          <div className="empty-state empty-sessions">
            <div className="empty-icon" aria-hidden="true">📅</div>
            <h3>No sessions yet</h3>
            <p>Add the first class meeting date to start tracking attendance.</p>
            <div className="empty-actions">
              <button type="button" className="btn btn-primary" onClick={() => setShowAddSession(true)}>+ Add Session</button>
            </div>
          </div>
        )}
      </div>

      {/* ── Legend ──────────────────────────────────────────────────────────── */}
      <footer className="legend">
        {Object.entries(LABEL).map(([status, lbl]) => (
          <span key={status} className="legend-item">
            <span className="legend-chip" style={{ background: COLORS[status].bg, color: COLORS[status].fg }}>{lbl}</span>
            <span className="legend-label">{status === 'present' ? 'Present' : status === 'excused' ? 'Excused' : status === 'absent' ? 'Unexcused' : 'Tardy'}</span>
          </span>
        ))}
        <span className="legend-item">
          <span className="legend-chip chip-blank" /><span className="legend-label">Not recorded</span>
        </span>
        <span className="legend-hint">Tap any cell to cycle</span>
        <span className="app-credit">Built by AiYogi · TwinFlame Ventures</span>
      </footer>

      {/* ── Modals ──────────────────────────────────────────────────────────── */}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}

      {showImport && (
        <ImportStudentsModal
          activeClass={activeClass}
          importPreview={importPreview}
          importFile={importFile}
          onFileChange={handleImportFile}
          onDownloadTemplate={downloadTemplate}
          onConfirm={confirmImport}
          onClose={() => { setShowImport(false); setImportPreview([]); setImportFile(null) }}
        />
      )}

      {confirm && (
        <ConfirmModal
          title={confirm.title}
          name={confirm.name}
          message={confirm.message}
          danger={confirm.danger}
          confirmLabel={confirm.confirmLabel}
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}

      {confirmDelete && (
        <ConfirmDeleteClassModal
          cls={confirmDelete}
          studentCount={students.filter(s => s.class_id === confirmDelete.id).length}
          sessionCount={sessions.filter(s => s.class_id === confirmDelete.id).length}
          onConfirm={confirmRemoveClass}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {showAddClass && (
        <AddClassModal
          newClassName={newClassName} setNewClassName={setNewClassName}
          newClassDesc={newClassDesc} setNewClassDesc={setNewClassDesc}
          onSubmit={addClass} onClose={() => setShowAddClass(false)}
        />
      )}

      {showAddStudent && (
        <div className="modal-overlay" onClick={() => setShowAddStudent(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <button type="button" className="modal-back" onClick={() => setShowAddStudent(false)} aria-label="Go back" title="Go back">←</button>
              <h2 className="modal-title">Add Student</h2>
            </div>
            {activeClass && <p className="modal-context">Class: <strong>{activeClass.name}</strong></p>}
            <form onSubmit={addStudent}>
              <label className="modal-label">Full name</label>
              <input autoFocus className="modal-input" type="text" placeholder="e.g. Jordan Taylor"
                value={newName} onChange={e => setNewName(e.target.value)} />
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setShowAddStudent(false)}>← Back</button>
                <button type="submit" className="btn btn-primary" disabled={!newName.trim()}>Add Student</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showAddSession && (
        <div className="modal-overlay" onClick={() => setShowAddSession(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <button type="button" className="modal-back" onClick={() => setShowAddSession(false)} aria-label="Go back" title="Go back">←</button>
              <h2 className="modal-title">Add Session</h2>
            </div>
            {activeClass && <p className="modal-context">Class: <strong>{activeClass.name}</strong></p>}
            <form onSubmit={addSession}>
              <label className="modal-label">Date</label>
              <input autoFocus className="modal-input" type="date"
                value={newDate} onChange={e => setNewDate(e.target.value)} />
              <label className="modal-label">Label <span className="optional">(optional)</span></label>
              <input className="modal-input" type="text" placeholder="e.g. February Week 1"
                value={newLabel} onChange={e => setNewLabel(e.target.value)} />
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setShowAddSession(false)}>← Back</button>
                <button type="submit" className="btn btn-primary" disabled={!newDate}>Add Session</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Help Modal ──────────────────────────────────────────────────────────────
function HelpModal({ onClose }) {
  return (
    <div className="modal-overlay help-overlay" onClick={onClose}>
      <div className="help-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="help-title">

        <div className="help-header">
          <button type="button" className="modal-back help-back" onClick={onClose} aria-label="Close guide" title="Close guide">←</button>
          <img src="https://misla.org/assets/icon/logo.png" alt="MISLA" className="help-logo" />
          <div className="help-header-text">
            <h2 className="help-title" id="help-title">Instructor Guide</h2>
            <p className="help-subtitle">MISLA Attendance Tracker · Press <kbd>Esc</kbd> to close</p>
          </div>
          <button type="button" className="help-close" onClick={onClose} aria-label="Close guide" title="Close guide">×</button>
        </div>

        <div className="help-body">

          {/* ── Quick Start ───────────────────────────────────────────── */}
          <section className="help-section">
            <h3><span className="help-num">★</span> Quick Start (60 seconds)</h3>
            <ol>
              <li><strong>Pick or create a class</strong> in the orange tab bar.</li>
              <li><strong>Add students</strong> — click <strong>+ Student</strong> (or use <strong>⬆ Import</strong> for a whole roster from Excel).</li>
              <li><strong>Add a session date</strong> — click <strong>+ Session</strong>.</li>
              <li><strong>Take attendance</strong> — tap any cell in the grid to cycle: blank → P → E → U → T.</li>
              <li><strong>Lock the session</strong> when you're finished — click the 🔓 in the column header to lock it (becomes 🔒) so attendance can't be changed by accident.</li>
              <li><strong>Done.</strong> Everything saves automatically.</li>
            </ol>
            <div className="help-tip">💡 You never need to "save". Every tap on the attendance grid syncs instantly to the database. A small blinking dot appears for a fraction of a second while saving.</div>
          </section>

          {/* ── 1. Header tour ────────────────────────────────────────── */}
          <section className="help-section">
            <h3><span className="help-num">1</span> The Header at a Glance</h3>
            <p>The dark navy bar at the top has every action you'll need, organized into two groups:</p>
            <p><strong>Left side</strong> — MISLA logo, app title, and the month dropdown to filter sessions by month.</p>
            <p style={{marginTop:6}}><strong>Right side</strong>:</p>
            <ul>
              <li><strong>?</strong> — opens this guide</li>
              <li><strong>⬆ Import</strong> — bulk-import students from an Excel file</li>
              <li><strong>⬇ Export</strong> — download the current view as Excel</li>
              <li><strong>✓ All Present</strong> — mark every student present for the most recent session</li>
              <li><strong>+ Session</strong> — add a new class meeting date</li>
              <li><strong>+ Student</strong> — add one student</li>
            </ul>
            <div className="help-tip">💡 On phones, the buttons collapse to icons only. Hover or long-press any button to see its label.</div>
          </section>

          {/* ── 2. Classes ───────────────────────────────────────────── */}
          <section className="help-section">
            <h3><span className="help-num">2</span> Managing Classes</h3>
            <p>Each cohort or course is a separate class — students, sessions, and attendance never mix between them.</p>
            <p><strong>Create a class:</strong></p>
            <ol>
              <li>Click <strong>+ New Class</strong> on the right edge of the orange tab bar.</li>
              <li>Type a class name (e.g. <em>"Web Dev Bootcamp — Spring 2026"</em>) and an optional description.</li>
              <li>Click <strong>Create Class</strong>.</li>
            </ol>
            <p style={{marginTop:8}}><strong>Switch between classes:</strong> tap any class tab.</p>
            <p style={{marginTop:8}}><strong>Rename or delete a class:</strong></p>
            <ol>
              <li>Make sure the class is the active (orange) tab.</li>
              <li>Click the <strong>⋮ Edit</strong> button at the right edge of the tab.</li>
              <li>Choose <strong>✏ Rename class</strong> or <strong>🗑 Delete class</strong> from the menu.</li>
            </ol>
            <ul>
              <li>After clicking <em>Rename</em>: type the new name → press <kbd>Enter</kbd> to save or <kbd>Esc</kbd> to cancel.</li>
              <li>After clicking <em>Delete</em>: a confirmation shows how many students and sessions will be removed. Once you confirm, an <strong>↩ Undo</strong> bar appears for <strong>8 seconds</strong> — click it to fully restore the class.</li>
            </ul>
            <div className="help-warn">⚠️ After 8 seconds the deletion is permanent. <strong>Export to Excel first</strong> if you need a backup.</div>
          </section>

          {/* ── 3. Students ──────────────────────────────────────────── */}
          <section className="help-section">
            <h3><span className="help-num">3</span> Adding Students</h3>
            <p>First, make sure the correct class tab is selected.</p>
            <p><strong>One at a time:</strong></p>
            <ol>
              <li>Click <strong>+ Student</strong> in the header.</li>
              <li>Type the student's full name.</li>
              <li>Click <strong>Add Student</strong>.</li>
            </ol>
            <p style={{marginTop:8}}><strong>Bulk import a whole roster from Excel:</strong></p>
            <ol>
              <li>Click <strong>⬆ Import</strong> in the header.</li>
              <li>Click <strong>⬇ Download Template (.xlsx)</strong> for a pre-formatted file.</li>
              <li>Open the file in Excel/Numbers/Google Sheets and put one name per row in the <code>full_name</code> column.</li>
              <li>Drag the saved file onto the upload area (or tap to browse).</li>
              <li>Review the preview — new names show in green; duplicates are automatically flagged and skipped.</li>
              <li>Click <strong>Add Students</strong> to import them all in one go.</li>
            </ol>
            <p style={{marginTop:8}}><strong>Remove a student:</strong> hover over their row (or tap once on mobile) and click the small × that appears next to their name. A confirmation dialog will prompt you before deletion.</p>
            <div className="help-warn">⚠️ Removing a student permanently deletes <strong>all</strong> their attendance records.</div>
          </section>

          {/* ── 4. Sessions ──────────────────────────────────────────── */}
          <section className="help-section">
            <h3><span className="help-num">4</span> Adding &amp; Editing Sessions</h3>
            <p>A session is a single class meeting — typically a date like "Jan 10".</p>
            <p><strong>Create a session:</strong></p>
            <ol>
              <li>Click <strong>+ Session</strong> in the header.</li>
              <li>Pick a date.</li>
              <li>Optionally add a label like "Week 1" or "Final review".</li>
              <li>Click <strong>Add Session</strong>. A new column appears in the grid.</li>
            </ol>
            <p style={{marginTop:8}}><strong>Edit a session label any time:</strong> click directly on the label text shown under the date in the column header. Type the new label and press <kbd>Enter</kbd> or click away.</p>
            <p style={{marginTop:8}}><strong>Remove a session:</strong> hover over a session column header and click the × in the top-right corner. A confirmation dialog will prompt you before deletion.</p>
            <div className="help-tip">💡 Use the <strong>month dropdown</strong> at the top-left to view sessions one month at a time. P/E/U/T totals and the attendance % bar automatically recalculate for whatever sessions are visible.</div>
          </section>

          {/* ── 5. Locking past sessions ─────────────────────────────── */}
          <section className="help-section">
            <h3><span className="help-num">5</span> Locking Past Sessions</h3>
            <p>Once a session's attendance is finalized, lock it to prevent <em>any</em> accidental changes.</p>
            <p><strong>How to lock or unlock a session:</strong></p>
            <ol>
              <li>Find the session column header in the grid.</li>
              <li>Click the small <strong>🔓</strong> (open padlock) icon in the <em>top-left</em> corner of that column.</li>
              <li>Confirm the lock in the dialog. The icon changes to <strong>🔒</strong> and the column gets a striped amber pattern.</li>
              <li>To unlock, click the <strong>🔒</strong> again and confirm.</li>
            </ol>
            <p style={{marginTop:8}}><strong>What happens when a session is locked:</strong></p>
            <ul>
              <li>Cells in that column can't be clicked, tapped, or keyboard-cycled.</li>
              <li>The label is read-only.</li>
              <li>The × remove button is disabled — you must unlock first to remove a locked session.</li>
              <li><strong>✓ All Present</strong> automatically <em>skips</em> locked sessions and marks the next most recent unlocked one instead. If every visible session is locked, the button is disabled.</li>
              <li>The server enforces the lock too — even direct API writes will be rejected with HTTP 423 (Locked).</li>
            </ul>
            <div className="help-tip">💡 Recommended workflow: take attendance during class → spot-check at the end → lock the session. Your past data is now safe even if the page is left open on a shared device.</div>
            <div className="help-warn">⚠️ Locking is per-session, not per-class. Each new session starts unlocked, so you can take attendance freely.</div>
          </section>

          {/* ── 6. Taking attendance ─────────────────────────────────── */}
          <section className="help-section">
            <h3><span className="help-num">6</span> Taking Attendance</h3>
            <p style={{marginTop:0,marginBottom:8,color:'var(--muted)',fontSize:13}}>
              <em>(Make sure the session column is unlocked — see section 5.)</em>
            </p>
            <p>Each student is a row, each session is a column. Tap (or click) any cell to cycle through five states:</p>
            <div className="help-status-grid">
              <span className="help-chip chip-blank">—</span>
              <span><strong>Blank</strong> — not yet recorded</span>
              <span className="help-chip" style={{ background:'#dcfce7', color:'#15803d' }}>P</span>
              <span><strong>Present</strong> — student attended</span>
              <span className="help-chip" style={{ background:'#dbeafe', color:'#1d4ed8' }}>E</span>
              <span><strong>Excused</strong> — approved absence, counts <em>toward</em> attendance %</span>
              <span className="help-chip" style={{ background:'#fee2e2', color:'#b91c1c' }}>U</span>
              <span><strong>Unexcused</strong> — no-show, counts <em>against</em> attendance %</span>
              <span className="help-chip" style={{ background:'#fef3c7', color:'#92400e' }}>T</span>
              <span><strong>Tardy</strong> — arrived late, counts <em>against</em> attendance %</span>
            </div>
            <p style={{marginTop:8}}>Tapping cycles in the order above and wraps back to blank, so you can always cycle past a mistake to clear it.</p>
            <p style={{marginTop:8}}><strong>Mark a whole class present at once:</strong> click <strong>✓ All Present</strong>. This marks everyone present for the <em>most recent visible session</em>.</p>
            <div className="help-tip">⌨️ Keyboard users: press <kbd>Tab</kbd> until a cell is focused (orange outline), then press <kbd>Enter</kbd> or <kbd>Space</kbd> to cycle the status.</div>
          </section>

          {/* ── 7. Reading attendance % ──────────────────────────────── */}
          <section className="help-section">
            <h3><span className="help-num">7</span> Reading the Attendance %</h3>
            <p>The far-right column on each row shows that student's attendance rate as a colored bar:</p>
            <ul>
              <li><span className="inline-badge" style={{background:'#22c55e'}}>90–100%</span> Green — excellent attendance</li>
              <li><span className="inline-badge" style={{background:'#f37524'}}>70–89%</span> Orange — watch this student</li>
              <li><span className="inline-badge" style={{background:'#ef4444'}}>&lt; 70%</span> Red — at risk; the whole row is highlighted in pale orange</li>
            </ul>
            <p style={{marginTop:8}}><strong>Formula:</strong> <code>(P + E) ÷ total sessions × 100</code></p>
            <p style={{marginTop:6}}>The percentage updates live as you mark cells, and only counts the <em>visible</em> sessions (so changing the month filter changes everyone's number).</p>
          </section>

          {/* ── 8. Filtering & searching ─────────────────────────────── */}
          <section className="help-section">
            <h3><span className="help-num">8</span> Filtering &amp; Searching</h3>
            <p>The toolbar above the grid has three tools, all of which work together:</p>
            <ul>
              <li><strong>Search bar</strong> — type any part of a name. The list filters live.</li>
              <li><strong>All</strong> — show every student in the class.</li>
              <li><strong>At-Risk &lt; 70%</strong> — show only students below the threshold. Great for follow-up conversations or referrals.</li>
              <li><strong>Perfect</strong> — show only students with 100% attendance. Great for recognition.</li>
            </ul>
            <p style={{marginTop:8}}>The "<em>X / Y students</em>" counter on the right tells you how many are visible vs. total.</p>
          </section>

          {/* ── 9. Exporting ─────────────────────────────────────────── */}
          <section className="help-section">
            <h3><span className="help-num">9</span> Exporting to Excel</h3>
            <ol>
              <li>(Optional) Select a month or "All sessions" with the dropdown to control which sessions are included.</li>
              <li>(Optional) Apply a filter (At-Risk / Perfect / search text) to export only that subset.</li>
              <li>Click <strong>⬇ Export</strong> in the header.</li>
            </ol>
            <p style={{marginTop:8}}>The downloaded <code>.xlsx</code> file includes:</p>
            <ul>
              <li>Student names</li>
              <li>One column per visible session (with the date and label)</li>
              <li>P / E / U / T totals</li>
              <li>Attendance % for each student</li>
            </ul>
            <div className="help-tip">💡 The filename always includes the class name and month, e.g. <em>MISLA-Web-Dev-Bootcamp-2026-January-2026.xlsx</em></div>
          </section>

          {/* ── 9. Keyboard shortcuts ────────────────────────────────── */}
          <section className="help-section">
            <h3><span className="help-num">⌨</span> Keyboard Shortcuts</h3>
            <ul>
              <li><kbd>Tab</kbd> — move forward through buttons, cells, and inputs</li>
              <li><kbd>Shift</kbd> + <kbd>Tab</kbd> — move backward</li>
              <li><kbd>Enter</kbd> or <kbd>Space</kbd> on an attendance cell — cycle the status</li>
              <li><kbd>Enter</kbd> in a label or rename input — save changes</li>
              <li><kbd>Esc</kbd> — close any open menu or dialog (or cancel a rename)</li>
              <li><kbd>↓</kbd> arrow on the <strong>⋮ Edit</strong> button — open the menu and focus the first option</li>
              <li><kbd>↑</kbd> / <kbd>↓</kbd> inside the menu — move between options</li>
            </ul>
          </section>

          {/* ── 10. Mobile / tablet ──────────────────────────────────── */}
          <section className="help-section">
            <h3><span className="help-num">📱</span> Mobile &amp; Tablet</h3>
            <ul>
              <li>The app is fully responsive — works on iPhone, iPad, Android phones &amp; tablets.</li>
              <li>The grid scrolls horizontally if you have many sessions; the student-name column stays pinned to the left.</li>
              <li>The header row stays pinned to the top as you scroll down through students.</li>
              <li>On phones, button labels collapse to icons to save space — tap to use them, long-press to see the label.</li>
              <li>The remove (×) buttons on student rows are always visible on touch devices, so you don't need to hover.</li>
            </ul>
          </section>

          {/* ── 11. Troubleshooting ──────────────────────────────────── */}
          <section className="help-section">
            <h3><span className="help-num">?</span> Troubleshooting</h3>
            <ul>
              <li><strong>"DEMO MODE" yellow banner is showing</strong> — the app is using mock data and nothing is saving. Remove <code>VITE_DEMO=true</code> from <code>.env.local</code> and add a real <code>POSTGRES_URL</code> to go live.</li>
              <li><strong>I deleted a class by accident</strong> — click <strong>↩ Undo</strong> in the dark bar at the top within 8 seconds. After 8 seconds the deletion is permanent.</li>
              <li><strong>Imported students didn't appear</strong> — make sure the Excel file's first column is named <code>full_name</code> (lowercase, with the underscore) and that names are in rows below the header.</li>
              <li><strong>Attendance % seems wrong</strong> — remember it only counts <em>visible</em> sessions. Switch the month dropdown to "All sessions" to see the full-cohort number.</li>
              <li><strong>"Can't click attendance cells"</strong> — the column probably has a 🔒 in the corner. Click it to unlock the session, then you can edit again.</li>
              <li><strong>"Can't remove a session"</strong> — same as above; the × is disabled until you unlock the column.</li>
              <li><strong>"All Present" button is disabled</strong> — every visible session is locked. Unlock at least one to use it.</li>
            </ul>
          </section>

        </div>

        <div className="help-footer">
          <p>Made In South Los Angeles · <strong>misla.org</strong></p>
          <p className="help-credit">Built by <strong>AiYogi</strong> · <span>TwinFlame Ventures</span></p>
          <div className="help-footer-actions">
            <button type="button" className="btn btn-outline" onClick={onClose}>← Back</button>
            <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
          </div>
        </div>

      </div>
    </div>
  )
}

// ─── Import Students Modal ────────────────────────────────────────────────────
function ImportStudentsModal({ activeClass, importPreview, importFile, onFileChange, onDownloadTemplate, onConfirm, onClose }) {
  const newCount = importPreview.filter(r => !r.duplicate).length
  const dupCount = importPreview.filter(r =>  r.duplicate).length

  function handleDrop(e) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) onFileChange(file)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-import" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <button className="modal-back" onClick={onClose} aria-label="Go back" title="Go back">←</button>
          <h2 className="modal-title">Import Students</h2>
        </div>
        {activeClass && <p className="modal-context">Class: <strong>{activeClass.name}</strong></p>}

        <button className="btn btn-outline import-template-btn" onClick={onDownloadTemplate} title="Download Excel template">
          ⬇ Download Template (.xlsx)
        </button>
        <p className="import-hint">Fill the template with one student name per row in the <code>full_name</code> column, then upload it below.</p>

        <div
          className={`import-dropzone${importFile ? ' has-file' : ''}`}
          onDrop={handleDrop}
          onDragOver={e => e.preventDefault()}
          onClick={() => document.getElementById('import-file-input').click()}
        >
          {importFile
            ? <span className="import-filename">📄 {importFile.name}</span>
            : <span className="import-drop-hint">Drop your .xlsx file here<br /><small>or tap to browse</small></span>
          }
          <input
            id="import-file-input" type="file" accept=".xlsx,.xls,.csv"
            style={{ display: 'none' }}
            onChange={e => onFileChange(e.target.files[0])}
          />
        </div>

        {importPreview.length > 0 && (
          <div className="import-preview">
            <p className="import-preview-summary">
              <strong>{newCount}</strong> new student{newCount !== 1 ? 's' : ''} will be added
              {dupCount > 0 && <span className="import-dup-note"> · {dupCount} already exist (skipped)</span>}
            </p>
            <ul className="import-preview-list">
              {importPreview.map((r, i) => (
                <li key={i} className={r.duplicate ? 'import-row-dup' : 'import-row-new'}>
                  {r.duplicate ? '⊘' : '＋'} {r.name}
                  {r.duplicate && <span className="import-dup-badge">already in class</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-outline" onClick={onClose}>← Back</button>
          <button
            type="button" className="btn btn-primary"
            disabled={newCount === 0}
            onClick={onConfirm}
            title={newCount === 0 ? 'Upload a file with at least one new student' : `Add ${newCount} student${newCount !== 1 ? 's' : ''}`}
          >
            Add {newCount > 0 ? newCount : ''} Student{newCount !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Generic Confirm Modal (for student/session deletion etc.) ────────────────
function ConfirmModal({ title, name, message, danger, confirmLabel = 'Confirm', onConfirm, onCancel }) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className={`modal${danger ? ' modal-danger' : ''}`} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <button type="button" className="modal-back" onClick={onCancel} aria-label="Go back" title="Go back">←</button>
          <h2 className="modal-title">{title}</h2>
        </div>
        {name && <p className="modal-delete-name">"{name}"</p>}
        {message && <p className="modal-delete-warn">{message}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-outline" onClick={onCancel}>← Back</button>
          <button type="button" className={danger ? 'btn btn-danger' : 'btn btn-primary'} onClick={onConfirm} autoFocus>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Confirm Delete Class Modal ───────────────────────────────────────────────
function ConfirmDeleteClassModal({ cls, studentCount, sessionCount, onConfirm, onCancel }) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal modal-danger" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <button className="modal-back" onClick={onCancel} aria-label="Go back" title="Go back">←</button>
          <h2 className="modal-title">Delete Class?</h2>
        </div>
        <p className="modal-delete-name">"{cls.name}"</p>
        <p className="modal-delete-warn">
          This will permanently delete <strong>{studentCount} student{studentCount !== 1 ? 's' : ''}</strong> and{' '}
          <strong>{sessionCount} session{sessionCount !== 1 ? 's' : ''}</strong> along with all attendance records.
          This cannot be undone.
        </p>
        <div className="modal-actions">
          <button type="button" className="btn btn-outline" onClick={onCancel}>← Back</button>
          <button type="button" className="btn btn-danger" onClick={onConfirm}>Delete Class</button>
        </div>
      </div>
    </div>
  )
}

// ─── Add Class Modal (shared) ─────────────────────────────────────────────────
function AddClassModal({ newClassName, setNewClassName, newClassDesc, setNewClassDesc, onSubmit, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <button className="modal-back" onClick={onClose} aria-label="Go back" title="Go back">←</button>
          <h2 className="modal-title">Create Class</h2>
        </div>
        <form onSubmit={onSubmit}>
          <label className="modal-label">Class name</label>
          <input autoFocus className="modal-input" type="text" placeholder="e.g. Web Dev Bootcamp 2026"
            value={newClassName} onChange={e => setNewClassName(e.target.value)} />
          <label className="modal-label">Description <span className="optional">(optional)</span></label>
          <input className="modal-input" type="text" placeholder="e.g. Spring cohort — Jan to June"
            value={newClassDesc} onChange={e => setNewClassDesc(e.target.value)} />
          <div className="modal-actions">
            <button type="button" className="btn btn-outline" onClick={onClose}>← Back</button>
            <button type="submit" className="btn btn-primary" disabled={!newClassName.trim()}>Create Class</button>
          </div>
        </form>
      </div>
    </div>
  )
}
