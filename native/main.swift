import AppKit
import Foundation
import CryptoKit
import AVFoundation
import Darwin
import CoreFoundation

let version = "0.2.1"
let hostName = "com.xvc.native"
let protocolVersion = 2
let xvcFiles = FileManager.default
let args = Array(CommandLine.arguments.dropFirst())
let testMode = args.first == "--test"
let testHTTP = testMode && ProcessInfo.processInfo.environment["XVC_TEST_ALLOW_HTTP"] == "1"

struct XVCError: Error {
    let code: String
    let message: String
    init(_ code: String, _ message: String) { self.code = code; self.message = message }
}

struct Preferences: Codable {
    var maxMB = 25
    var unlimited = false
    var keepCache = false
    var cachePath: String?
    var byteLimit: Int? { unlimited ? nil : maxMB * 1_000_000 }
    var json: [String: Any] { ["maxMB": maxMB, "unlimited": unlimited, "keepCache": keepCache] }
}

func preferencesDirectory() throws -> URL {
    let directory: URL
    if testMode {
        guard let path = ProcessInfo.processInfo.environment["XVC_TEST_CACHE"], path.hasPrefix("/"), path.count > 8 else {
            throw XVCError("TEST_CONFIG", "测试必须指定独立缓存目录")
        }
        let cache = URL(fileURLWithPath: path, isDirectory: true)
        directory = cache.deletingLastPathComponent().appendingPathComponent(".\(cache.lastPathComponent)-settings", isDirectory: true)
    } else {
        directory = xvcFiles.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/XVC", isDirectory: true)
    }
    try xvcFiles.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    return directory
}

func readPreferences() throws -> Preferences {
    let path = try preferencesDirectory().appendingPathComponent("settings.json")
    guard xvcFiles.fileExists(atPath: path.path) else { return Preferences() }
    do {
        let value = try JSONDecoder().decode(Preferences.self, from: Data(contentsOf: path))
        guard (1...500).contains(value.maxMB), value.cachePath == nil ||
                (value.cachePath!.hasPrefix("/") && URL(fileURLWithPath: value.cachePath!).lastPathComponent == "XVC-videos") else {
            throw XVCError("SETTINGS", "设置文件无效，请检查 XVC 设置")
        }
        return value
    } catch { throw XVCError("SETTINGS", "无法读取 XVC 设置，请检查设置文件") }
}

func writePreferences(_ value: Preferences) throws {
    let path = try preferencesDirectory().appendingPathComponent("settings.json")
    try JSONEncoder().encode(value).write(to: path, options: .atomic)
    try xvcFiles.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path.path)
}

// A single lock covers all browsers AND all cache locations, including directory changes.
func operationLock() throws -> Int32 {
    let path = try preferencesDirectory().appendingPathComponent(".operation.lock")
    let descriptor = open(path.path, O_CREAT | O_RDWR | O_NOFOLLOW, 0o600)
    guard descriptor >= 0 else { throw XVCError("CACHE", "无法打开 XVC 操作锁") }
    guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
        close(descriptor)
        throw XVCError("BUSY", "另一个视频或设置操作正在进行，请稍后重试")
    }
    return descriptor
}

func settingsReply(_ value: Preferences, type: String = "settings", cancelled: Bool = false) throws -> [String: Any] {
    ["type": type, "ok": true, "version": version, "protocolVersion": protocolVersion,
     "settings": value.json, "cacheDirectory": try cacheLocation(value).path, "cancelled": cancelled]
}

