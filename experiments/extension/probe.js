import {LIMIT, VIDEO_TYPE, MARKER_TYPE, fetchMp4, inspectMp4, inspectPlayback} from './mp4.js';

const $ = id => document.getElementById(id);
const state = {
  stage: 'idle', limit: LIMIT, userAgent: navigator.userAgent,
  secureContext: isSecureContext, extension: Boolean(globalThis.chrome?.runtime?.id),
  supported: typeof ClipboardItem !== 'undefined' && typeof ClipboardItem.supports === 'function'
    ? {mp4: ClipboardItem.supports('video/mp4'), customMp4: ClipboardItem.supports(VIDEO_TYPE)} : null,
  received: 0, prepared: null, lastWrite: null, verification: null, error: null, attemptedWriteType: null
};
let ready = null;
let controller = null;
let previewUrl = null;
let lastPaint = 0;

function render(stage, text) {
  const busy = ['fetching', 'validating', 'writing', 'verifying'].includes(stage);
  state.stage = stage;
  $('status').dataset.stage = stage;
  $('status').textContent = text;
  $('state').textContent = JSON.stringify(state, null, 2);
  $('write').disabled = !ready || busy;
  $('copy-file-event').disabled = !ready || busy;
  $('release').disabled = !ready || busy;
  $('copy').disabled = busy;
  $('verify').disabled = busy;
  $('cancel').disabled = !controller;
}
function clearPreview() {
  $('preview').pause();
  $('preview').removeAttribute('src');
  $('preview').load();
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
}
function fail(error) {
  state.error = {name: error.name, message: error.message};
  render('error', error.name === 'AbortError' ? '已取消' : error.message);
}
async function writeReady() {
  if (!ready) throw new Error('没有准备好的视频');
  if (!document.hasFocus()) {
    render('ready', '视频已准备好，请回到此页点击“写入已准备的视频”');
    return;
  }
  const type = $('format').value;
  state.attemptedWriteType = type;
  const marker = {product: 'XVC_PROTOTYPE', jobId: crypto.randomUUID(), ...state.prepared};
  const item = new ClipboardItem({
    [type]: ready,
    [MARKER_TYPE]: new Blob([JSON.stringify(marker)], {type: 'application/x-xvc-probe+json'})
  });
  render('writing', '正在写入系统剪贴板…');
  await navigator.clipboard.write([item]);
  state.lastWrite = marker;
  state.error = null;
  render('written', type === VIDEO_TYPE
    ? '浏览器自定义 MP4 数据已写入；不是标准视频或文件剪贴板条目'
    : '视频类型写入返回成功；仍需独立检查系统类型和实际粘贴');
}

$('copy').addEventListener('click', async () => {
  clearPreview();
  ready = null;
  controller = new AbortController();
  state.prepared = null;
  state.verification = null;
  state.error = null;
  state.received = 0;
  render('fetching', '正在读取网络视频…');
  try {
    const blob = await fetchMp4($('source').value, controller.signal, (bytes, total) => {
      state.received = bytes;
      if (performance.now() - lastPaint > 150) {
        lastPaint = performance.now();
        render('fetching', `已读取 ${bytes.toLocaleString()}${total ? ` / ${total.toLocaleString()}` : ''} 字节`);
      }
    });
    render('validating', '正在检查 MP4 结构与视频轨道…');
    const inspection = await inspectMp4(blob);
    const playback = await inspectPlayback(blob);
    if (controller.signal.aborted) throw new DOMException('用户取消', 'AbortError');
    ready = blob;
    state.prepared = {...inspection, playback};
    previewUrl = URL.createObjectURL(blob);
    $('preview').src = previewUrl;
    controller = null;
    await writeReady();
  } catch (error) {
    controller = null;
    fail(error);
  }
});
$('cancel').addEventListener('click', () => controller?.abort());
$('write').addEventListener('click', () => writeReady().catch(fail));
$('copy-file-event').addEventListener('click', () => {
  if (!ready) return;
  const result = {eventFired: false, fileAdded: false, execCommandReturned: false};
  const handler = event => {
    event.preventDefault();
    result.eventFired = true;
    result.trustedEvent = event.isTrusted;
    try {
      const item = event.clipboardData.items.add(new File([ready], 'xvc-probe.mp4', {type: 'video/mp4'}));
      result.fileAdded = Boolean(item);
      result.items = Array.from(event.clipboardData.items, item => ({kind: item.kind, type: item.type}));
    } catch (error) { result.error = {name: error.name, message: error.message}; }
  };
  document.addEventListener('copy', handler, {once: true});
  try { result.execCommandReturned = document.execCommand('copy'); }
  finally { document.removeEventListener('copy', handler); }
  state.copyEvent = result;
  render('event-attempted', 'File 复制事件已探测；返回 true 不代表系统接受了文件，需独立检查');
});
$('release').addEventListener('click', () => {
  clearPreview();
  ready = null;
  render('released', '已释放源视频和预览引用；剪贴板中的数据由浏览器和系统管理');
});
$('verify').addEventListener('click', async () => {
  state.error = null;
  state.verification = null;
  render('verifying', '正在读回本原型写入的 MP4…');
  try {
    const items = await navigator.clipboard.read();
    const item = items.find(x => x.types.includes(MARKER_TYPE) && x.types.includes(VIDEO_TYPE));
    if (!item) throw new Error('当前剪贴板没有本原型的视频标记，未读取其他内容');
    const marker = JSON.parse(await (await item.getType(MARKER_TYPE)).text());
    if (marker.product !== 'XVC_PROTOTYPE' || typeof marker.sha256 !== 'string' || !marker.jobId) {
      throw new Error('不是可识别的 XVC 原型数据');
    }
    if (state.lastWrite && marker.jobId !== state.lastWrite.jobId) throw new Error('剪贴板已被其他任务替换');
    const raw = await item.getType(VIDEO_TYPE);
    const blob = raw.slice(0, raw.size, 'video/mp4');
    const inspection = await inspectMp4(blob);
    if (inspection.bytes !== marker.bytes || inspection.sha256 !== marker.sha256) throw new Error('读回字节与写入前不一致');
    const playback = await inspectPlayback(blob);
    clearPreview();
    previewUrl = URL.createObjectURL(blob);
    $('preview').src = previewUrl;
    state.verification = {
      ok: true, jobId: marker.jobId, clipboardTypes: item.types,
      ...inspection, playback, sourceReleased: ready === null, time: new Date().toISOString()
    };
    render('verified', '自定义数据校验通过：长度、SHA-256 一致；不代表标准视频文件复制成功');
  } catch (error) { fail(error); }
});
for (const button of document.querySelectorAll('[data-fixture]')) {
  button.addEventListener('click', () => { $('source').value = `http://127.0.0.1:4173/fixtures/${button.dataset.fixture}`; });
}
const source = new URL(location.href).searchParams.get('source');
if (source) $('source').value = source;
render('idle', state.extension ? '准备就绪（扩展上下文）' : '准备就绪（普通网页上下文；权限由浏览器询问）');
