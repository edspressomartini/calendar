import EventKit
import Foundation

/*
 * The pure half of the mapping, kept out of `CalendarStore` so the tests can
 * reach it without an `EKEventStore` and without the calendar permission.
 */

/*
 * Every bound below is the cap its own schema in `EventKitProtocol.ts`
 * applies to that exact field, matched rather than undercut. An earlier
 * version carried 50% headroom under the event cap, which was indefensible
 * on two counts. `truncatedForWire` trims downwards until the count fits, so
 * it cannot overshoot and has no need of a margin; and the smaller window
 * worked against us, because the mapper falls back to scanning `notes` for a
 * link when an over-long `url` has been dropped, so halving `notes` narrowed
 * the very fallback that decision depends on. A bound that is not the
 * schema's own number is a second, undocumented contract.
 *
 * All of them are counted in UTF-16 code units, because that is what
 * JavaScript's `String.length` counts and therefore what Zod's `.max()`
 * applies. Swift's `String.count` counts grapheme clusters, and a cluster can
 * be worth many units.
 */

/// `eventKitEventSchema`: `title`, `location` and `notes`.
let maxEventTextLength = 4_000

/// `eventKitEventSchema.url`.
let maxEventUrlLength = 2_048

/// `eventKitSourceSchema.title`. Far tighter than the rest, and the only one
/// with a `min(1)` to satisfy as well.
let maxSourceTitleLength = 120

/// `eventKitCalendarSchema.title`.
let maxCalendarTitleLength = 4_000

/// Stands in for a source whose title is empty or blank, which
/// `eventKitSourceSchema.title`'s `min(1)` would otherwise reject, taking
/// every other account down with it. Named for what the user is looking at
/// in the settings list: one of their calendar accounts.
let untitledSourceLabel = "Untitled account"

func isoString(from date: Date, timeZone: TimeZone) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    formatter.timeZone = timeZone
    return formatter.string(from: date)
}

/// Bounds a free-text field so one over-long value cannot fail the parse of
/// the whole array and cost the user their agenda. This is about keeping the
/// frame parseable; the 200-character display truncation stays in the
/// TypeScript mapper, as it does on the Google path.
func truncatedForWire(_ value: String?, to limit: Int) -> String? {
    guard let value else {
        return nil
    }
    guard value.utf16.count > limit else {
        return value
    }
    var trimmed = String(value.prefix(limit))
    // A grapheme can be worth more than one UTF-16 unit, so dropping to
    // `limit` characters is not yet a guarantee about the count the schema
    // will apply. Trimming downwards is also why no headroom is needed.
    while trimmed.utf16.count > limit, !trimmed.isEmpty {
        trimmed.removeLast()
    }
    return trimmed
}

/// Satisfies both halves of `min(1).max(120)`. Blank counts as untitled, not
/// just empty: a title of spaces would pass `min(1)`, which measures length,
/// and still show the user nothing.
func sourceTitleForWire(_ title: String) -> String {
    guard !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        return untitledSourceLabel
    }
    return truncatedForWire(title, to: maxSourceTitleLength) ?? untitledSourceLabel
}

/// Drops an over-long URL rather than trimming it. A trimmed URL is a broken
/// link that would reach the allowlist check and fail there silently; null is
/// honest, and leaves the mapper free to find a usable link in the location
/// or the notes instead.
func urlForWire(_ value: String?) -> String? {
    guard let value, value.utf16.count <= maxEventUrlLength else {
        return nil
    }
    return value
}

/// `calendars(for:)` hands back a `Set`, whose order differs run to run.
/// Sorted so the list the user picks from, and the default this falls back
/// to, stay put between calls. `localizedStandardCompare` is the Finder's
/// ordering: case- and diacritic-insensitive, and numeric-aware, so a
/// lowercase calendar name does not sort below every capitalised one.
func sortedForDisplay(_ calendars: Set<EKCalendar>) -> [EKCalendar] {
    return calendars.sorted {
        let byTitle = $0.title.localizedStandardCompare($1.title)
        guard byTitle == .orderedSame else {
            return byTitle == .orderedAscending
        }
        return $0.calendarIdentifier < $1.calendarIdentifier
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
                    title: sourceTitleForWire(source.title),
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
                title: truncatedForWire(calendar.title, to: maxCalendarTitleLength) ?? "",
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
                title: truncatedForWire(event.title, to: maxEventTextLength) ?? "",
                start: isoString(from: startDate, timeZone: timeZone),
                end: isoString(from: endDate, timeZone: timeZone),
                isAllDay: event.isAllDay,
                url: urlForWire(event.url?.absoluteString),
                location: truncatedForWire(event.location, to: maxEventTextLength),
                notes: truncatedForWire(event.notes, to: maxEventTextLength),
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
