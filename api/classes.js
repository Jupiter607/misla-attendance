import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const { rows } = await sql`
        SELECT id, name, description, created_at
        FROM classes
        ORDER BY created_at ASC
      `;
      return res.status(200).json(rows);
    }

    if (req.method === 'POST') {
      const { name, description } = req.body ?? {};
      if (!name?.trim()) {
        return res.status(400).json({ error: 'name is required' });
      }
      const { rows } = await sql`
        INSERT INTO classes (name, description)
        VALUES (${name.trim()}, ${description ?? null})
        ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description
        RETURNING id, name, description, created_at
      `;
      return res.status(201).json(rows[0]);
    }

    if (req.method === 'PATCH') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id query param required' });
      const { name, description } = req.body ?? {};
      if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
      const { rows } = await sql`
        UPDATE classes SET name = ${name.trim()}, description = COALESCE(${description ?? null}, description)
        WHERE id = ${id}
        RETURNING id, name, description, created_at
      `;
      if (!rows.length) return res.status(404).json({ error: 'Class not found' });
      return res.status(200).json(rows[0]);
    }

    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id query param required' });
      await sql`DELETE FROM classes WHERE id = ${id}`;
      return res.status(204).end();
    }

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[/api/classes]', err);
    return res.status(500).json({ error: err.message });
  }
}
