import EventKit
import Foundation

/// Pure date helpers, separated from EventKit so they can be tested.
func isoString(from date: Date, timeZone: TimeZone) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    formatter.timeZone = timeZone
    return formatter.string(from: date)
}

func allDayEnd(start: Date, days: Int, calendar: Calendar) -> Date {
    return calendar.date(byAdding: .day, value: days, to: start) ?? start
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

        return store.events(matching: predicate).map { event in
            EventPayload(
                id: event.eventIdentifier ?? UUID().uuidString,
                calendarId: event.calendar.calendarIdentifier,
                externalId: event.calendarItemExternalIdentifier ?? "",
                title: event.title ?? "",
                start: isoString(from: event.startDate, timeZone: timeZone),
                end: isoString(from: event.endDate, timeZone: timeZone),
                isAllDay: event.isAllDay,
                url: event.url?.absoluteString,
                location: event.location,
                notes: event.notes,
                status: statusName(event.status),
                selfDeclined: isDeclinedBySelf(event)
            )
        }
    }

    /// `calendars(for:)` hands back a `Set`, whose order differs run to run.
    /// Sorted so the list the user picks from, and the default this falls
    /// back to, stay put between calls.
    private func eventCalendars(of source: EKSource) -> [EKCalendar] {
        return source.calendars(for: .event).sorted {
            ($0.title, $0.calendarIdentifier) < ($1.title, $1.calendarIdentifier)
        }
    }

    /// `cancelled` with two Ls: the wire spelling, not `EKEventStatus.canceled`.
    private func statusName(_ status: EKEventStatus) -> String {
        switch status {
        case .confirmed: return "confirmed"
        case .tentative: return "tentative"
        case .canceled: return "cancelled"
        default: return "none"
        }
    }

    private func isDeclinedBySelf(_ event: EKEvent) -> Bool {
        guard let attendees = event.attendees else {
            return false
        }
        return attendees.contains { $0.isCurrentUser && $0.participantStatus == .declined }
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
