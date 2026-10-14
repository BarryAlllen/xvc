// Diagnostic: inspect only the explicitly selected test file's clipboard item.
import AppKit
import Foundation
import CryptoKit

func sha(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}
func jsonValue(_ value: Any) -> Any {
    if let data = value as? Data {
        return ["kind": "Data", "bytes": data.count,
                "hexPrefix": data.prefix(64).map { String(format: "%02x", $0) }.joined(),
                "sha256": sha(data)]
    }
    if let date = value as? Date { return ISO8601DateFormatter().string(from: date) }
    if let values = value as? [Any] { return values.map(jsonValue) }
    if let values = value as? [String: Any] { return values.mapValues(jsonValue) }
    if value is String || value is NSNumber { return value }
    return String(describing: value)
}
func describe(_ data: Data) -> [String: Any] {
    var result: [String: Any] = ["bytes": data.count, "sha256": sha(data),
        "hexPrefix": data.prefix(64).map { String(format: "%02x", $0) }.joined(separator: " ")]
    var format = PropertyListSerialization.PropertyListFormat.binary
    if let plist = try? PropertyListSerialization.propertyList(from: data, options: [], format: &format) {
        result["encoding"] = format == .binary ? "binary-plist" : format == .xml ? "xml-plist" : "openstep-plist"
        result["propertyList"] = jsonValue(plist)
    } else if let text = String(data: data, encoding: .utf8),
              !text.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) && ![9, 10, 13].contains($0.value) }) {
        result["encoding"] = "utf8"
        result["text"] = String(text.prefix(4096))
    } else { result["encoding"] = "binary" }
    return result
}
func emit(_ value: [String: Any]) throws {
    let data = try JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys])
    print(String(decoding: data, as: UTF8.self))
}

do {
    guard CommandLine.arguments.count == 3 else {
        throw NSError(domain: "XVC", code: 1, userInfo: [NSLocalizedDescriptionKey: "Use inspect or write-url followed by the explicit test file path"])
    }
    let mode = CommandLine.arguments[1]
    let expected = URL(fileURLWithPath: CommandLine.arguments[2]).standardizedFileURL
    let board = NSPasteboard.general
    if mode == "write-url" {
        let item = NSPasteboardItem()
        guard item.setString(expected.absoluteString, forType: .fileURL) else {
            throw NSError(domain: "XVC", code: 2, userInfo: [NSLocalizedDescriptionKey: "Cannot prepare file URL item"])
        }
        board.clearContents()
        guard board.writeObjects([item]) else {
            throw NSError(domain: "XVC", code: 3, userInfo: [NSLocalizedDescriptionKey: "File URL clipboard write failed"])
        }
    } else if mode != "inspect" {
        throw NSError(domain: "XVC", code: 4, userInfo: [NSLocalizedDescriptionKey: "Unknown mode"])
    }
    let start = board.changeCount
    let urls = (board.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL]) ?? []
    guard urls.count == 1, urls[0].standardizedFileURL == expected else {
        try emit(["refused": true, "reason": "Clipboard is not the one explicitly allowed test file; no other representations inspected", "availableTypes": board.types?.map { $0.rawValue } ?? []])
        exit(2)
    }
    let items: [[String: Any]] = (board.pasteboardItems ?? []).enumerated().map { index, item in
        let representations: [[String: Any]] = item.types.map { type in
            var row: [String: Any] = ["type": type.rawValue]
            if let data = item.data(forType: type) { row.merge(describe(data)) { _, new in new } }
            else { row["unavailable"] = true }
            return row
        }
        return ["index": index, "representations": representations]
    }
    let globalRepresentations: [[String: Any]] = (board.types ?? []).map { type in
        var row: [String: Any] = ["type": type.rawValue]
        if let data = board.data(forType: type) { row.merge(describe(data)) { _, new in new } }
        else { row["unavailable"] = true }
        if let plist = board.propertyList(forType: type) { row["systemDecodedPropertyList"] = jsonValue(plist) }
        return row
    }
    try emit(["mode": mode, "expectedFile": expected.path, "readFileURLs": urls.map { $0.absoluteString },
              "changeCountBefore": start, "changeCountAfter": board.changeCount,
              "stable": start == board.changeCount,
              "availableTypes": board.types?.map { $0.rawValue } ?? [], "items": items,
              "globalRepresentations": globalRepresentations,
              "fileObjectsReadable": board.canReadObject(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true])])
} catch {
    fputs("Finder clipboard probe: \(error)\n", stderr)
    exit(1)
}
