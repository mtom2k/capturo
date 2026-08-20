// Capturo's macOS text-recognition helper.
//
// Windows runs Copy text through native/capturo-capture, which already owns desktop
// duplication and clipboard work and answers "ocr-png" with Windows.Media.Ocr. macOS needs
// none of that machinery -- captures come from desktopCapturer and the clipboard from
// Electron -- but it has no OCR API reachable from Node, so this sidecar supplies the one
// missing piece and nothing else. See D-036.
//
// Protocol (identical to the Windows helper's OCR request, so src/main/capture-helper.ts
// drives either one unchanged): one request per line on stdin,
//
//     "ocr-png\t<base64Png>"
//
// and one line of JSON per request on stdout, in order:
//
//     {"ok":true,"text":"..."} | {"ok":false,"stage":"image|ocr|request"}
//
// Diagnostics, mirroring capturo-capture.exe:
//     --ocr <path>   recognize one file and print the same JSON, then exit
//     --languages    print the recognition languages this machine supports
//
// Recognized text is written to stdout and nowhere else: never logged, never written to a
// file, never sent anywhere. Image bytes arrive on a private pipe and stay in memory.

import Foundation
import Vision
import CoreGraphics
import ImageIO

// MARK: - Output

// Every response is a single line of JSON. JSONSerialization escapes the recognized text,
// so a newline inside a result can never be mistaken for the end of the response.
func emit(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object, options: []) else {
        FileHandle.standardOutput.write(Data(#"{"ok":false,"stage":"encode"}"#.utf8))
        FileHandle.standardOutput.write(Data("\n".utf8))
        return
    }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
}

func emitFailure(_ stage: String) {
    emit(["ok": false, "stage": stage])
}

// MARK: - Recognition

// The languages Vision can recognize on this machine, in the user's own preference order.
// This is the counterpart of the Windows helper's OcrEngine::TryCreateFromUserProfileLanguages.
// Unlike Windows there is nothing to install: the models ship with macOS, so the "language"
// failure stage the Windows helper can report has no equivalent here and is never emitted.
func preferredRecognitionLanguages() -> [String] {
    let supported = (try? VNRecognizeTextRequest().supportedRecognitionLanguages()) ?? []
    guard !supported.isEmpty else { return [] }

    // Locale.preferredLanguages yields tags like "en-GB" that Vision may not list verbatim,
    // so match on the language subtag and keep Vision's own regional spelling.
    var chosen: [String] = []
    for preferred in Locale.preferredLanguages {
        let base = preferred.split(separator: "-").first.map(String.init) ?? preferred
        for candidate in supported where !chosen.contains(candidate) {
            let candidateBase = candidate.split(separator: "-").first.map(String.init) ?? candidate
            if candidate == preferred || candidateBase == base { chosen.append(candidate) }
        }
    }
    // Vision falls back to its own default when handed an empty list, so an unsupported
    // system language degrades to recognition rather than to failure.
    return chosen
}

let recognitionLanguages = preferredRecognitionLanguages()

func recognize(png: Data) {
    guard let source = CGImageSourceCreateWithData(png as CFData, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        return emitFailure("image")
    }

    let request = VNRecognizeTextRequest()
    // .accurate is the neural recognizer. Copy text runs on a user's explicit request and a
    // single selection, so recognition quality matters far more than the millisecond or two
    // .fast would save.
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    if !recognitionLanguages.isEmpty { request.recognitionLanguages = recognitionLanguages }

    do {
        try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
    } catch {
        return emitFailure("ocr")
    }

    guard let observations = request.results else { return emitFailure("ocr") }

    // Windows.Media.Ocr returns OcrResult.Lines already in reading order. Vision does not:
    // it returns observations in no guaranteed order, in a normalized coordinate space whose
    // origin is bottom-left. Reading order is therefore reconstructed here -- top to bottom,
    // then left to right -- because the clipboard result is the whole point of the feature.
    //
    // The epsilon treats observations whose vertical extents are within one per cent of the
    // image height as the same visual line, so two words side by side are not ordered by a
    // sub-pixel difference in their baselines.
    let ordered = observations.sorted { first, second in
        let verticalDelta = first.boundingBox.maxY - second.boundingBox.maxY
        if abs(verticalDelta) > 0.01 { return verticalDelta > 0 }
        return first.boundingBox.minX < second.boundingBox.minX
    }

    let text = ordered.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
    emit(["ok": true, "text": text])
}

// MARK: - Input

// A Copy text request carries a whole screenshot as base64, so a single line can run to tens
// of megabytes. Swift's readLine() builds such a line one character at a time and becomes the
// slowest part of the request, so stdin is read in blocks and split on newlines here instead.
final class LineReader {
    private let handle = FileHandle.standardInput
    private var buffer = Data()
    private let newline = UInt8(ascii: "\n")

    func next() -> String? {
        while true {
            if let index = buffer.firstIndex(of: newline) {
                let line = buffer.subdata(in: buffer.startIndex..<index)
                buffer.removeSubrange(buffer.startIndex...index)
                return String(decoding: line, as: UTF8.self)
            }
            let chunk = handle.availableData
            if chunk.isEmpty {
                guard !buffer.isEmpty else { return nil }
                let line = buffer
                buffer.removeAll()
                return String(decoding: line, as: UTF8.self)
            }
            buffer.append(chunk)
        }
    }
}

func handle(line: String) {
    // A trailing CR is tolerated so the protocol behaves the same whichever side wrote it.
    let trimmed = line.hasSuffix("\r") ? String(line.dropLast()) : line
    guard let tab = trimmed.firstIndex(of: "\t") else { return emitFailure("request") }
    let verb = String(trimmed[trimmed.startIndex..<tab])
    let body = String(trimmed[trimmed.index(after: tab)...])
    guard verb == "ocr-png" else { return emitFailure("request") }
    guard let png = Data(base64Encoded: body), !png.isEmpty else { return emitFailure("image") }
    recognize(png: png)
}

// MARK: - Entry point

let arguments = Array(CommandLine.arguments.dropFirst())

if arguments.first == "--languages" {
    emit(["ok": true, "text": recognitionLanguages.joined(separator: ",")])
    exit(0)
}

if arguments.first == "--ocr" {
    guard arguments.count >= 2, let png = FileManager.default.contents(atPath: arguments[1]) else {
        emitFailure("image")
        exit(2)
    }
    recognize(png: png)
    exit(0)
}

if let unexpected = arguments.first {
    FileHandle.standardError.write(Data("unknown argument: \(unexpected)\n".utf8))
    exit(2)
}

let reader = LineReader()
while let line = reader.next() {
    if line.isEmpty { continue }
    handle(line: line)
}
