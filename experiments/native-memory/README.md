# 原生内存剪贴板对照实验

这是诊断代码，**不是纯扩展实现，不是已安装的 Native Messaging 助手，也不是满足最终粘贴需求的方案**。

问题：假设绕过浏览器自定义格式限制，只把网络 MP4 的原始字节写成 macOS 原生 `public.mpeg-4`，是否就能在 Finder 中粘贴出视频文件？

实测答案：**不能。** 字节写入、进程退出后校验通过，但 `fileObjectsReadable` 为 false，Finder“编辑 → 粘贴”禁用，空的测试目录仍为 0 个项目。

## 运行

需要 macOS 和已经安装的 Swift 编译器。只在项目 `build` 目录生成诊断可执行文件；不生成或读取本地 MP4，不注册原生宿主。

默认只检查类型，不读取剪贴板正文：

```sh
npm run experiment:native -- inspect
```

以下命令会覆盖系统剪贴板，将允许的公开网络 MP4 读取到内存，再写为原生视频数据：

```sh
npm run experiment:native -- write https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4
```

写入进程退出后，单独读回本诊断标记的数据，比较大小与 SHA-256：

```sh
npm run experiment:native -- verify
```

`verify` 仅在存在自己的原型 receipt 时读取该测试视频；没有标记时拒绝。网络接收累计限制为 25,000,000 字节。

`public.mpeg-4` 原生数据、Web 自定义 MP4 数据、系统文件 URL 是三种不同的剪贴板表示。把标准类型写进去，仍不能据此声称 Finder、微信或 Codex 会接受视频文件。

正式方案的验证范围见 [验证记录](../../docs/validation.md)。
