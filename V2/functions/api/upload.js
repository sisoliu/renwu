export async function onRequestPost({ request, env }) {
  try {
    const fd = await request.formData();
    const files = fd.getAll('file');
    const taskId = fd.get('taskId');

    if (!files.length || !taskId) {
      return Response.json({ error: 'Missing file or taskId' }, { status: 400 });
    }

    const results = [];

    for (const file of files) {
      if (file.size > 10 * 1024 * 1024) continue;
      const ext = file.name.split('.').pop();
      const key = `tasks/${taskId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

      await env.MEDIA.put(key, file.stream(), {
        httpMetadata: { contentType: file.type }
      });

      results.push({
        url: `${env.R2_PUBLIC_URL}/${key}`,
        type: file.type.startsWith('video') ? 'video' : 'image'
      });
    }

    return Response.json({ success: true, files: results });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
