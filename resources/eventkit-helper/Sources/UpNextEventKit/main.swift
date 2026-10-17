import EventKit
import Foundation

/// Newline-delimited JSON on stdio. One request in, one reply out, plus
/// unsolicited `{"event":"changed"}` when the store changes.
///
/// stdout is the protocol channel: a stray line is a parse failure on the
/// other side, so nothing is ever printed here that the protocol does not
/// define. `--probe` is the one exception and it exits immediately after.

let store = CalendarStore()
let encoder = JSONEncoder()
let decoder = JSONDecoder()
let outputQueue = DispatchQueue(label: "uk.co.upnextapp.eventkit.output")

func emit(_ line: String) {
    outputQueue.sync {
        FileHandle.standardOutput.write(Data("\(line)\n".utf8))
    }
}

func emitResult<T: Encodable>(id: Int, result: T) {
    guard let data = try? encoder.encode(Reply(id: id, ok: true, result: result)),
          let line = String(data: data, encoding: .utf8) else {
        emitError(id: id, kind: "store_failure")
        return
    }
    emit(line)
}

func emitError(id: Int, kind: String) {
    emit("{\"id\":\(id),\"ok\":false,\"error\":{\"kind\":\"\(kind)\"}}")
}

func parseDate(_ value: String?) throws -> Date {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let value else {
        throw HelperError.badRequest
    }
    if let date = formatter.date(from: value) {
        return date
    }
    formatter.formatOptions = [.withInternetDateTime]
    guard let date = formatter.date(from: value) else {
        throw HelperError.badRequest
    }
    return date
}

func authorize() async -> String {
    let status = EKEventStore.authorizationStatus(for: .event)
    switch status {
    case .fullAccess:
        return "granted"
    case .denied:
        return "denied"
    case .restricted:
        return "restricted"
    case .writeOnly:
        return "writeOnly"
    default:
        let granted = (try? await store.store.requestFullAccessToEvents()) ?? false
        return granted ? "granted" : "denied"
    }
}

func handle(_ request: Request) async {
    do {
        switch request.op {
        case "authorize":
            let status = await authorize()
            emitResult(id: request.id, result: AuthorizationPayload(status: status))
        case "sources":
            emitResult(id: request.id, result: store.sources())
        case "calendars":
            guard let sourceId = request.sourceId else {
                throw HelperError.badRequest
            }
            emitResult(id: request.id, result: try store.calendars(sourceId: sourceId))
        case "events":
            guard let sourceId = request.sourceId else {
                throw HelperError.badRequest
            }
            let events = try store.events(
                sourceId: sourceId,
                calendarIds: request.calendarIds ?? [],
                start: try parseDate(request.start),
                end: try parseDate(request.end)
            )
            emitResult(id: request.id, result: events)
        default:
            throw HelperError.badRequest
        }
    } catch let error as HelperError {
        emitError(id: request.id, kind: error.kind)
    } catch {
        emitError(id: request.id, kind: "store_failure")
    }
}

if CommandLine.arguments.contains("--probe") {
    // Reads the status, never requests it: a prompt here would be attributed
    // to whatever shell ran the probe, not to the app. Printed because a
    // probe that says nothing cannot be told apart from one that died.
    print("authorization: \(EKEventStore.authorizationStatus(for: .event).rawValue)")
    for source in store.sources() {
        let calendars = (try? store.calendars(sourceId: source.id)) ?? []
        print("\(source.title) [\(source.id)] — \(calendars.count) calendars")
    }
    exit(0)
}

NotificationCenter.default.addObserver(
    forName: .EKEventStoreChanged,
    object: store.store,
    queue: nil
) { _ in
    emit("{\"event\":\"changed\"}")
}

DispatchQueue.global(qos: .userInitiated).async {
    while let line = readLine(strippingNewline: true) {
        guard let data = line.data(using: .utf8),
              let request = try? decoder.decode(Request.self, from: data) else {
            continue
        }
        Task { await handle(request) }
    }
    exit(0)
}

RunLoop.main.run()
