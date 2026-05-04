import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const { session_id, student_id } = req.query;

      // Filter by session, student, or both — or return all
      if (session_id && student_id) {
        const { rows } = await sql`
          SELECT a.id, a.student_id, a.session_id, a.status, a.notes, a.created_at,
                 s.full_name, ss.session_date, ss.label
          FROM attendance a
          JOIN students s  ON s.id  = a.student_id
          JOIN sessions ss ON ss.id = a.session_id
          WHERE a.session_id = ${session_id}
            AND a.student_id = ${student_id}
        `;
        return res.status(200).json(rows);
      }

      if (session_id) {
        const { rows } = await sql`
          SELECT a.id, a.student_id, a.session_id, a.status, a.notes, a.created_at,
                 s.full_name, ss.session_date, ss.label
          FROM attendance a
          JOIN students s  ON s.id  = a.student_id
          JOIN sessions ss ON ss.id = a.session_id
          WHERE a.session_id = ${session_id}
          ORDER BY s.full_name ASC
        `;
        return res.status(200).json(rows);
      }

      if (student_id) {
        const { rows } = await sql`
          SELECT a.id, a.student_id, a.session_id, a.status, a.notes, a.created_at,
                 s.full_name, ss.session_date, ss.label
          FROM attendance a
          JOIN students s  ON s.id  = a.student_id
          JOIN sessions ss ON ss.id = a.session_id
          WHERE a.student_id = ${student_id}
          ORDER BY ss.session_date ASC
        `;
        return res.status(200).json(rows);
      }

      const { rows } = await sql`
        SELECT a.id, a.student_id, a.session_id, a.status, a.notes, a.created_at,
               s.full_name, ss.session_date, ss.label
        FROM attendance a
        JOIN students s  ON s.id  = a.student_id
        JOIN sessions ss ON ss.id = a.session_id
        ORDER BY ss.session_date ASC, s.full_name ASC
      `;
      return res.status(200).json(rows);
    }

    if (req.method === 'POST') {
      const { student_id, session_id, status, notes } = req.body ?? {};

      if (!student_id || !session_id) {
        return res.status(400).json({ error: 'student_id and session_id are required' });
      }

      // Refuse any write if the session is locked — instructor must explicitly unlock first.
      const { rows: lockCheck } = await sql`
        SELECT locked FROM sessions WHERE id = ${session_id}
      `;
      if (lockCheck.length && lockCheck[0].locked) {
        return res.status(423).json({
          error: 'Session is locked. Unlock the session before changing attendance.',
          locked: true,
        });
      }

      // Empty / missing status → delete the record
      if (!status?.trim()) {
        await sql`
          DELETE FROM attendance
          WHERE student_id = ${student_id}
            AND session_id = ${session_id}
        `;
        return res.status(200).json({ deleted: true, student_id, session_id });
      }

      const VALID = ['present', 'absent', 'late', 'excused'];
      if (!VALID.includes(status)) {
        return res.status(400).json({ error: `status must be one of: ${VALID.join(', ')}` });
      }

      const { rows } = await sql`
        INSERT INTO attendance (student_id, session_id, status, notes)
        VALUES (${student_id}, ${session_id}, ${status}, ${notes ?? null})
        ON CONFLICT (student_id, session_id) DO UPDATE
          SET status = EXCLUDED.status,
              notes  = EXCLUDED.notes
        RETURNING id, student_id, session_id, status, notes, created_at
      `;
      return res.status(201).json(rows[0]);
    }

    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id query param required' });
      await sql`DELETE FROM attendance WHERE id = ${id}`;
      return res.status(204).end();
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[/api/attendance]', err);
    return res.status(500).json({ error: err.message });
  }
}
