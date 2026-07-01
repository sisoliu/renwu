export async function onRequestGet({ request, env }) {
  const url = new URL(request.url)
  const date = url.searchParams.get('date')
  const id = url.searchParams.get('id')
  const select = url.searchParams.get('select')

  let query = 'SELECT * FROM tasks'
  const params = []
  const conditions = []

  if (id) {
    conditions.push('id = ?')
    params.push(id)
  }
  if (date) {
    conditions.push('date = ?')
    params.push(date)
  }

  if (conditions.length) {
    query += ' WHERE ' + conditions.join(' AND ')
  }
  query += ' ORDER BY created_at DESC'

  const { results } = await env.DB.prepare(query).bind(...params).all()
  return Response.json(results)
}

export async function onRequestPost({ request, env }) {
  const body = await request.json()
  const { id, date, task_text, completed, repeat_type, parent_id, media_url, media_type, created_at } = body

  await env.DB.prepare(`
    INSERT INTO tasks (id, date, task_text, completed, repeat_type, parent_id, media_url, media_type, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, date, task_text,
    completed ? 1 : 0,
    repeat_type || 'once',
    parent_id || null,
    media_url || null,
    media_type || null,
    created_at || new Date().toISOString()
  ).run()

  return Response.json({ ok: true })
}

export async function onRequestPatch({ request, env }) {
  const url = new URL(request.url)
  const id = url.searchParams.get('id')
  if (!id) return Response.json({ error: 'Missing id' }, { status: 400 })

  const body = await request.json()
  const fields = []
  const params = []

  if (body.completed !== undefined) { fields.push('completed = ?'); params.push(body.completed ? 1 : 0) }
  if (body.media_url !== undefined) { fields.push('media_url = ?'); params.push(body.media_url) }
  if (body.media_type !== undefined) { fields.push('media_type = ?'); params.push(body.media_type) }
  if (body.task_text !== undefined) { fields.push('task_text = ?'); params.push(body.task_text) }
  if (body.date !== undefined) { fields.push('date = ?'); params.push(body.date) }
  if (body.repeat_type !== undefined) { fields.push('repeat_type = ?'); params.push(body.repeat_type) }
  if (body.parent_id !== undefined) { fields.push('parent_id = ?'); params.push(body.parent_id) }

  if (!fields.length) return Response.json({ ok: true })

  params.push(id)
  await env.DB.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).bind(...params).run()
  return Response.json({ ok: true })
}

export async function onRequestDELETE({ request, env }) {
  const url = new URL(request.url)
  const id = url.searchParams.get('id')
  if (!id) return Response.json({ error: 'Missing id' }, { status: 400 })

  await env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(id).run()
  return Response.json({ ok: true })
}