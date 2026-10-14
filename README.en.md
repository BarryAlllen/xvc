<img src="extension/icons/128.png" width="80" height="80" alt="XVC colorful pixel icon">

# XVC · X Video Copy

Copy an X video as an MP4 file to the macOS clipboard from its right-click menu, then paste it with **⌘V** into an application that accepts files.

[中文](README.md) | **English**

[Download](https://github.com/BarryAlllen/xvc/releases/latest/download/XVC-macOS.zip) · [Releases](https://github.com/BarryAlllen/xvc/releases/latest) · [Compatibility](docs/compatibility.md) · [Report an issue](https://github.com/BarryAlllen/xvc/issues)

## Features

- A **复制视频** (Copy video) menu appears only over a tweet's video area.
- A small toast at the top of the page shows progress without blocking browsing.
- Downloads complete MP4 files, with a default **25 MB** limit and smaller-quality fallback when needed. A slider sets 1–500 MB; unlimited mode disables the size cap.
- Reports success only after the native file clipboard entry has been written and read back.
- Removes previous XVC videos by default; optional retention keeps completed files. Cache location can be opened or changed from settings.
- Starts the native helper on demand; no background service or local HTTP server is required.

## Requirements and limitations

The downloadable package targets **macOS 13+ on Apple Silicon**. Chrome has been tested on real X timelines and tweet pages. Edge v0.2.0 settings persistence, native connectivity and real X video copying have been verified. Intel Mac and Windows packages are not available yet. Not every supported macOS version has been tested.

Only complete MP4 sources are supported; HLS-only video is not supported. The receiving application must accept pasted files. The current package is unsigned and not notarized.

The extension declares Chrome 116 as its minimum version; that exact boundary has not been separately tested. Both the browser extension and native helper are required. Firefox, Safari, Linux and mobile platforms are not supported by the current package. There is no standalone Tampermonkey edition planned. See the [compatibility guide](docs/compatibility.md) for declared requirements, tested environments and platform limitations.

## Install

1. Download `XVC-macOS.zip` from [Releases](https://github.com/BarryAlllen/xvc/releases/latest) and extract it. The package contains the compiled native helper, so end users do not need developer tools.
2. Run `安装 XVC.command` (Install XVC).
3. Open `chrome://extensions` or `edge://extensions`, enable Developer mode, and load the package's `extension/` directory as an unpacked extension.
4. Open XVC and confirm that the local helper is connected, then refresh X.
5. Right-click a video, select **复制视频**, wait for **复制成功** (Copied), and paste with **⌘V**.

Keep the loaded `extension/` directory at its original location. To uninstall, run `卸载 XVC.command` and remove the browser extension. See the [installation guide](docs/安装与使用.md) for details. A `SHA256SUMS.txt` file is attached to each release.

## Settings in v0.2.0

Open XVC from the toolbar or the extension manager’s options link. Settings are shared by Chrome and Edge on this Mac, persisted in `~/Library/Application Support/XVC/settings.json`.

- Size: 1–500 MB slider, default 25 MB (1 MB = 1,000,000 bytes). Unlimited mode greys out and disables the slider; source validity, disk capacity and receiving-app limits still apply.
- Retention: off by default. Completed video names use `xvc-yyyy-mm-dd-12hex.mp4`, with collision retries.
- Cache: open in Finder or enter an existing writable folder (absolute path or `~/…`). XVC uses a dedicated `XVC-videos` child folder. Old files are not moved or deleted when changing locations.
- Reset: restores 25 MB, unlimited off, retention off, and the default cache location. Reset itself does not delete videos.

Changes apply to the next download; settings writes are refused during a transfer. Both the extension and native helper must be upgraded to v0.2.0. The panel credits **Barry** and links to the source repository.

## Cache and permissions

The default cache is `~/Library/Caches/XVC/videos/`; settings can use a different location. The clipboard contains a native `public.file-url` reference, so the current video file must remain available for pasting.

**With retention off (the default), starting a new download removes previous XVC videos, even if the task later fails or is cancelled.** With retention on, completed videos remain. Concurrent native downloads and settings writes are rejected to protect the active cache.

The extension requests only `nativeMessaging`. It extracts video metadata from responses already received by X. The helper accepts requests only from the fixed XVC extension and downloads complete MP4 files from `video.twimg.com`; arbitrary local files cannot be used as copy sources, and shell commands are not accepted.

## Repository layout

| Directory | Purpose |
| --- | --- |
| `extension/` | Chrome / Edge extension and page UI |
| `assets/brand/` | PNG / SVG artwork for the pixel icon |
| `native/` | Swift native helper and installer scripts |
| `scripts/` | Build, packaging, and development tools |
| `tests/` | JavaScript tests, synthetic fixtures, and native diagnostics |
| `docs/` | Installation, architecture, and validation |
| `experiments/` | Earlier feasibility experiments, outside the production workflow |
| `.github/` | Issue and pull request templates |

## Development

JavaScript tests require Node.js 20+. Building and native tests also require macOS and Xcode Command Line Tools. There are no third-party npm dependencies.

```sh
git clone https://github.com/BarryAlllen/xvc.git
cd xvc
npm test
npm run build
npm run test:native
```

The build produces `dist/XVC-macOS.zip`, `dist/SHA256SUMS.txt`, and an unpacked `dist/XVC/`. To test locally, run `native/build/xvc-host --install` and load the source `extension/` directory.

`extension/page-main.js` and `extension/content-bundle.js` are generated: edit their source files, rebuild, reload the extension, and refresh X.

The pixel icon is defined in `scripts/generate-icons.mjs`. Run `npm run icons` to regenerate all extension sizes and the large brand artwork; the full build also runs this step.

`npm run dev` serves a UI fixture on `127.0.0.1:4173`. Native tests use a dedicated cache and **overwrite the system clipboard with a synthetic video file reference**.

See [CONTRIBUTING.md](CONTRIBUTING.md), [architecture](docs/architecture.md), and [validation](docs/validation.md). Report vulnerabilities through the process in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) · Copyright © 2026 BarryAllen.
