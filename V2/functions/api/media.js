export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const taskId = url.searchParams.get('task_id');
  if (!taskId) return Response.json([]);

  const { results } = await env.DB.prepare(
    'SELECT * FROM task_media WHERE task_id = ? ORDER BY created_at ASC'
  ).bind(taskId).all();

  return Response.json(results);
}

export async function onRequestPost({ request, env }) {
  const { task_id, media_url, media_type } = await request.json();
  const id = crypto.randomUUID();

  await env.DB.prepare(
    'INSERT INTO task_media (id, task_id, media_url, media_type) VALUES (?,?,?,?)'
  ).bind(id, task_id, media_url, media_type).run();

  return Response.json({ ok: true });
}

export async function onRequestDelete({ request, env }) {
  const { id, url } = await request.json();

  try {
    const key = new URL(url).pathname.replace(/^\//, '');
    await env.MEDIA.delete(key);
  } catch {}

  await env.DB.prepare('DELETE FROM task_media WHERE id = ?').bind(id).run();
  return Response.json({ ok: true });
}
