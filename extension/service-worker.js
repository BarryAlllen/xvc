import './media-core.js';

const HOST = 'com.xvc.native';
const jobs = new Map();
function isX(sender) {
  try { const u = new URL(sender.url); return u.protocol === 'https:' && ['x.com', 'twitter.com'].includes(u.hostname) && sender.frameId === 0; }
  catch { return false; }
}
function post(tabId, message) { return chrome.tabs.sendMessage(tabId, {source: 'XVC', ...message}).catch(() => {}); }
function friendlyError(error) {
  const message = error?.message || String(error || '');
  if (/not found|forbidden|failed to start/i.test(message)) return '尚未连接 XVC 本地程序。请先运行安装脚本，再重试。';
  return '本地程序连接中断，未确认复制成功。请检查安装后重试。';
}
function connect({jobId, urls, tabId}, respond) {
  const old = jobs.get(tabId);
  if (old) { old.port.postMessage({type: 'cancel', jobId: old.jobId}); old.port.disconnect(); }
  const port = chrome.runtime.connectNative(HOST);
  const job = {port, jobId, done: false};
  jobs.set(tabId, job);
  port.onMessage.addListener(message => {
    if (message?.jobId !== jobId || job.done) return;
    if (!['progress', 'success', 'error'].includes(message.type)) return;
    if (message.type === 'success' && (message.clipboardType !== 'public.file-url' || message.verified !== true)) {
      message = {type: 'error', jobId, code: 'UNVERIFIED', message: '文件已下载，但未确认剪贴板写入，不能报告复制成功。'};
    }
    if (message.type !== 'progress') {
      job.done = true;
      if (jobs.get(tabId) === job) jobs.delete(tabId);
      post(tabId, message).finally(() => port.disconnect());
    } else post(tabId, message);
  });
  port.onDisconnect.addListener(() => {
    const error = chrome.runtime.lastError;
    if (!job.done) {
      job.done = true;
      if (jobs.get(tabId) === job) jobs.delete(tabId);
      post(tabId, {type: 'error', jobId, code: 'HOST_DISCONNECTED', message: friendlyError(error)});
    }
  });
  port.postMessage({type: 'copy', jobId, urls});
  respond({ok: true});
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === 'XVC_PING' && sender.url === chrome.runtime.getURL('popup.html')) {
    const port = chrome.runtime.connectNative(HOST);
    let done = false;
    const timer = setTimeout(() => finish({ok: false, message: '连接超时，请重新安装本地程序。'}), 5000);
    function finish(result) { if (done) return; done = true; clearTimeout(timer); respond(result); port.disconnect(); }
    port.onMessage.addListener(value => { if (value?.type === 'ready') finish({ok: true, version: value.version}); });
    port.onDisconnect.addListener(() => { const error = chrome.runtime.lastError; finish({ok: false, message: friendlyError(error)}); });
    port.postMessage({type: 'ping'});
    return true;
  }
  if (!isX(sender) || !sender.tab?.id) return;
  if (message?.type === 'XVC_START') {
    const urls = [...new Set((Array.isArray(message.urls) ? message.urls : []).slice(0, 10).map(XVCMedia.mp4URL).filter(Boolean))];
    if (!/^[a-f0-9-]{36}$/i.test(message.jobId || '') || !urls.length) { respond({ok: false, message: '没有找到这条视频的完整 MP4 地址。请刷新 X 后重试。'}); return; }
    try { connect({jobId: message.jobId, urls, tabId: sender.tab.id}, respond); }
    catch (error) { respond({ok: false, message: friendlyError(error)}); }
  } else if (message?.type === 'XVC_CANCEL') {
    const job = jobs.get(sender.tab.id);
    if (job?.jobId === message.jobId) job.port.postMessage({type: 'cancel', jobId: job.jobId});
    respond({ok: true});
  }
});
chrome.tabs.onRemoved.addListener(tabId => {
  const job = jobs.get(tabId);
  if (job) { job.done = true; job.port.disconnect(); jobs.delete(tabId); }
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  const job = jobs.get(tabId);
  if (job && change.status === 'loading') {
    job.done = true; job.port.disconnect(); jobs.delete(tabId);
  }
});
