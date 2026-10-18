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

/// `eventKitEventSchema.externalId`. The one bounded field that used to go
/// out raw.
let maxExternalIdLength = 512

/*
 * The list caps, which bound the arrays rather than the scalars inside them.
 *
 * Capped here rather than raised or removed on the Zod side, because the
 * three outcomes are not symmetrical. An over-long list fails `safeParse` as
 * a whole, arrives as `EventKitError('protocol')`, is classified transient
 * and retried on every tick: the account sits on "Offline" forever and no
 * action available to the user changes that. Truncating costs the far end of
 * a list nobody can read to the bottom of; the alternative costs the whole
 * account, permanently. Dropping the caps instead would give up a bound at a
 * process boundary to make room for volumes no real Mac produces.
 *
 * None of the three is reachable in ordinary use: the sync window is a single
 * local day, and a widget showing today cannot usefully show two thousand
 * events. The TypeScript side logs a count when a list arrives at exactly its
 * cap, so a truncation that does happen is not silent.
 */

/// `eventKitSourceListSchema`.
let maxSourceCount = 50

/// `eventKitCalendarListSchema`.
let maxCalendarCount = 500

/// `eventKitEventListSchema`.
let maxEventCount = 2_000

/// Stands in for a source whose title is empty or blank, which
/// `eventKitSourceSchema.title`'s `min(1)` would otherwise reject, taking
/// every other account down with it. Named for what the user is looking at
/// in the settings list: one of their calendar accounts.
let untitledSourceLabel = "Untitled account"

/*
 * The answers an `authorize` reply may carry. These are the members of
 * `eventKitAuthorizationSchema`'s status enum and nothing else: a name
 * invented here that the other side has never heard of fails the parse of the
 * whole reply, and the sign-in with it.
 */
let authorizationGranted = "granted"
let authorizationDenied = "denied"
let authorizationRestricted = "restricted"
let authorizationWriteOnly = "writeOnly"

/// macOS could not be asked at all. The request threw, or came back false
/// while leaving the status at `.notDetermined` — which is what an app bundle
/// without `NSCalendarsFullAccessUsageDescription` does, because macOS will
/// not show a calendar prompt for one.
///
/// Its own name because it is not a denial. Nobody was asked anything, no
/// System Settings toggle changes it, and reporting it as `denied` told the
/// user they had refused something they were never offered.
let authorizationPromptUnavailable = "promptUnavailable"

/// Asserted against the schema's enum by `StoreTests`.
let authorizationStatusNames: Set<String> = [
    authorizationGranted,
    authorizationDenied,
    authorizationRestricted,
    authorizationWriteOnly,
    authorizationPromptUnavailable,
]

/// The name for a status the store has already settled on, or nil when it has
/// settled on nothing yet and has to be asked.
func authorizationName(of status: EKAuthorizationStatus) -> String? {
    switch status {
    case .fullAccess: return authorizationGranted
    case .denied: return authorizationDenied
    case .restricted: return authorizationRestricted
    case .writeOnly: return authorizationWriteOnly
    default: return nil
    }
}

/// What to report once the request has been made.
///
/// The status read *after* the request is what tells a refusal from a prompt
/// that never appeared: a real Deny moves the status to `.denied`, while a
/// request macOS would not put on screen leaves it at `.notDetermined`. A
/// request that threw arrives here as `granted: false` for the same reason —
/// the error says the request failed, the status says what the user chose.
func authorizationOutcome(granted: Bool, statusAfterRequest: EKAuthorizationStatus) -> String {
    guard !granted else {
        return authorizationGranted
    }
    return authorizationName(of: statusAfterRequest) ?? authorizationPromptUnavailable
}

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

/// Bounds a list so one implausible length cannot fail the parse of the
/// whole frame. Order is the caller's: these lists are already in the order
/// the user will see them.
func boundedForWire<T>(_ items: [T], to limit: Int) -> [T] {
    guard items.count > limit else {
        return items
    }
    return Array(items.prefix(limit))
}

/// The event list's own bound. Over the cap something has to be dropped, and
/// for a widget showing today the defensible something is the far end of the
/// day rather than whatever order `events(matching:)` returned. Sorted only
/// when the cap actually bites, so an ordinary day pays nothing for it.
func earliestForWire(_ events: [EKEvent], to limit: Int) -> [EKEvent] {
    guard events.count > limit else {
        return events
    }
    let sorted = events.sorted {
        ($0.startDate ?? .distantFuture) < ($1.startDate ?? .distantFuture)
    }
    return Array(sorted.prefix(limit))
}

/// Narrows a source's calendars to the ones the user picked.
///
/// An empty selection means none of them. It is tempting to read it as "not
/// configured, so show everything", and this helper used to; but the only way
/// to arrive here with an empty list is the user unticking every box in the
/// calendar picker, and an app whose promise is that you choose what it reads
/// must fail closed. Showing every event in the source while the pane reads
/// "0 calendars selected" is the opposite of that promise.
func selectedCalendars(from all: [EKCalendar], calendarIds: [String]) -> [EKCalendar] {
    guard !calendarIds.isEmpty else {
        return []
    }
    return all.filter { calendarIds.contains($0.calendarIdentifier) }
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
        let withCalendars = store.sources.filter { !$0.calendars(for: .event).isEmpty }
        return boundedForWire(withCalendars, to: maxSourceCount)
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
        let calendars = boundedForWire(eventCalendars(of: source), to: maxCalendarCount)
        return calendars.map { calendar in
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
        let wanted = selectedCalendars(from: eventCalendars(of: source), calendarIds: calendarIds)
        if wanted.isEmpty {
            return []
        }

        let predicate = store.predicateForEvents(withStart: start, end: end, calendars: wanted)
        let timeZone = TimeZone.current

        // `startDate`, `endDate` and `calendar` import as implicitly unwrapped
        // optionals and are nil on an event the store failed to materialise.
        // Dropped one at a time rather than force-unwrapped: one malformed
        // event must not take the rest of the window down with it.
        let matching = earliestForWire(store.events(matching: predicate), to: maxEventCount)
        return matching.compactMap { event in
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
                externalId: truncatedForWire(
                    event.calendarItemExternalIdentifier,
                    to: maxExternalIdLength
                ) ?? "",
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
