(() => {
  'use strict';
  if (globalThis.XVCMedia) return;
  const LIMIT = 25_000_000;
  function mp4URL(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname === 'video.twimg.com' &&
        (!url.port || url.port === '443') && !url.username && !url.password &&
        /\.mp4$/i.test(url.pathname) ? url.href : null;
    } catch { return null; }
  }
  function posterKey(value) {
    try {
      const url = new URL(value);
      return url.origin + url.pathname.replace(/\.(jpe?g|png|webp)$/i, '');
    } catch { return ''; }
  }
  function mediaID(value) {
    return String(value || '').match(/\/(?:ext_tw_video(?:_thumb)?|amplify_video(?:_thumb)?)\/(\d+)\//)?.[1] || '';
  }
  function sanitizeMedia(media) {
    if (!media || !Array.isArray(media.variants)) return null;
    const variants = media.variants.slice(0, 20).map(v => ({url: mp4URL(v?.url), bitrate: Number(v?.bitrate) || 0}))
      .filter(v => v.url).sort((a, b) => b.bitrate - a.bitrate);
    if (!variants.length) return null;
    return {id: String(media.id || '').slice(0, 100), poster: String(media.poster || '').slice(0, 2048), variants};
  }
  function extractTweets(root) {
    const result = new Map();
    const queue = [root];
    const visited = new WeakSet();
    for (let index = 0; index < queue.length && index < 60_000; index++) {
      const node = queue[index];
      if (!node || typeof node !== 'object' || visited.has(node)) continue;
      visited.add(node);
      const legacy = node.legacy;
      const id = String(node.rest_id || legacy?.id_str || '');
      const entries = legacy?.extended_entities?.media || legacy?.entities?.media;
      if (/^\d+$/.test(id) && Array.isArray(entries)) {
        const media = entries.filter(m => ['video', 'animated_gif'].includes(m.type)).map(m => sanitizeMedia({
          id: m.media_key || m.id_str, poster: m.media_url_https || m.media_url,
          variants: (m.video_info?.variants || []).filter(v => v.content_type === 'video/mp4')
        })).filter(Boolean);
        if (media.length) result.set(id, {id, media});
      }
      for (const value of Object.values(node)) if (value && typeof value === 'object') queue.push(value);
    }
    return [...result.values()];
  }
  function selectVideo(tweets, {poster, source, tweetId, videoCount = 1}) {
    const direct = mp4URL(source);
    if (direct) return [direct];
    const all = tweets.flatMap(t => t.media || []);
    const key = posterKey(poster);
    const id = mediaID(poster);
    const exact = all.filter(m => (key && posterKey(m.poster) === key) ||
      (id && m.variants.some(v => mediaID(v.url) === id)));
    let chosen;
    if (exact.length) {
      const groups = new Map(exact.map(m => [m.variants.map(v => v.url).join('|'), m]));
      if (groups.size === 1) chosen = groups.values().next().value;
    }
    if (!chosen && !exact.length && !poster && videoCount === 1) {
      const tweet = tweets.find(t => t.id === tweetId);
      if (tweet?.media?.length === 1) chosen = tweet.media[0];
    }
    return chosen ? [...new Set(chosen.variants.map(v => mp4URL(v.url)).filter(Boolean))] : [];
  }
  globalThis.XVCMedia = Object.freeze({LIMIT, mp4URL, posterKey, mediaID, sanitizeMedia, extractTweets, selectVideo});
})();
