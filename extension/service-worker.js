import './media-core.js';

const HOST = 'com.xvc.native';
const jobs = new Map();
const UPGRADE = '请先运行 v0.2.0 或更新版本的安装脚本，升级 XVC 本地程序。';
const compatible = value => value?.protocolVersion === 2 && value.settings && typeof value.cacheDirectory === 'string';
const settingsTypes = {XVC_GET_SETTINGS: 'ping', XVC_PING: 'ping', XVC_SAVE_SETTINGS: 'updateSettings', XVC_SET_DIRECTORY: 'setDirectory', XVC_OPEN_CACHE: 'openCache', XVC_RESET_SETTINGS: 'resetSettings'};
function nativeRequest(message) {
  return new Promise(resolve => {
    let port, done = false;
    const timer = setTimeout(() => finish({ok: false, message: '本地程序响应超时，请重试。'}), 5000);
    function finish(result) { if (done) return; done = true; clearTimeout(timer); resolve(result); port?.disconnect(); }
    try {
      port = chrome.runtime.connectNative(HOST);
      port.onMessage.addListener(value => {
        if (value?.type === 'error') finish({ok: false, code: value.code, message: value.message});
        else if (['ready', 'settings'].includes(value?.type)) finish(compatible(value) ? value : {ok: false, code: 'UPGRADE', version: value.version, message: UPGRADE});
      });
      port.onDisconnect.addListener(() => { const error = chrome.runtime.lastError; finish({ok: false, message: friendlyError(error)}); });
      port.postMessage(message);
    } catch (error) { finish({ok: false, message: friendlyError(error)}); }
  });
}
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
  if (old) { old.done = true; clearTimeout(old.timer); old.port.postMessage({type: 'cancel', jobId: old.jobId}); old.port.disconnect(); }
  const port = chrome.runtime.connectNative(HOST);
  const job = {port, jobId, done: false, started: false};
  const timer = setTimeout(() => rejectStart('本地程序响应超时，请重试。'), 5000);
  job.timer = timer;
  function rejectStart(message, code) {
    if (job.done) return;
    job.done = true; clearTimeout(timer);
    if (jobs.get(tabId) === job) jobs.delete(tabId);
    respond({ok: false, message, code}); port.disconnect();
  }
  jobs.set(tabId, job);
  port.onMessage.addListener(message => {
    if (job.done) return;
    if (!job.started) {
      if (message?.type === 'ready') {
        if (!compatible(message)) { rejectStart(UPGRADE, 'UPGRADE'); return; }
        job.started = true; clearTimeout(timer);
        port.postMessage({type: 'copy', jobId, urls}); respond({ok: true});
      } else if (message?.type === 'error') rejectStart(message.message, message.code);
      return;
    }
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
    if (!job.started) { rejectStart(friendlyError(error)); return; }
    if (!job.done) {
      job.done = true;
      if (jobs.get(tabId) === job) jobs.delete(tabId);
      post(tabId, {type: 'error', jobId, code: 'HOST_DISCONNECTED', message: friendlyError(error)});
    }
  });
  port.postMessage({type: 'ping', keepAlive: true});
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (settingsTypes[message?.type]) {
    if (sender.url !== chrome.runtime.getURL('popup.html')) return;
    const native = {type: settingsTypes[message.type]};
    if (message.type === 'XVC_SAVE_SETTINGS') {
      if (!message.patch || typeof message.patch !== 'object' || Array.isArray(message.patch) || Object.keys(message.patch).some(key => !['maxMB', 'unlimited', 'keepCache'].includes(key))) {
        respond({ok: false, message: '设置参数无效。'}); return;
      }
      native.patch = message.patch;
    }
    if (message.type === 'XVC_SET_DIRECTORY') native.directory = message.directory;
    nativeRequest(native).then(respond);
    return true;
  }
  if (!isX(sender) || !sender.tab?.id) return;
  if (message?.type === 'XVC_OPEN_SETTINGS') {
    chrome.runtime.openOptionsPage().then(() => respond({ok: true}), () => respond({ok: false}));
    return true;
  }
  if (message?.type === 'XVC_START') {
    const urls = [...new Set((Array.isArray(message.urls) ? message.urls : []).slice(0, 10).map(XVCMedia.mp4URL).filter(Boolean))];
    if (!/^[a-f0-9-]{36}$/i.test(message.jobId || '') || !urls.length) { respond({ok: false, message: '没有找到这条视频的完整 MP4 地址。请刷新 X 后重试。'}); return; }
    try { connect({jobId: message.jobId, urls, tabId: sender.tab.id}, respond); }
    catch (error) { respond({ok: false, message: friendlyError(error)}); }
    return true;
  } else if (message?.type === 'XVC_CANCEL') {
    const job = jobs.get(sender.tab.id);
    if (job?.jobId === message.jobId) job.port.postMessage({type: 'cancel', jobId: job.jobId});
    respond({ok: true});
  }
});
chrome.tabs.onRemoved.addListener(tabId => {
  const job = jobs.get(tabId);
  if (job) { job.done = true; clearTimeout(job.timer); job.port.disconnect(); jobs.delete(tabId); }
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  const job = jobs.get(tabId);
  if (job && change.status === 'loading') {
    job.done = true; clearTimeout(job.timer); job.port.disconnect(); jobs.delete(tabId);
  }
});
