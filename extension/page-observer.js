(() => {
  'use strict';
  const core = globalThis.XVCMedia;
  const cached = new Map();
  const CHANNEL = 'XVC_MEDIA_V1';
  function send(tweets) {
    if (tweets.length) window.postMessage({source: CHANNEL, type: 'media', tweets}, location.origin);
  }
  function inspect(body) {
    try {
      const tweets = core.extractTweets(body);
      for (const tweet of tweets) { cached.delete(tweet.id); cached.set(tweet.id, tweet); }
      while (cached.size > 500) cached.delete(cached.keys().next().value);
      send(tweets);
    } catch { /* Media observation must never interrupt X. */ }
  }
  function graphql(value) {
    try { const url = new URL(value, location.href); return url.origin === location.origin && /\/i\/api\/graphql\//.test(url.pathname); }
    catch { return false; }
  }
  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const promise = Reflect.apply(originalFetch, this, args);
    const url = typeof args[0] === 'string' || args[0] instanceof URL ? String(args[0]) : args[0]?.url;
    if (graphql(url)) promise.then(response => {
      if (response.ok) response.clone().json().then(inspect).catch(() => {});
    }).catch(() => {});
    return promise;
  };
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    const observed = graphql(url);
    if (observed) this.addEventListener('load', () => {
      try {
        if (this.status >= 200 && this.status < 300) inspect(this.responseType === 'json' ? this.response : JSON.parse(this.responseText));
      } catch { /* Other response types are irrelevant. */ }
    }, {once: true});
    return Reflect.apply(originalOpen, this, [method, url, ...rest]);
  };
  window.addEventListener('message', event => {
    if (event.source === window && event.origin === location.origin && event.data?.source === CHANNEL && event.data.type === 'request') {
      send([...cached.values()]);
    }
  });
})();