func handleSettings(_ message: [String: Any], type: String) throws {
    if type == "ping" {
        Wire.send(try settingsReply(readPreferences(), type: "ready"))
        if message["keepAlive"] as? Bool != true { exit(0) }
        return
    }
    if type == "openCache" {
        let value = try readPreferences(), directory = try cacheDirectory(value)
        if !testMode && !NSWorkspace.shared.open(directory) { throw XVCError("CACHE", "无法在 Finder 打开缓存目录") }
        Wire.send(try settingsReply(value)); exit(0)
    }
    let descriptor = try operationLock()
    defer { close(descriptor) }
    var value = type == "resetSettings" ? Preferences() : try readPreferences()
    if type == "updateSettings" {
        guard let patch = message["patch"] as? [String: Any], !patch.isEmpty,
              Set(patch.keys).isSubset(of: ["maxMB", "unlimited", "keepCache"]) else {
            throw XVCError("SETTINGS", "设置参数无效")
        }
        if let raw = patch["maxMB"] {
            guard let number = raw as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
                  (1...500).contains(number.doubleValue), number.doubleValue.rounded() == number.doubleValue else {
                throw XVCError("SETTINGS", "大小上限需为 1–500 MB 的整数")
            }
            value.maxMB = number.intValue
        }
        for key in ["unlimited", "keepCache"] {
            if let raw = patch[key] {
                guard let number = raw as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else {
                    throw XVCError("SETTINGS", "开关设置参数无效")
                }
                if key == "unlimited" { value.unlimited = number.boolValue } else { value.keepCache = number.boolValue }
            }
        }
    } else if type == "setDirectory" {
        guard let path = message["directory"] as? String, !path.isEmpty, path.utf8.count < 4096,
              path.rangeOfCharacter(from: .controlCharacters) == nil else {
            throw XVCError("SETTINGS", "请输入有效的文件夹路径")
        }
        let expanded = (path as NSString).expandingTildeInPath
        guard expanded.hasPrefix("/") else { throw XVCError("SETTINGS", "请使用绝对路径或 ~/ 开头的路径") }
        let parent = URL(fileURLWithPath: expanded, isDirectory: true).standardizedFileURL.resolvingSymlinksInPath()
        var isDirectory: ObjCBool = false
        guard xvcFiles.fileExists(atPath: parent.path, isDirectory: &isDirectory), isDirectory.boolValue,
              xvcFiles.isWritableFile(atPath: parent.path) else {
            throw XVCError("CACHE", "保存位置不存在或不可写，请先创建文件夹或选择其他位置")
        }
        value.cachePath = (parent.lastPathComponent == "XVC-videos" ? parent : parent.appendingPathComponent("XVC-videos", isDirectory: true)).path
        _ = try cacheDirectory(value)
    } else if type == "resetSettings" { _ = try cacheDirectory(value) }
    else { throw XVCError("PROTOCOL", "未知设置操作") }
    try writePreferences(value)
    Wire.send(try settingsReply(value)); exit(0)
}

func allowedURL(_ value: String) -> URL? {
    guard value.utf8.count < 4096, let u = URL(string: value), u.user == nil, u.password == nil, u.fragment == nil else { return nil }
    if testHTTP && u.scheme == "http" && u.host == "127.0.0.1" && u.port == 4173 && u.path.hasSuffix(".mp4") { return u }
    guard u.scheme == "https", u.host == "video.twimg.com", u.port == nil || u.port == 443,
          u.path.lowercased().hasSuffix(".mp4") else { return nil }
    return u
}

enum Wire {
    static func readExact(_ count: Int) throws -> Data? {
        var data = Data()
        while data.count < count {
            let chunk = try FileHandle.standardInput.read(upToCount: count - data.count) ?? Data()
            if chunk.isEmpty {
                if data.isEmpty { return nil }
                throw XVCError("PROTOCOL", "本地通信数据不完整")
            }
            data.append(chunk)
        }
        return data
    }
    static func read() throws -> [String: Any]? {
        guard let header = try readExact(4) else { return nil }
        let length = header.enumerated().reduce(UInt32(0)) { $0 | UInt32($1.element) << ($1.offset * 8) }
        guard length > 0 && length <= 1_048_576 else { throw XVCError("PROTOCOL", "本地通信消息长度异常") }
        guard let data = try readExact(Int(length)), let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw XVCError("PROTOCOL", "本地通信消息格式错误")
        }
        return json
    }
    static func send(_ json: [String: Any]) {
        do {
            let data = try JSONSerialization.data(withJSONObject: json, options: [.sortedKeys])
            var length = UInt32(data.count).littleEndian
            var packet = withUnsafeBytes(of: &length) { Data($0) }
            packet.append(data)
            try FileHandle.standardOutput.write(contentsOf: packet)
        } catch { exit(1) }
    }
}

