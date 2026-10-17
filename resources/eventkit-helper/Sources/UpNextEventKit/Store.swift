import EventKit
import Foundation

/*
 * The pure half of the mapping, kept out of `CalendarStore` so the tests can
 * reach it without an `EKEventStore` and without the calendar permission.
 */

/// Well under `eventKitEventSchema`'s 4,000, which it counts in UTF-16 code
/// units as JavaScript does — hence the trim below rather than `prefix`.
let maxWireTextLength = 2_000

/// `eventKitEventSchema`'s own cap, matched exactly rather than undercut:
/// there is nothing to gain by rejecting a URL the schema would accept.
let maxWireUrlLength = 2_048

func isoString(from date: Date, timeZone: TimeZone) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    formatter.timeZone = timeZone
    return formatter.string(from: date)
}

/// Bounds a free-text field so one over-long event cannot fail the parse of
/// the whole array and cost the user their agenda. This is about keeping the
/// frame parseable; the 200-character display truncation stays in the
/// TypeScript mapper, as it does on the Google path.
func truncatedForWire(_ value: String?) -> String? {
    guard let value else {
        return nil
    }
    guard value.utf16.count > maxWireTextLength else {
        return value
    }
    var trimmed = String(value.prefix(maxWireTextLength))
    // A grapheme can be worth more than one UTF-16 unit, so dropping to
    // `maxWireTextLength` characters is not yet a guarantee about the count
    // the schema will apply.
    while trimmed.utf16.count > maxWireTextLength, !trimmed.isEmpty {
        trimmed.removeLast()
    }
    return trimmed
}

/// Drops an over-long URL rather than trimming it. A trimmed URL is a broken
/// link that would reach the allowlist check and fail there silently; null is
/// honest, and leaves the mapper free to find a usable link in the location
/// or the notes instead. Measured in UTF-16 units for the same reason as
/// `truncatedForWire`: that is what the schema counts.
func urlForWire(_ value: String?) -> String? {
    guard let value, value.utf16.count <= maxWireUrlLength else {
        return nil
    }
    return value
}

/// `calendars(for:)` hands back a `Set`, whose order differs run to run.
/// Sorted so the list the user picks from, and the default this falls back
/// to, stay put between calls.
func sortedForDisplay(_ calendars: Set<EKCalendar>) -> [EKCalendar] {
    return calendars.sorted {
        ($0.title, $0.calendarIdentifier) < ($1.title, $1.calendarIdentifier)
    }
}

/// `cancelled` with two Ls: the wire spelling, not `EKEventStatus.canceled`.
func statusName(_ status: EKEventStatus) -> String {
    switch status {
    case .confirmed: return "confirmed"
    case .tentative: return "tentative"
    case .canceled: return "cancelled"
    default: return "none"
    }
}

/// Takes the two fields it needs rather than the `EKParticipant`, which has
/// no public initialiser and so cannot be built in a test.
func isDeclinedBySelf(attendees: [(isCurrentUser: Bool, status: EKParticipantStatus)]?) -> Bool {
    guard let attendees else {
        return false
    }
    return attendees.contains { $0.isCurrentUser && $0.status == .declined }
}

struct CalendarStore {
    let store = EKEventStore()

    func sources() -> [SourcePayload] {
        return store.sources
            .filter { !$0.calendars(for: .event).isEmpty }
            .map { source in
                let calendars = eventCalendars(of: source)
                let fallback = store.defaultCalendarForNewEvents
                let preferred = calendars.first { $0.calendarIdentifier == fallback?.calendarIdentifier }
                return SourcePayload(
                    id: source.sourceIdentifier,
                    title: source.title,
                    defaultCalendarId: (preferred ?? calendars.first)?.calendarIdentifier
                )
            }
    }

    func calendars(sourceId: String) throws -> [CalendarPayload] {
        guard let source = store.sources.first(where: { $0.sourceIdentifier == sourceId }) else {
            throw HelperError.unknownSource
        }
        let defaultId = store.defaultCalendarForNewEvents?.calendarIdentifier
        return eventCalendars(of: source).map { calendar in
            CalendarPayload(
                id: calendar.calendarIdentifier,
                title: calendar.title,
                isDefault: calendar.calendarIdentifier == defaultId
            )
        }
    }

    func events(sourceId: String, calendarIds: [String], start: Date, end: Date) throws -> [EventPayload] {
        guard let source = store.sources.first(where: { $0.sourceIdentifier == sourceId }) else {
            throw HelperError.unknownSource
        }
        let all = eventCalendars(of: source)
        let wanted = calendarIds.isEmpty ? all : all.filter { calendarIds.contains($0.calendarIdentifier) }
        if wanted.isEmpty {
            return []
        }

        let predicate = store.predicateForEvents(withStart: start, end: end, calendars: wanted)
        let timeZone = TimeZone.current

        // `startDate`, `endDate` and `calendar` import as implicitly unwrapped
        // optionals and are nil on an event the store failed to materialise.
        // Dropped one at a time rather than force-unwrapped: one malformed
        // event must not take the rest of the window down with it.
        return store.events(matching: predicate).compactMap { event in
            guard let startDate = event.startDate,
                  let endDate = event.endDate,
                  let calendar = event.calendar else {
                return nil
            }
            let attendees = event.attendees?.map {
                (isCurrentUser: $0.isCurrentUser, status: $0.participantStatus)
            }
            return EventPayload(
                id: event.eventIdentifier ?? UUID().uuidString,
                calendarId: calendar.calendarIdentifier,
                externalId: event.calendarItemExternalIdentifier ?? "",
                title: truncatedForWire(event.title) ?? "",
                start: isoString(from: startDate, timeZone: timeZone),
                end: isoString(from: endDate, timeZone: timeZone),
                isAllDay: event.isAllDay,
                url: urlForWire(event.url?.absoluteString),
                location: truncatedForWire(event.location),
                notes: truncatedForWire(event.notes),
                status: statusName(event.status),
                selfDeclined: isDeclinedBySelf(attendees: attendees)
            )
        }
    }

    private func eventCalendars(of source: EKSource) -> [EKCalendar] {
        return sortedForDisplay(source.calendars(for: .event))
    }
}

enum HelperError: Error {
    case denied
    case restricted
    case writeOnly
    case unknownSource
    case badRequest
    case storeFailure

    var kind: String {
        switch self {
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .writeOnly: return "writeOnly"
        case .unknownSource: return "unknown_source"
        case .badRequest: return "bad_request"
        case .storeFailure: return "store_failure"
        }
    }
}
