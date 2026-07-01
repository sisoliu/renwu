export async function onRequestPost({ request, env }) {
  try {
    const { fileUrl } = await request.json()
    if (!fileUrl) return Response.json({ ok: true })

    const url = new URL(fileUrl)
    const key = url.pathname.replace(/^\//, '')

    if (key) {
      await env.MEDIA.delete(key)
    }

    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