func cacheLocation(_ preferences: Preferences) throws -> URL {
    let url: URL
    if let custom = preferences.cachePath { url = URL(fileURLWithPath: custom, isDirectory: true) }
    else if testMode {
        guard let path = ProcessInfo.processInfo.environment["XVC_TEST_CACHE"], path.hasPrefix("/"), path.count > 8 else {
            throw XVCError("TEST_CONFIG", "测试必须指定独立缓存目录")
        }
        url = URL(fileURLWithPath: path, isDirectory: true)
    } else {
        url = xvcFiles.homeDirectoryForCurrentUser.appendingPathComponent("Library/Caches/XVC/videos", isDirectory: true)
    }
    return url
}

func cacheDirectory(_ preferences: Preferences) throws -> URL {
    let url = try cacheLocation(preferences)
    guard url.standardizedFileURL.resolvingSymlinksInPath().path == url.standardizedFileURL.path else {
        throw XVCError("CACHE", "缓存目录不能是符号链接，请重新选择位置")
    }
    try xvcFiles.createDirectory(at: url, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    guard xvcFiles.isWritableFile(atPath: url.path) else { throw XVCError("CACHE", "缓存目录不可写，请选择其他位置") }
    return url
}

func isOwnedVideo(_ name: String) -> Bool {
    if name.hasPrefix("XVC-"), name.hasSuffix(".mp4"), UUID(uuidString: String(name.dropFirst(4).dropLast(4))) != nil { return true }
    return name.range(of: "^xvc-[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-f0-9]{12}\\.mp4$", options: .regularExpression) != nil
}

func commitVideo(_ partial: URL, to cache: URL) throws -> URL {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.calendar = Calendar(identifier: .gregorian)
    formatter.dateFormat = "yyyy-MM-dd"
    let date = formatter.string(from: Date())
    for _ in 0..<8 {
        let suffix = String(UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased().prefix(12))
        let target = cache.appendingPathComponent("xvc-\(date)-\(suffix).mp4")
        do { try xvcFiles.moveItem(at: partial, to: target); return target }
        catch { if !xvcFiles.fileExists(atPath: target.path) { throw error } }
    }
    throw XVCError("CACHE", "无法生成唯一视频文件名，请重试")
}

func inspectMP4(_ data: Data, byteLimit: Int?) throws {
    guard !data.isEmpty else { throw XVCError("INVALID_MP4", "视频文件为空，不能复制") }
    if let byteLimit, data.count > byteLimit { throw XVCError("TOO_LARGE", "视频超过设置上限，不能复制") }
    var offset = 0
    var boxes = Set<String>()
    func integer(_ start: Int, _ count: Int) -> UInt64 {
        data[start..<start + count].reduce(UInt64(0)) { ($0 << 8) | UInt64($1) }
    }
    while offset < data.count {
        guard offset + 8 <= data.count else { throw XVCError("INVALID_MP4", "视频下载不完整，不能复制") }
        var size = integer(offset, 4)
        let type = String(data: data[offset + 4..<offset + 8], encoding: .ascii) ?? ""
        var header = 8
        if size == 1 {
            guard offset + 16 <= data.count else { throw XVCError("INVALID_MP4", "MP4 结构不完整") }
            size = integer(offset + 8, 8); header = 16
        } else if size == 0 { size = UInt64(data.count - offset) }
        guard size >= UInt64(header), size <= UInt64(data.count - offset) else { throw XVCError("INVALID_MP4", "MP4 长度不完整") }
        if type == "ftyp" && size < 16 { throw XVCError("INVALID_MP4", "MP4 类型信息不完整") }
        boxes.insert(type)
        offset += Int(size)
    }
    guard ["ftyp", "moov", "mdat"].allSatisfy({ boxes.contains($0) }) else {
        throw XVCError("INVALID_MP4", "收到的内容不是完整 MP4 视频")
    }
}

final class CopyJob: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    let id: String
    let urls: [URL]
    let cache: URL
    let preferences: Preferences
    var byteLimit: Int? { preferences.byteLimit }
    var limitText: String { "\(preferences.maxMB) MB" }
    var index = 0
    var received = 0
    var expected: Int64 = -1
    var lastReport = Date.distantPast
    var failure: XVCError?
    var session: URLSession?
    var task: URLSessionDataTask?
    var handle: FileHandle?
    var partial: URL?
    var finished = false
    var lockFD: Int32 = -1

    init(id: String, urls: [URL], cache: URL, preferences: Preferences, lockFD: Int32) {
        self.id = id; self.urls = urls; self.cache = cache; self.preferences = preferences; self.lockFD = lockFD
    }
    func begin() {
        do {
            // All browser profiles share this cache. Hold the lock until the host exits so
            // a second task cannot delete a video that is still being downloaded or copied.
            try clearPreviousFiles()
            start()
        } catch { fail(error as? XVCError ?? XVCError("CACHE", "无法清理上一次的视频缓存，请重试")) }
    }
    func clearPreviousFiles() throws {
        let files = try xvcFiles.contentsOfDirectory(at: cache, includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey])
        for url in files {
            let name = url.lastPathComponent
            let base: String
            if name.hasPrefix("XVC-") && name.hasSuffix(".mp4") { base = String(name.dropFirst(4).dropLast(4)) }
            else if name.hasSuffix(".part.mp4") { base = String(name.dropLast(9)) }
            else if name.hasSuffix(".part") { base = String(name.dropLast(5)) }
            else { base = "" }
            let video = isOwnedVideo(name)
            guard name == "current.json" || video || UUID(uuidString: base) != nil else { continue }
            if preferences.keepCache && (name == "current.json" || video) { continue }
            let info = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
            // Only remove XVC-owned entries; never follow a symlink or traverse directories.
            guard info.isRegularFile == true || info.isSymbolicLink == true else { continue }
            try xvcFiles.removeItem(at: url)
        }
    }
    func progress(_ stage: String, _ value: Double, message: String = "") {
        Wire.send(["type": "progress", "jobId": id, "stage": stage, "progress": value,
                   "received": received, "total": max(0, expected), "message": message])
    }
    func start() {
        guard !finished else { return }
        guard index < urls.count else { fail(XVCError("TOO_LARGE", "可用的视频清晰度均超过 \(limitText)，不能复制")); return }
        received = 0; expected = -1; failure = nil; lastReport = .distantPast
        let source = urls[index]; index += 1
        progress("checking", 0.02, message: index > 1 ? "正在尝试更小的视频清晰度" : preferences.unlimited ? "连接视频源，不限制大小" : "连接视频源，检查 \(limitText) 上限")
        do {
            let path = cache.appendingPathComponent(UUID().uuidString + ".part.mp4")
            guard xvcFiles.createFile(atPath: path.path, contents: nil, attributes: [.posixPermissions: 0o600]) else {
                throw XVCError("CACHE", "无法创建 XVC 视频缓存")
            }
            partial = path
            handle = try FileHandle(forWritingTo: path)
            let config = URLSessionConfiguration.ephemeral
            config.urlCache = nil; config.httpCookieStorage = nil; config.urlCredentialStorage = nil
            config.requestCachePolicy = .reloadIgnoringLocalCacheData
            config.timeoutIntervalForRequest = 45; config.timeoutIntervalForResource = 3600
            let session = URLSession(configuration: config, delegate: self, delegateQueue: .main)
            self.session = session
            var request = URLRequest(url: source)
            request.setValue("video/mp4", forHTTPHeaderField: "Accept")
            request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
            task = session.dataTask(with: request)
            task?.resume()
        } catch { fail(error as? XVCError ?? XVCError("CACHE", "无法写入 XVC 视频缓存")) }
    }
    func cancel() {
        guard !finished else { return }
        fail(XVCError("CANCELLED", "已取消，未修改剪贴板"))
    }
    func cleanupPartial() {
        try? handle?.close(); handle = nil
        if let partial { try? xvcFiles.removeItem(at: partial) }
        partial = nil
    }
    func fail(_ error: XVCError) {
        guard !finished else { return }
        finished = true; task?.cancel(); session?.invalidateAndCancel(); cleanupPartial()
        Wire.send(["type": "error", "jobId": id, "code": error.code, "message": error.message])
        exit(0)
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        guard let target = request.url, allowedURL(target.absoluteString) != nil else {
            failure = XVCError("SOURCE", "视频跳转到了不支持的来源"); completionHandler(nil); return
        }
        completionHandler(request)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard !finished && failure == nil else { completionHandler(.cancel); return }
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            failure = XVCError("HTTP", "视频源暂时无法下载，请刷新 X 后重试"); completionHandler(.cancel); return
        }
        expected = response.expectedContentLength
        if let byteLimit, expected > byteLimit {
            failure = XVCError("TOO_LARGE", "视频超过 \(limitText)，不能复制"); completionHandler(.cancel); return
        }
        progress("downloading", 0.06)
        completionHandler(.allow)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard !finished && failure == nil else { return }
        guard data.count <= (byteLimit ?? Int.max) - received else {
            failure = XVCError("TOO_LARGE", "视频实际大小超过 \(limitText)，已停止下载"); dataTask.cancel(); return
        }
        do { try handle?.write(contentsOf: data) }
        catch { failure = XVCError("CACHE", "缓存写入失败，请检查磁盘空间"); dataTask.cancel(); return }
        received += data.count
        if Date().timeIntervalSince(lastReport) >= 0.1 {
            lastReport = Date()
            progress("downloading", expected > 0 ? 0.06 + 0.84 * min(1, Double(received) / Double(expected)) : 0.06)
        }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard !finished else { return }
        session.finishTasksAndInvalidate()
        try? handle?.close(); handle = nil
        if let failure {
            cleanupPartial()
            if failure.code == "TOO_LARGE" && index < urls.count { start() }
            else { fail(failure) }
            return
        }
        if error != nil { fail(XVCError("NETWORK", "视频下载失败或超时，请重试")); return }
        guard expected < 0 || received == expected else { fail(XVCError("INCOMPLETE", "视频下载不完整，未修改剪贴板")); return }
        validateAndCopy()
    }
    func validateAndCopy() {
        guard let partial else { fail(XVCError("CACHE", "视频缓存不存在")); return }
        Task { @MainActor in
        var final: URL?
        do {
            progress("validating", 0.92)
            let data = try Data(contentsOf: partial, options: .mappedIfSafe)
            try inspectMP4(data, byteLimit: byteLimit)
            let asset = AVURLAsset(url: partial)
            let tracks = try await asset.loadTracks(withMediaType: .video)
            let duration = try await asset.load(.duration)
            guard !tracks.isEmpty,
                  CMTimeGetSeconds(duration).isFinite, CMTimeGetSeconds(duration) > 0 else {
                throw XVCError("INVALID_MP4", "文件中没有可读取的视频轨道")
            }
            guard !finished else { return }
            let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
            let target = try commitVideo(partial, to: cache)
            self.partial = nil; final = target
            progress("clipboard", 0.98)
            let item = NSPasteboardItem()
            guard item.setString(target.absoluteString, forType: .fileURL) else { throw XVCError("CLIPBOARD", "无法准备文件剪贴板条目") }
            let board = NSPasteboard.general
            board.clearContents()
            guard board.writeObjects([item]) else { throw XVCError("CLIPBOARD", "视频已缓存，但系统剪贴板写入失败") }
            let urls = (board.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL]) ?? []
            guard urls.count == 1, urls[0].standardizedFileURL == target.standardizedFileURL else {
                throw XVCError("CLIPBOARD", "剪贴板被其他操作更改，未确认复制成功")
            }
            let receipt: [String: Any] = ["filename": target.lastPathComponent, "bytes": received, "sha256": digest, "copiedAt": ISO8601DateFormatter().string(from: Date())]
            if let json = try? JSONSerialization.data(withJSONObject: receipt) { try? json.write(to: cache.appendingPathComponent("current.json"), options: .atomic) }
            finished = true
            Wire.send(["type": "success", "jobId": id, "bytes": received, "sha256": digest,
                       "filename": target.lastPathComponent, "clipboardType": "public.file-url", "verified": true])
            exit(0)
        } catch {
            fputs("XVC validation: \(error)\n", stderr)
            // A committed file may already be referenced by the clipboard. Retain it on write/readback failure.
            if final != nil { self.partial = nil }
            fail(error as? XVCError ?? XVCError("VALIDATION", "视频校验或缓存保存失败，未确认复制成功"))
        }
        }
    }
}

