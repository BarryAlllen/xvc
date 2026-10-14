const status = document.getElementById('status');
const button = document.getElementById('check');
async function check() {
  button.disabled = true; status.textContent = '正在检查本地程序…'; delete status.dataset.ok;
  try {
    const result = await chrome.runtime.sendMessage({type: 'XVC_PING'});
    status.dataset.ok = String(Boolean(result?.ok));
    status.textContent = result?.ok ? `本地程序已连接 · v${result.version}` : result?.message || '未连接本地程序，请运行安装脚本。';
  } catch { status.dataset.ok = 'false'; status.textContent = '连接失败，请重新加载扩展后重试。'; }
  finally { button.disabled = false; }
}
button.onclick = check;
check();
