function getMimeType(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const mimeMap = {
    // 视频
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    avi: 'video/x-msvideo',
    mkv: 'video/x-matroska',
    webm: 'video/webm',
    // 图片
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp'
  };
  return mimeMap[ext] || 'application/octet-stream';
}
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
      // ✅ 放宽到 50MB（Cloudflare Free 单请求 100MB）
      if (file.size > 50 * 1024 * 1024) continue;

      const ext = file.name.split('.').pop();
      const key = `tasks/${taskId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

      await env.MEDIA.put(key, file.stream(), {
        httpMetadata: { 
          contentType: getMimeType(file.name) 
        }
      });

      // ✅ 安全推导 media_type（不依赖 file.type）
      let mediaType = 'file';
      if (file.type?.startsWith('image/')) {
        mediaType = 'image';
      } else if (file.type?.startsWith('video/')) {
        mediaType = 'video';
      } else if (file.name?.match(/\.(mp4|mov|avi|mkv|webm)$/i)) {
        mediaType = 'video';
      } else if (file.name?.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
        mediaType = 'image';
      }

      results.push({
        url: `${env.R2_PUBLIC_URL}/${key}`,
        type: mediaType // ✅ 一定是 'image' | 'video' | 'file'
      });
    }

    return Response.json({ success: true, files: results });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