func install(uninstall: Bool) throws {
    let support = xvcFiles.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support", isDirectory: true)
    let directory = support.appendingPathComponent("XVC", isDirectory: true)
    let binary = directory.appendingPathComponent("xvc-host")
    let registrations = ["Google/Chrome", "Microsoft Edge"].map {
        support.appendingPathComponent($0).appendingPathComponent("NativeMessagingHosts/\(hostName).json")
    }
    if uninstall {
        for url in registrations {
            if let data = try? Data(contentsOf: url), let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any], json["path"] as? String == binary.path {
                try xvcFiles.removeItem(at: url)
            }
        }
        if xvcFiles.fileExists(atPath: binary.path) { try xvcFiles.removeItem(at: binary) }
        print("XVC 本地程序已卸载。设置与视频缓存已保留。")
        return
    }
    let source = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL
    try xvcFiles.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    if source != binary {
        try Data(contentsOf: source).write(to: binary, options: .atomic)
        try xvcFiles.setAttributes([.posixPermissions: 0o700], ofItemAtPath: binary.path)
    }
    let manifest: [String: Any] = ["name": hostName, "description": "XVC macOS video clipboard host", "path": binary.path,
                                   "type": "stdio", "allowed_origins": ["chrome-extension://\(extensionID)/"]]
    let data = try JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .sortedKeys])
    for url in registrations {
        try xvcFiles.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: .atomic)
        try xvcFiles.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }
    print("XVC 本地程序已安装，支持 Chrome / Edge。\n扩展 ID：\(extensionID)\n现在加载安装包中的 extension 文件夹，并刷新 X 页面。")
}

