let source = '/fixtures/slow.mp4';
let bridgeJob = null;
const listeners = [];
document.getElementById('normal').onclick = () => { source = '/fixtures/slow.mp4'; document.getElementById('mode').textContent = '当前：4 MB 慢速下载，便于检查真实进度。'; };
document.getElementById('large').onclick = () => { source = '/fixtures/over-limit.mp4'; document.getElementById('mode').textContent = '当前：25 MB + 1 字节，应被拒绝并清除上次缓存。'; };
document.getElementById('quick').onclick = () => { source = '/fixtures/sample.mp4'; document.getElementById('mode').textContent = '当前：43 KB 快速完成，检查成功终态。'; };
window.chrome = {runtime: {
  onMessage: {addListener: fn => listeners.push(fn)},
  async sendMessage(message) {
    if (message.type === 'XVC_CANCEL') { if (bridgeJob) await fetch('/bridge/cancel?id=' + bridgeJob, {method: 'POST'}); return {ok: true}; }
    if (message.type !== 'XVC_START') return;
    const response = await fetch('/bridge/start?url=' + encodeURIComponent(location.origin + source), {method: 'POST'});
    bridgeJob = (await response.json()).jobId;
    const current = bridgeJob;
    let offset = 0;
    const timer = setInterval(async () => {
      const events = await (await fetch('/bridge/events?id=' + current)).json();
      for (const event of events.slice(offset)) {
        const log = document.getElementById('log');
        log.textContent = (log.textContent + JSON.stringify(event) + '\n').slice(-2200);
        for (const fn of listeners) fn({...event, source: 'XVC', jobId: message.jobId});
        if (event.type === 'success' || event.type === 'error') clearInterval(timer);
      }
      offset = events.length;
    }, 150);
    return {ok: true};
  }
}};
// Use a permitted-looking source solely to exercise the content UI; the local test adapter downloads only fixed synthetic fixtures.
document.querySelector('video').addEventListener('loadedmetadata', () => {});
const original = globalThis.XVCMedia;
globalThis.XVCMedia = {...original, selectVideo: () => ['https://video.twimg.com/ext_tw_video/1/pu/vid/test.mp4']};
