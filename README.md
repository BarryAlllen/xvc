<img src="extension/icons/128.png" width="80" height="80" alt="XVC 彩色像素图标">

# XVC · X Video Copy

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/BarryAlllen/xvc)](https://github.com/BarryAlllen/xvc/releases/latest)

在 X 视频上右键，将不超过 **25 MB** 的完整 MP4 复制到 macOS 文件剪贴板，再用 **⌘V** 粘贴到支持文件粘贴的应用。

**中文** | [English](README.en.md)

[下载安装包](https://github.com/BarryAlllen/xvc/releases/latest/download/XVC-macOS.zip) · [安装说明](docs/安装与使用.md) · [系统要求与兼容性](docs/compatibility.md) · [问题反馈](https://github.com/BarryAlllen/xvc/issues)

## 功能

- 只在推文的视频画面内显示「复制视频」右键菜单。
- 点击后直接下载，顶部小提示显示进度，可以继续浏览页面。
- 检查完整 MP4、视频轨道和实际字节数；最高可用清晰度超限时尝试更小的 MP4。
- 本地程序写入原生文件引用并回读确认后，才提示「复制成功」。
- 新任务开始前清理历史缓存，成功后只保留当前视频。
- 本地程序按需启动、任务结束后退出，无常驻服务或本地 HTTP 端口。

## 支持范围

| 项目 | 当前状态 |
| --- | --- |
| macOS 13+ Apple Silicon（M 系列） | 提供安装包；实测范围见验证记录 |
| Chrome | 扩展声明最低 116；真实 X 首页和推文详情页已验证，最低版本未单独验收 |
| Edge | 提供扩展和本地连接配置，完整链路待验收 |
| Intel Mac / Windows / Linux / 移动端 | 当前发行包不支持 |
| Firefox / Safari / 油猴 | 当前发行物未适配；没有可独立安装的用户脚本 |
| 视频 | 完整 MP4，大小 ≤ 25,000,000 字节 |
| HLS / 分段流 | 暂不支持 |

接收应用需要支持文件粘贴；不同应用的接收行为可能不同。当前构建尚未签名、公证或发布到浏览器扩展商店。

完整功能需要同时安装浏览器扩展和本地程序。最低系统要求、实测环境与油猴版的适配路径见 [兼容性说明](docs/compatibility.md)。

## 安装与使用

1. 到 [Releases](https://github.com/BarryAlllen/xvc/releases/latest) 下载 **XVC-macOS.zip**，解压后保留整个 `XVC` 文件夹。包中已包含本地程序，无需安装开发工具。
2. 双击「安装 XVC.command」，完成当前用户级安装。
3. Chrome 打开 `chrome://extensions`，Edge 打开 `edge://extensions`，开启开发者模式，加载包内的 `extension/` 文件夹。
4. 打开 XVC，确认「本地程序已连接」，再刷新 X 页面。
5. 在视频画面内右键 →「复制视频」→ 等待「复制成功」→ 到目标应用按 **⌘V**。

安装器、本地程序的位置、更新与卸载步骤见 [完整安装说明](docs/安装与使用.md)。如需核对下载文件，可使用 Release 中的 `SHA256SUMS.txt`。

## 缓存与权限

当前视频位于 `~/Library/Caches/XVC/videos/`。剪贴板保存原生 `public.file-url` 引用，视频文件必须留在缓存中才能稍后粘贴。

**每次新下载开始前都会删除上一份视频和历史 XVC 缓存。** 即使新任务失败或取消，旧视频也不会恢复。多个窗口同时复制时，后一个任务会提示稍后重试，避免删除活动文件。

扩展仅申请 `nativeMessaging` 权限，从 X 页面已经收到的响应中提取视频元数据。本地程序只接受固定 XVC 扩展的请求，只从 `video.twimg.com` 下载完整 MP4，不接受任意本地路径或 shell 命令。

## 项目结构

```text
extension/                 Chrome / Edge 扩展、页面脚本与界面
assets/brand/              像素品牌图标的 PNG / SVG 大图
native/                    Swift 本地程序及安装/卸载脚本
scripts/                   构建、打包与本地测试工具
  build.mjs                生成脚本入口、编译 Swift、打包 ZIP
  generate-icons.mjs       可编辑的像素网格与多尺寸图标生成
  dev-server.mjs           本机界面验收服务
  test-native.mjs          原生协议与剪贴板集成测试
tests/                    JavaScript 测试、合成视频与诊断代码
  fixtures/                无用户内容的合成 MP4
  native/                  测试专用 Swift 剪贴板诊断
docs/                     安装说明、架构与验证记录
experiments/              早期可行性实验，不参与正式插件运行
.github/                  Issue 与 Pull Request 模板
dist/                     构建生成的安装包（不进入 Git）
```

## 开发与验证

JavaScript 测试需要 **Node.js 20+**。构建和原生测试还需要 **macOS 与 Xcode Command Line Tools**。项目没有 npm 第三方依赖。

```sh
git clone https://github.com/BarryAlllen/xvc.git
cd xvc
npm test
npm run build
npm run test:native
```

构建生成 `dist/XVC-macOS.zip`、`dist/SHA256SUMS.txt` 和解压后的 `dist/XVC/`。需要本机联调时，运行 `native/build/xvc-host --install`，并在浏览器加载源码中的 `extension/`。

`extension/page-main.js` 与 `extension/content-bundle.js` 是生成文件。修改相应源脚本后运行 `npm run build`，重新加载插件并刷新 X 页面。

彩色像素图标由 `scripts/generate-icons.mjs` 定义。运行 `npm run icons` 可重新生成 16 / 32 / 48 / 128 像素图标及品牌大图；完整构建也会自动生成。

`npm run dev` 启动仅监听 `127.0.0.1:4173` 的界面测试页。`npm run test:native` 使用独立测试缓存，**会用合成视频覆盖系统剪贴板**。

详细说明：[架构](docs/architecture.md) · [验证记录](docs/validation.md) · [贡献指南](CONTRIBUTING.md)

## 参与贡献

欢迎通过 [Issue](https://github.com/BarryAlllen/xvc/issues) 反馈问题或建议，通过 Pull Request 提交改动。提交前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。漏洞请通过 [安全政策](SECURITY.md) 中的渠道报告。

## 许可证

本项目使用 [MIT License](LICENSE)，Copyright © 2026 BarryAllen。
