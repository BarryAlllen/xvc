function openProbe(source) {
  const url = new URL(chrome.runtime.getURL('probe.html'));
  if (source) url.searchParams.set('source', source);
  chrome.tabs.create({url: url.href});
}

chrome.action.onClicked.addListener(() => openProbe());
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'xvc-copy-prototype',
      title: 'XVC：验证复制此视频',
      contexts: ['video'],
      documentUrlPatterns: ['https://x.com/*', 'https://twitter.com/*', 'http://127.0.0.1/*']
    });
  });
});
chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'xvc-copy-prototype') openProbe(info.srcUrl);
});
