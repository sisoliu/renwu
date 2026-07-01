export async function onRequestPost({ request, env }) {
  try {
    const formData = await request.formData()
    const file = formData.get('file')
    const taskId = formData.get('taskId')

    if (!file || !taskId) {
      return Response.json({ error: 'Missing file or taskId' }, { status: 400 })
    }

    if (file.size > 10 * 1024 * 1024) {
      return Response.json({ error: 'File too large (max 10MB)' }, { status: 400 })
    }

    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm']
    if (!validTypes.includes(file.type)) {
      return Response.json({ error: 'Invalid file type' }, { status: 400 })
    }

    const ext = file.name.split('.').pop()
    const key = `tasks/${taskId}/${Date.now()}.${ext}`

    await env.MEDIA.put(key, file.stream(), {
      httpMetadata: { contentType: file.type }
    })

    const publicUrl = `${env.R2_PUBLIC_URL}/${key}`
    return Response.json({ url: publicUrl, success: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
