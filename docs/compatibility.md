# 系统要求与兼容性

适用版本：**XVC v0.2.1**。更新时间：2026-10-15。

当前发行物是 **Chrome / Edge 扩展 + macOS 本地程序**。完整功能需要安装两部分；目前没有可独立安装的油猴用户脚本。

## 系统与硬件

| 环境 | 当前状态 | 说明 |
| --- | --- | --- |
| macOS 13 或更新版本 + Apple Silicon（M 系列芯片） | 提供安装包 | 原生程序为 arm64，构建显式指定最低 macOS 13 |
| macOS 12 或更早版本 | 不在支持范围 | 当前发行物的最低系统要求为 macOS 13 |
| Intel Mac | 未提供发行包 | 当前 ZIP 不包含 x86_64 原生程序；不能用现有包承诺兼容 |
| Windows / Linux | 不支持当前发行包 | 原生程序使用 macOS AppKit / NSPasteboard，需要分别移植 |
| iOS / iPadOS / Android | 不支持当前版本 | 当前扩展及本地程序安装流程面向桌面 macOS |

最低部署目标不等于所有系统版本均已测试。已有真实 X 复制验收在 Apple Silicon 开发机的 Chrome 与 Edge 上完成；本轮读取到该机器的 macOS 为 **26.5.2**，已安装 Chrome 为 **155.0.8059.40**。macOS 13/14/15 等版本及不同 M 系列机型尚未逐一验证。

## 浏览器与安装方式

| 浏览器或容器 | 当前状态 | 版本及依赖 |
| --- | --- | --- |
| Google Chrome | 已完成真实 X 首页、推文详情页验证 | 扩展声明最低 Chrome **116**；最低版本本身未单独验收 |
| Microsoft Edge（Chromium） | v0.2.0 已完成设置保存、错误处理、本地连接与真实 X 视频复制 | 尚未确认最低实测版本 |
| Brave / Arc / 其他 Chromium 浏览器 | 未适配、未验收 | 当前安装器只注册 Chrome 与 Edge，不能仅因使用 Chromium 就认定兼容 |
| Firefox / Safari | 当前发行物未适配 | 需要单独处理扩展 API、安装与本地通信 |
| Tampermonkey（油猴）等用户脚本管理器 | 当前包不能直接安装 | ZIP 中的 Manifest V3 扩展不是 `.user.js` 用户脚本 |

当前使用开发者模式加载已解压扩展，尚未在浏览器扩展商店发布。安装包尚未签名或公证，macOS 可能要求使用者确认运行来源。

## 使用者需要安装什么

1. Release 中 `XVC-macOS.zip` 内的 `extension/` 扩展。
2. 通过「安装 XVC.command」安装的 `xvc-host` 本地程序，以及对应浏览器的 Native Messaging 配置。
3. 刷新 X 页面，使扩展从页面加载时开始识别视频元数据。

普通使用者不需要 Node.js、Python、Swift 或 Xcode；这些只用于源码开发与构建。本地程序目前由扩展按需启动，没有常驻服务或 HTTP 监听端口。

如果浏览器或设备管理策略禁止加载未打包扩展、Native Messaging 或执行用户级程序，当前安装流程可能无法使用。

## 页面、视频和接收应用

| 项目 | 支持范围 |
| --- | --- |
| 页面 | `https://x.com/*`、`https://twitter.com/*`；当前按这两个域名注入 |
| 操作位置 | 推文的视频画面内右键；正文或普通图片区域不会显示 XVC 菜单 |
| 大小 | 默认完整文件 **≤ 25,000,000 字节**，含边界；可设 1–500 MB 或无限制，1 MB = 1,000,000 字节 |
| 视频来源 | 可访问的 `https://video.twimg.com/` 完整 MP4；失效或要求额外认证的源地址可能下载失败 |
| HLS / 分段流 / DRM | 暂不支持只提供分段流或需要受保护播放流程的视频 |
| 编码 | 已验证包含 H.264 / AAC 的实际样本；不转码，不保证所有 MP4 编解码组合都能被目标应用接收 |
| 剪贴板 | macOS 原生文件 URL（`public.file-url`），不是文本链接或 Web 自定义 MP4 数据 |
| 接收应用 | 需要支持文件粘贴；同一原生文件引用写法已由使用者确认可粘贴到微信，不能据此保证所有应用通用 |

X 页面结构或媒体接口改变后，视频识别可能需要更新。复制前应正常登录并能够访问 X，下载时还需要能够访问视频 CDN。

默认每次新下载前删除当前缓存目录中的历史 XVC 视频和残留，失败或取消也不会恢复。开启「保留历史缓存」后保留完整视频。目录切换及恢复默认本身不删除文件。原生文件引用随文件删除而失效。

v0.2.0 需要同时更新扩展和本地程序。无限制只取消 XVC 的文件大小限制，不改变 MP4 来源、内容校验、磁盘容量、网络或接收应用的限制。

## 能否发布油猴版

可以开发独立的用户脚本版本，并通过 Greasy Fork、OpenUserJS 或 GitHub 分发；**当前 v0.2.1 没有这样的产物，不能直接把 ZIP 或现有扩展脚本改后缀后上架。** Tampermonkey 是运行用户脚本的管理器，脚本通常发布到上述托管平台。

当前扩展通过 Service Worker 的 Native Messaging 接口启动本地程序。Chrome 将此接口限定在扩展页面和 Service Worker，普通页面脚本及用户脚本无法直接复用这个入口。油猴的 `GM_setClipboard` 面向文本/HTML，不能代替这里的 macOS 原生文件复制。

当前不计划发布独立油猴版，继续维护扩展与本地程序组合。

## 参考

- [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)：接口可用范围及扩展权限。
- [Tampermonkey：GM_setClipboard](https://www.tampermonkey.net/documentation.php?q=GM_setClipboard)：文本/HTML 剪贴板接口。
- [Tampermonkey：GM_xmlhttpRequest](https://www.tampermonkey.net/documentation.php?q=GM_xmlhttpRequest) 与 [@connect](https://www.tampermonkey.net/documentation.php?q=connect)：用户脚本网络请求与本机地址声明。
- [Tampermonkey 用户脚本分发说明](https://www.tampermonkey.net/scripts.php)：脚本托管平台与 GitHub 分发。
- [Greasy Fork 脚本发布规则](https://greasyfork.org/en/help/code-rules)：功能描述、代码可读性与主要功能要求。
