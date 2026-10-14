const $ = id => document.getElementById(id);
const controls = ['size', 'unlimited', 'keep-cache', 'open-cache', 'pick-directory', 'reset'];
let current, pending = false;
let feedbackTimer;
$('version').textContent = 'v' + chrome.runtime.getManifest().version;
function feedback(text, state = '') {
  clearTimeout(feedbackTimer);
  $('feedback').textContent = text; $('feedback').dataset.state = state;
  if (state === 'saved') feedbackTimer = setTimeout(() => feedback('更改后自动保存'), 2500);
}
function render() {
  controls.forEach(id => { $(id).disabled = pending || !current; });
  $('directory-form').querySelectorAll('input,button').forEach(element => { element.disabled = pending || !current; });
  if (!current) return;
  const {settings, cacheDirectory} = current;
  $('size').value = settings.maxMB;
  $('size').style.setProperty('--fill', `${(settings.maxMB - 1) / 499 * 100}%`);
  $('size-value').textContent = settings.unlimited ? '无限制' : `${settings.maxMB} MB`;
  $('unlimited').checked = settings.unlimited;
  $('keep-cache').checked = settings.keepCache;
  $('size').disabled = pending || settings.unlimited;
  $('slider-area').classList.toggle('disabled', settings.unlimited);
  $('cache-hint').textContent = settings.keepCache ? '已下载的视频会继续保留' : '关闭时，新下载会清理旧视频';
  $('directory').textContent = cacheDirectory;
  $('directory').title = cacheDirectory;
}
async function call(type, patch, directory) {
  const result = await chrome.runtime.sendMessage({type, ...(patch ? {patch} : {}), ...(directory ? {directory} : {})});
  if (!result?.ok) throw new Error(result?.message || '操作未完成，请重试。');
  return result;
}
async function check() {
  if (pending) return;
  pending = true; render(); $('check').disabled = true;
  $('status').textContent = '正在连接本地程序…'; delete $('dot').dataset.ok;
  try {
    current = await call('XVC_GET_SETTINGS');
    $('status').textContent = `本地程序已连接 · v${current.version}`;
    $('dot').dataset.ok = 'true'; $('notice').hidden = true;
  } catch (error) {
    current = null; $('status').textContent = '本地程序未就绪'; $('dot').dataset.ok = 'false';
    $('notice').textContent = error.message; $('notice').hidden = false;
  } finally { pending = false; $('check').disabled = false; render(); }
}
async function perform(type, {patch, directory, button, success = '已保存'} = {}) {
  if (pending || !current) return;
  const previous = current;
  if (patch) current = {...current, settings: {...current.settings, ...patch}};
  pending = true; render(); $('check').disabled = true;
  if (button) button.dataset.busy = 'true';
  feedback('正在处理…');
  try {
    const result = await call(type, patch, directory);
    current = result; $('notice').hidden = true;
    if (type === 'XVC_SET_DIRECTORY' || type === 'XVC_RESET_SETTINGS') $('directory-form').hidden = true;
    feedback(result.cancelled ? '已取消更改' : success, result.cancelled ? '' : 'saved');
  } catch (error) { current = previous; feedback('操作未完成', 'error'); $('notice').textContent = error.message; $('notice').hidden = false; }
  finally { pending = false; if (button) delete button.dataset.busy; $('check').disabled = false; render(); }
}
$('size').addEventListener('input', () => {
  $('size-value').textContent = `${$('size').value} MB`;
  $('size').style.setProperty('--fill', `${($('size').value - 1) / 499 * 100}%`);
});
$('size').addEventListener('change', () => perform('XVC_SAVE_SETTINGS', {patch: {maxMB: Number($('size').value)}}));
$('unlimited').addEventListener('change', () => perform('XVC_SAVE_SETTINGS', {patch: {unlimited: $('unlimited').checked}}));
$('keep-cache').addEventListener('change', () => perform('XVC_SAVE_SETTINGS', {patch: {keepCache: $('keep-cache').checked}}));
$('open-cache').onclick = () => perform('XVC_OPEN_CACHE', {button: $('open-cache'), success: '已打开缓存目录'});
$('pick-directory').onclick = () => {
  $('directory-form').hidden = !$('directory-form').hidden;
  if (!$('directory-form').hidden) { $('directory-input').value = ''; $('directory-input').focus(); }
};
$('cancel-directory').onclick = () => { $('directory-form').hidden = true; };
$('directory-form').onsubmit = event => {
  event.preventDefault();
  const directory = $('directory-input').value.trim();
  if (!directory) { $('directory-input').focus(); return; }
  perform('XVC_SET_DIRECTORY', {directory, button: $('pick-directory'), success: '缓存目录已更改'});
};
$('reset').onclick = () => perform('XVC_RESET_SETTINGS', {button: $('reset'), success: '已恢复全部默认设置'});
$('check').onclick = check;
check();
