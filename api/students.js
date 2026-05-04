import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const { class_id } = req.query;
      const { rows } = class_id
        ? await sql`
            SELECT id, class_id, full_name, created_at
            FROM students WHERE class_id = ${class_id}
            ORDER BY full_name ASC`
        : await sql`
            SELECT id, class_id, full_name, created_at
            FROM students ORDER BY full_name ASC`;
      return res.status(200).json(rows);
    }

    if (req.method === 'POST') {
      const { full_name, class_id } = req.body ?? {};
      if (!full_name?.trim()) {
        return res.status(400).json({ error: 'full_name is required' });
      }
      const { rows } = await sql`
        INSERT INTO students (class_id, full_name)
        VALUES (${class_id ?? null}, ${full_name.trim()})
        ON CONFLICT (class_id, full_name) DO UPDATE SET full_name = EXCLUDED.full_name
        RETURNING id, class_id, full_name, created_at
      `;
      return res.status(201).json(rows[0]);
    }

    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id query param required' });
      await sql`DELETE FROM students WHERE id = ${id}`;
      return res.status(204).end();
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[/api/students]', err);
    return res.status(500).json({ error: err.message });
  }
}
