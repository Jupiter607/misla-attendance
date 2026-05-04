import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const { class_id } = req.query;
      const { rows } = class_id
        ? await sql`
            SELECT id, class_id, session_date, label, locked, created_at
            FROM sessions WHERE class_id = ${class_id}
            ORDER BY session_date ASC`
        : await sql`
            SELECT id, class_id, session_date, label, locked, created_at
            FROM sessions ORDER BY session_date ASC`;
      return res.status(200).json(rows);
    }

    if (req.method === 'POST') {
      const { session_date, label, class_id } = req.body ?? {};
      if (!session_date) {
        return res.status(400).json({ error: 'session_date is required (YYYY-MM-DD)' });
      }
      if (!class_id) {
        return res.status(400).json({ error: 'class_id is required' });
      }
      const { rows } = await sql`
        INSERT INTO sessions (class_id, session_date, label)
        VALUES (${class_id}, ${session_date}, ${label ?? null})
        ON CONFLICT (class_id, session_date) DO UPDATE SET label = EXCLUDED.label
        RETURNING id, class_id, session_date, label, locked, created_at
      `;
      return res.status(201).json(rows[0]);
    }

    if (req.method === 'PATCH') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id query param required' });
      const body = req.body ?? {};
      const hasLabel  = Object.prototype.hasOwnProperty.call(body, 'label');
      const hasLocked = Object.prototype.hasOwnProperty.call(body, 'locked');
      if (!hasLabel && !hasLocked) {
        return res.status(400).json({ error: 'Provide at least one of: label, locked' });
      }

      // Tagged-template SQL doesn't support dynamic SET lists, so branch instead.
      let rows;
      if (hasLabel && hasLocked) {
        ({ rows } = await sql`
          UPDATE sessions
             SET label  = ${body.label ?? null},
                 locked = ${!!body.locked}
           WHERE id = ${id}
       RETURNING id, class_id, session_date, label, locked, created_at
        `);
      } else if (hasLocked) {
        ({ rows } = await sql`
          UPDATE sessions
             SET locked = ${!!body.locked}
           WHERE id = ${id}
       RETURNING id, class_id, session_date, label, locked, created_at
        `);
      } else {
        ({ rows } = await sql`
          UPDATE sessions
             SET label = ${body.label ?? null}
           WHERE id = ${id}
       RETURNING id, class_id, session_date, label, locked, created_at
        `);
      }
      if (!rows.length) return res.status(404).json({ error: 'Session not found' });
      return res.status(200).json(rows[0]);
    }

    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id query param required' });

      // Refuse to delete a locked session — instructor must unlock first.
      const { rows: sess } = await sql`SELECT locked FROM sessions WHERE id = ${id}`;
      if (sess.length && sess[0].locked) {
        return res.status(423).json({ error: 'Session is locked. Unlock before deleting.' });
      }

      await sql`DELETE FROM sessions WHERE id = ${id}`;
      return res.status(204).end();
    }

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[/api/sessions]', err);
    return res.status(500).json({ error: err.message });
  }
}
