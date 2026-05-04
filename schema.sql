-- =============================================================
--  MISLA Attendance Tracker — Schema + Seed
--  Safe to re-run (ON CONFLICT DO NOTHING / IF NOT EXISTS)
-- =============================================================

-- -----------------------------------------------------------
-- Tables
-- -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS classes (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_classes_name UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS students (
  id         SERIAL PRIMARY KEY,
  class_id   INT REFERENCES classes(id) ON DELETE CASCADE,
  full_name  TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_students_class_name UNIQUE (class_id, full_name)
);

CREATE TABLE IF NOT EXISTS sessions (
  id           SERIAL PRIMARY KEY,
  class_id     INT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  session_date DATE NOT NULL,
  label        TEXT,
  locked       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_sessions_class_date UNIQUE (class_id, session_date)
);

-- Idempotent migration for existing deployments that pre-date the locked column.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS locked BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS attendance (
  id         SERIAL PRIMARY KEY,
  student_id INT  NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  session_id INT  NOT NULL REFERENCES sessions(id)  ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'present'
               CHECK (status IN ('present', 'absent', 'late', 'excused')),
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_attendance UNIQUE (student_id, session_id)
);

-- -----------------------------------------------------------
-- Indexes
-- -----------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_students_class    ON students(class_id);
CREATE INDEX IF NOT EXISTS idx_sessions_class    ON sessions(class_id);
CREATE INDEX IF NOT EXISTS idx_sessions_date     ON sessions(session_date);
CREATE INDEX IF NOT EXISTS idx_attendance_sess   ON attendance(session_id);
CREATE INDEX IF NOT EXISTS idx_attendance_stud   ON attendance(student_id);

-- -----------------------------------------------------------
-- Seed: default class
-- -----------------------------------------------------------

INSERT INTO classes (name, description) VALUES
  ('MISLA Bootcamp 2026', 'Made In South Los Angeles Tech Bootcamp — Jan–Mar 2026')
ON CONFLICT (name) DO NOTHING;

-- -----------------------------------------------------------
-- Seed: students (assigned to default class)
-- -----------------------------------------------------------

WITH cls AS (SELECT id FROM classes WHERE name = 'MISLA Bootcamp 2026')
INSERT INTO students (class_id, full_name)
SELECT cls.id, v.name FROM cls CROSS JOIN (VALUES
  ('Steve Eteaki'),
  ('Daniel Bisuano'),
  ('Giovanni Hernandez'),
  ('Karmyn Luong'),
  ('Amtul Anderson'),
  ('Monique Gutierrez'),
  ('Esther Caballero'),
  ('Giovanni McEastland'),
  ('Che Lia Spriggs'),
  ('Sergey Ulyanov'),
  ('Arthur Seltzer'),
  ('Cathalyn Roberts'),
  ('Eliot Williamson'),
  ('Ja''Corey Sherman'),
  ('Danny Flores'),
  ('Tanya Nevarez'),
  ('Roderick Towns'),
  ('Andrew Hubbell III'),
  ('Jessica Marroquin'),
  ('Mikaela Vera Cruz'),
  ('Lawrence Marquez'),
  ('Romina Estrada'),
  ('Evi Alonzo'),
  ('Adan Oceguera'),
  ('CJ Calica'),
  ('Joshua Randolph'),
  ('Jada Randolph'),
  ('Anthony Lewis'),
  ('Maverick Mathews'),
  ('Jordan Taylor')
) v(name)
ON CONFLICT (class_id, full_name) DO NOTHING;

-- -----------------------------------------------------------
-- Seed: sessions (3 January 2026 sessions)
-- -----------------------------------------------------------

WITH cls AS (SELECT id FROM classes WHERE name = 'MISLA Bootcamp 2026')
INSERT INTO sessions (class_id, session_date, label)
SELECT cls.id, v.dt::DATE, v.lbl FROM cls CROSS JOIN (VALUES
  ('2026-01-10', 'January Week 1'),
  ('2026-01-17', 'January Week 2'),
  ('2026-01-24', 'January Week 3')
) v(dt, lbl)
ON CONFLICT (class_id, session_date) DO NOTHING;
