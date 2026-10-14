# 参与贡献

感谢你帮助改进 XVC。欢迎通过 [Issues](https://github.com/BarryAlllen/xvc/issues) 报告问题或提出建议，通过 Pull Request 提交改动。

## 本地开发

JavaScript 测试需要 Node.js 20 或更新版本。构建本地程序还需要 macOS 与 Xcode Command Line Tools。项目没有 npm 第三方依赖，无需运行 `npm install`。

```sh
git clone https://github.com/BarryAlllen/xvc.git
cd xvc
npm test
npm run build
```

在浏览器开发者模式下加载根目录的 `extension/`。在 macOS 运行 `native/build/xvc-host --install`，再刷新 X 页面。安装会更新当前用户的 XVC 本地程序与 Chrome / Edge 连接配置。

## 修改入口

- 视频匹配：`extension/media-core.js`、`extension/page-observer.js`。
- 右键菜单与顶部提示：`extension/content.js`。
- 浏览器与本地程序通信：`extension/service-worker.js`。
- 下载、缓存与系统剪贴板：`native/main.swift`。
- 构建和打包：`scripts/build.mjs`。
- 彩色像素图标：`scripts/generate-icons.mjs`，运行 `npm run icons` 生成各尺寸 PNG 和品牌 SVG。

`extension/page-main.js` 和 `extension/content-bundle.js` 为生成文件。修改源文件后运行 `npm run build`，一并提交更新的生成文件；重新加载插件并刷新 X 页面后生效。

早期可行性实验位于 `experiments/`，不参与正式插件运行。

## 验证改动

提交前运行 `npm test`。修改 Swift 本地程序、下载协议或缓存逻辑后，还应在 macOS 运行：

```sh
npm run build
npm run test:native
```

原生测试使用独立测试缓存，并会用合成视频覆盖系统剪贴板。`npm run dev` 可启动界面测试页，仅监听 `127.0.0.1:4173`。

涉及实际页面行为时，请说明是否在真实 X 页面验证，记录浏览器和系统版本。只有收到原生文件剪贴板成功回执，才能把结果认定为复制成功。

## 提交 Pull Request

请围绕一个具体问题提交改动，说明原来的行为、修改后的行为和验证结果。新增依赖或较大的架构改动，建议先开 Issue 讨论。

不要提交账号信息、Cookie、令牌、剪贴板原始快照、下载缓存或编译产物。测试素材应使用合成视频，并说明生成方法。安全问题请遵循 [安全政策](SECURITY.md)。

## 维护发布

1. 同步 `package.json`、`extension/manifest.json`、`native/main.swift` 中的版本，以及安装文档和 `CHANGELOG.md`。
2. 运行构建与相关测试；构建会检查三个版本是否一致。
3. 创建 `v版本号` 标签及 GitHub Release，上传 `dist/XVC-macOS.zip` 与 `dist/SHA256SUMS.txt`。
4. 安装包中应包含扩展、已编译本地程序、安装/卸载命令、许可证和通用说明。

提交贡献即表示你同意贡献内容按本项目的 [MIT License](LICENSE) 分发。
