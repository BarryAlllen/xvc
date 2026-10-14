// Diagnostic control, NOT a browser extension or an installed native host.
// Network MP4 -> memory -> native pasteboard data. No video file APIs.
import AppKit
import Foundation
import CryptoKit
import UniformTypeIdentifiers

let limit = 25_000_000
let movieType = NSPasteboard.PasteboardType(UTType.mpeg4Movie.identifier)
let receiptType = NSPasteboard.PasteboardType("org.xvc.native-memory-probe.receipt")

struct ProbeError: Error, CustomStringConvertible {
    let description: String
    init(_ message: String) { description = message }
}

final class MemoryFetch: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    var buffer = Data()
    var failure: Error?
    let complete = DispatchSemaphore(value: 0)

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask,
                    didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            failure = ProbeError("Expected HTTP 200")
            completionHandler(.cancel)
            return
        }
        if response.expectedContentLength > Int64(limit) {
            failure = ProbeError("Response exceeds 25,000,000 bytes")
            completionHandler(.cancel)
            return
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard buffer.count + data.count <= limit else {
            failure = ProbeError("Actual response exceeds 25,000,000 bytes")
            dataTask.cancel()
            return
        }
        buffer.append(data)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if failure == nil { failure = error }
        complete.signal()
    }

    func fetch(_ url: URL) throws -> Data {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        let task = session.dataTask(with: url)
        task.resume()
        guard complete.wait(timeout: .now() + 45) == .success else {
            session.invalidateAndCancel()
            throw ProbeError("Network timeout")
        }
        session.finishTasksAndInvalidate()
        if let failure { throw failure }
        return buffer
    }
}

func inspect(_ data: Data) throws -> [String] {
    let bytes = [UInt8](data)
    var offset = 0
    var boxes = [String]()
    while offset < bytes.count {
        guard offset + 8 <= bytes.count else { throw ProbeError("Incomplete MP4 box header") }
        var size = Int(bytes[offset..<offset+4].reduce(UInt32(0)) { ($0 << 8) | UInt32($1) })
        let type = String(bytes: bytes[offset+4..<offset+8], encoding: .ascii) ?? ""
        var header = 8
        if size == 1 {
            guard offset + 16 <= bytes.count else { throw ProbeError("Incomplete extended box") }
            let extended = bytes[offset+8..<offset+16].reduce(UInt64(0)) { ($0 << 8) | UInt64($1) }
            guard extended <= UInt64(limit) else { throw ProbeError("Invalid box length") }
            size = Int(extended)
            header = 16
        } else if size == 0 { size = bytes.count - offset }
        guard size >= header && offset + size <= bytes.count else { throw ProbeError("Incomplete MP4 data") }
        boxes.append(type)
        offset += size
    }
    guard ["ftyp", "moov", "mdat"].allSatisfy({ boxes.contains($0) }) else {
        throw ProbeError("Not a complete MP4")
    }
    return boxes
}

func sha256(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

func emit(_ value: [String: Any]) throws {
    let json = try JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys])
    print(String(decoding: json, as: UTF8.self))
}

do {
    let arguments = CommandLine.arguments
    let mode = arguments.count > 1 ? arguments[1] : "inspect"
    let board = NSPasteboard.general
    if mode == "write" {
        guard arguments.count == 3, let url = URL(string: arguments[2]),
              (url.scheme == "https" && ["interactive-examples.mdn.mozilla.net", "video.twimg.com"].contains(url.host ?? "")) ||
              (url.scheme == "http" && url.host == "127.0.0.1" && url.port == 4173) else {
            throw ProbeError("Expected an allowed network URL, never a file URL")
        }
        let data = try MemoryFetch().fetch(url)
        let boxes = try inspect(data)
        let receipt: [String: Any] = ["product": "XVC_NATIVE_MEMORY_PROBE", "jobId": UUID().uuidString,
                                      "bytes": data.count, "sha256": sha256(data), "boxes": boxes]
        let item = NSPasteboardItem()
        guard item.setData(data, forType: movieType),
              item.setData(try JSONSerialization.data(withJSONObject: receipt), forType: receiptType) else {
            throw ProbeError("Cannot prepare pasteboard item")
        }
        board.clearContents()
        guard board.writeObjects([item]) else { throw ProbeError("Native clipboard write failed") }
        try emit(["operation": "write", "receipt": receipt,
                  "types": board.types?.map { $0.rawValue } ?? [],
                  "nativeMovieType": movieType.rawValue,
                  "conformsToMovie": UTType.mpeg4Movie.conforms(to: .movie),
                  "fileObjectsReadable": board.canReadObject(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true])])
    } else if mode == "verify" {
        guard let receiptData = board.data(forType: receiptType),
              let receipt = try JSONSerialization.jsonObject(with: receiptData) as? [String: Any],
              receipt["product"] as? String == "XVC_NATIVE_MEMORY_PROBE",
              let data = board.data(forType: movieType) else {
            throw ProbeError("No own native-memory test payload; no unrelated payload read")
        }
        let boxes = try inspect(data)
        let digest = sha256(data)
        guard receipt["sha256"] as? String == digest, receipt["bytes"] as? Int == data.count else {
            throw ProbeError("Native clipboard readback mismatch")
        }
        try emit(["operation": "verify", "ok": true, "receipt": receipt,
                  "readBytes": data.count, "readSha256": digest, "boxes": boxes,
                  "types": board.types?.map { $0.rawValue } ?? [],
                  "fileObjectsReadable": board.canReadObject(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true])])
    } else if mode == "inspect" {
        try emit(["operation": "inspect-types-only", "types": board.types?.map { $0.rawValue } ?? [],
                  "fileObjectsReadable": board.canReadObject(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true])])
    } else { throw ProbeError("Use write NETWORK_URL, verify, or inspect") }
} catch {
    fputs("XVC native control: \(error)\n", stderr)
    exit(1)
}
