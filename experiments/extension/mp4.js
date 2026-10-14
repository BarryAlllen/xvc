export const LIMIT = 25_000_000;
export const VIDEO_TYPE = 'web video/mp4';
export const MARKER_TYPE = 'web application/x-xvc-probe+json';

export function allowedSource(value) {
  const url = new URL(value);
  const allowed = (url.protocol === 'https:' &&
    ['video.twimg.com', 'interactive-examples.mdn.mozilla.net'].includes(url.hostname)) ||
    (url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port === '4173');
  if (!allowed || url.username || url.password) throw new Error('测试源只允许 X 视频 CDN、MDN 示例或 127.0.0.1:4173');
  return url.href;
}

export async function fetchMp4(source, signal, progress) {
  const response = await fetch(allowedSource(source), {signal, cache: 'no-store', credentials: 'omit', redirect: 'error'});
  if (!response.ok || !response.body) throw new Error(`网络请求失败：HTTP ${response.status}`);
  const length = Number(response.headers.get('content-length')) || null;
  if (length > LIMIT) {
    await response.body.cancel();
    throw new Error(`视频为 ${length} 字节，超过 25MB`);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      received += value.byteLength;
      progress(received, length);
      if (received > LIMIT) {
        await reader.cancel();
        throw new Error(`视频超过 25MB，已在 ${received} 字节停止`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!received) throw new Error('视频内容为空');
  if (length && received !== length) throw new Error('视频响应不完整');
  return new Blob(chunks, {type: 'video/mp4'});
}

export async function inspectMp4(blob) {
  const bytes = await blob.arrayBuffer();
  const view = new DataView(bytes);
  const boxes = [];
  let offset = 0;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) throw new Error('MP4 box 头不完整');
    let size = view.getUint32(offset);
    const type = String.fromCharCode(...new Uint8Array(bytes, offset + 4, 4));
    let header = 8;
    if (size === 1) {
      if (offset + 16 > bytes.byteLength) throw new Error('MP4 扩展 box 头不完整');
      const extended = view.getBigUint64(offset + 8);
      if (extended > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('MP4 box 长度异常');
      size = Number(extended);
      header = 16;
    } else if (size === 0) size = bytes.byteLength - offset;
    if (size < header || offset + size > bytes.byteLength) throw new Error('MP4 box 长度不完整');
    boxes.push({type, size});
    offset += size;
  }
  if (!boxes.some(b => b.type === 'ftyp' && b.size >= 16) ||
      !boxes.some(b => b.type === 'moov') || !boxes.some(b => b.type === 'mdat')) {
    throw new Error('不是包含 ftyp、moov 和 mdat 的完整 MP4');
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('');
  return {bytes: blob.size, sha256, boxes};
}

export function inspectPlayback(blob) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const objectUrl = URL.createObjectURL(blob);
    const finish = (error) => {
      clearTimeout(timer);
      const result = {width: video.videoWidth, height: video.videoHeight, duration: video.duration};
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(objectUrl);
      if (error) reject(error); else resolve(result);
    };
    const timer = setTimeout(() => finish(new Error('视频元数据读取超时')), 10000);
    video.onloadedmetadata = () => {
      if (!video.videoWidth || !Number.isFinite(video.duration) || video.duration <= 0) finish(new Error('MP4 无有效视频轨道'));
      else finish();
    };
    video.onerror = () => finish(new Error('浏览器无法读取视频轨道'));
    video.preload = 'metadata';
    video.src = objectUrl;
  });
}
