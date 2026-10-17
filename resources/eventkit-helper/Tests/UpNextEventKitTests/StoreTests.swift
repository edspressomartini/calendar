import EventKit
import XCTest
@testable import UpNextEventKit

final class StoreTests: XCTestCase {
    func testFormatsWithOffset() {
        let date = Date(timeIntervalSince1970: 1_792_227_600)
        let formatted = isoString(from: date, timeZone: TimeZone(identifier: "Europe/London")!)
        XCTAssertEqual(formatted, "2026-10-17T10:00:00+01:00")
    }

    // MARK: - statusName

    /// The whole point of this one: EventKit spells it `.canceled`, the wire
    /// spells it `cancelled`.
    func testCancelledCrossesTheWireWithTwoLs() {
        XCTAssertEqual(statusName(.canceled), "cancelled")
    }

    func testStatusNameCoversEveryCase() {
        XCTAssertEqual(statusName(.none), "none")
        XCTAssertEqual(statusName(.confirmed), "confirmed")
        XCTAssertEqual(statusName(.tentative), "tentative")
        XCTAssertEqual(statusName(.canceled), "cancelled")
    }

    /// A status EventKit might add later must still be a value the schema's
    /// enum accepts, rather than an unmapped raw name.
    func testUnknownStatusFallsBackToNone() {
        XCTAssertEqual(statusName(EKEventStatus(rawValue: 99) ?? .none), "none")
    }

    // MARK: - isDeclinedBySelf

    func testNotDeclinedWhenThereAreNoAttendees() {
        XCTAssertFalse(isDeclinedBySelf(attendees: nil))
        XCTAssertFalse(isDeclinedBySelf(attendees: []))
    }

    func testDeclinedWhenThisUserDeclined() {
        let attendees = [
            (isCurrentUser: false, status: EKParticipantStatus.accepted),
            (isCurrentUser: true, status: EKParticipantStatus.declined),
        ]
        XCTAssertTrue(isDeclinedBySelf(attendees: attendees))
    }

    /// Somebody else declining is not the user declining.
    func testNotDeclinedWhenSomebodyElseDeclined() {
        let attendees = [
            (isCurrentUser: false, status: EKParticipantStatus.declined),
            (isCurrentUser: true, status: EKParticipantStatus.accepted),
        ]
        XCTAssertFalse(isDeclinedBySelf(attendees: attendees))
    }

    func testNotDeclinedWhenThisUserHasNotReplied() {
        let attendees = [(isCurrentUser: true, status: EKParticipantStatus.pending)]
        XCTAssertFalse(isDeclinedBySelf(attendees: attendees))
    }

    // MARK: - sortedForDisplay

    func testCalendarsComeBackInTitleOrder() {
        let store = EKEventStore()
        let titles = ["Work", "Birthdays", "home", "Allotment"]
        let calendars = Set(titles.map { title -> EKCalendar in
            let calendar = EKCalendar(for: .event, eventStore: store)
            calendar.title = title
            return calendar
        })

        let sorted = sortedForDisplay(calendars).map(\.title)

        XCTAssertEqual(sorted, ["Allotment", "Birthdays", "Work", "home"])
    }

    /// Same titles, so the identifier is what settles it — and it has to
    /// settle it the same way every call, which is the point of sorting at all.
    func testOrderIsStableForDuplicateTitles() {
        let store = EKEventStore()
        let calendars = Set((0..<5).map { _ -> EKCalendar in
            let calendar = EKCalendar(for: .event, eventStore: store)
            calendar.title = "Shared"
            return calendar
        })

        let first = sortedForDisplay(calendars).map(\.calendarIdentifier)
        let second = sortedForDisplay(calendars).map(\.calendarIdentifier)

        XCTAssertEqual(first, second)
        XCTAssertEqual(first, first.sorted())
    }

    func testSortingAnEmptySetIsEmpty() {
        XCTAssertTrue(sortedForDisplay([]).isEmpty)
    }

    // MARK: - truncatedForWire

    func testShortTextIsLeftAlone() {
        XCTAssertEqual(truncatedForWire("Standup"), "Standup")
        XCTAssertNil(truncatedForWire(nil))
        XCTAssertEqual(truncatedForWire(""), "")
    }

    func testTextAtTheLimitIsLeftAlone() {
        let value = String(repeating: "a", count: maxWireTextLength)
        XCTAssertEqual(truncatedForWire(value)?.count, maxWireTextLength)
    }

    /// The agenda-losing case: a pasted wall of text in one event's notes.
    func testOverLongTextIsCutToTheLimit() {
        let value = String(repeating: "a", count: 10_000)
        let truncated = truncatedForWire(value)

        XCTAssertEqual(truncated?.utf16.count, maxWireTextLength)
        XCTAssertTrue(value.hasPrefix(truncated!))
    }

    /// The schema counts UTF-16 units, as JavaScript does, so a string of
    /// astral-plane characters is worth twice its character count. Counting
    /// characters alone would let a 4,000-unit payload through.
    func testTruncationCountsUtf16NotCharacters() {
        let value = String(repeating: "👩‍👩‍👧‍👦", count: 2_000)
        let truncated = truncatedForWire(value)

        XCTAssertLessThanOrEqual(truncated?.utf16.count ?? 0, maxWireTextLength)
        XCTAssertFalse(truncated?.isEmpty ?? true)
    }

    /// Comfortably inside `eventKitEventSchema`'s cap, which is the only
    /// number that actually matters.
    func testTruncationStaysUnderTheSchemaCap() {
        XCTAssertLessThan(maxWireTextLength, 4_000)
    }

    // MARK: - urlForWire

    func testOrdinaryUrlsSurviveIntact() {
        let url = "https://example.com/meet/abc-defg-hij?pwd=1234"
        XCTAssertEqual(urlForWire(url), url)
        XCTAssertNil(urlForWire(nil))
    }

    /// The cap is inclusive in the schema, so a URL of exactly the cap is
    /// still valid and must not be thrown away.
    func testUrlAtTheCapSurvivesIntact() {
        let padding = String(repeating: "a", count: maxWireUrlLength - "https://example.com/".utf16.count)
        let url = "https://example.com/\(padding)"

        XCTAssertEqual(url.utf16.count, maxWireUrlLength)
        XCTAssertEqual(urlForWire(url), url)
    }

    func testUrlJustUnderTheCapSurvivesIntact() {
        let padding = String(repeating: "a", count: maxWireUrlLength - "https://example.com/".utf16.count - 1)
        let url = "https://example.com/\(padding)"

        XCTAssertEqual(url.utf16.count, maxWireUrlLength - 1)
        XCTAssertEqual(urlForWire(url), url)
    }

    /// Dropped, not trimmed: a trimmed URL is a broken link that fails the
    /// allowlist check silently, where null lets the mapper look elsewhere.
    func testOverLongUrlBecomesNull() {
        let url = "https://example.com/\(String(repeating: "a", count: maxWireUrlLength))"

        XCTAssertGreaterThan(url.utf16.count, maxWireUrlLength)
        XCTAssertNil(urlForWire(url))
    }

    /// Under the cap by character count, over it by the UTF-16 count the
    /// schema actually applies. Measuring characters would let this through.
    func testUrlLengthIsMeasuredInUtf16() {
        let url = "https://example.com/\(String(repeating: "𝄞", count: maxWireUrlLength / 2))"

        XCTAssertLessThan(url.count, maxWireUrlLength)
        XCTAssertGreaterThan(url.utf16.count, maxWireUrlLength)
        XCTAssertNil(urlForWire(url))
    }
}