if args.first == "--install" || args.first == "--uninstall" {
    do { try install(uninstall: args.first == "--uninstall"); exit(0) }
    catch { fputs("XVC 安装失败：\(error)\n", stderr); exit(1) }
}
if args.first == "--version" { print(version); exit(0) }
guard testMode || args.first == "chrome-extension://\(extensionID)/" else {
    fputs("XVC: caller is not the registered extension\n", stderr); exit(1)
}

var activeJob: CopyJob?
DispatchQueue.global(qos: .userInitiated).async {
    do {
        while let message = try Wire.read() {
            DispatchQueue.main.async {
                let type = message["type"] as? String ?? ""
                if activeJob == nil && ["ping", "updateSettings", "openCache", "setDirectory", "resetSettings"].contains(type) {
                    do { try handleSettings(message, type: type) }
                    catch { Wire.send(["type": "error", "ok": false, "code": (error as? XVCError)?.code ?? "SETTINGS", "message": (error as? XVCError)?.message ?? "设置操作失败，请检查目录权限后重试"]); exit(0) }
                    return
                }
                if message["type"] as? String == "cancel", message["jobId"] as? String == activeJob?.id { activeJob?.cancel(); return }
                guard message["type"] as? String == "copy", activeJob == nil,
                      let id = message["jobId"] as? String, UUID(uuidString: id) != nil,
                      let inputs = message["urls"] as? [String], !inputs.isEmpty, inputs.count <= 10 else {
                    Wire.send(["type": "error", "jobId": message["jobId"] as? String ?? "", "code": "PROTOCOL", "message": "复制任务参数无效"]); exit(0)
                }
                let urls = inputs.compactMap(allowedURL)
                guard urls.count == inputs.count else {
                    Wire.send(["type": "error", "jobId": id, "code": "SOURCE", "message": "只允许当前 X 视频 CDN 的完整 MP4"]); exit(0)
                }
                do {
                    let descriptor = try operationLock()
                    let preferences: Preferences
                    let directory: URL
                    do { preferences = try readPreferences(); directory = try cacheDirectory(preferences) }
                    catch { close(descriptor); throw error }
                    let job = CopyJob(id: id, urls: urls, cache: directory, preferences: preferences, lockFD: descriptor)
                    activeJob = job; job.begin()
                } catch {
                    Wire.send(["type": "error", "jobId": id, "code": (error as? XVCError)?.code ?? "CACHE", "message": (error as? XVCError)?.message ?? "无法创建 XVC 专用缓存目录"]); exit(0)
                }
            }
        }
        // EOF means the browser disconnected. Cancel pending network work and remove partial files.
        DispatchQueue.main.async { activeJob?.cancel(); exit(0) }
    } catch { fputs("XVC protocol error: \(error)\n", stderr); exit(1) }
}
RunLoop.main.run()
