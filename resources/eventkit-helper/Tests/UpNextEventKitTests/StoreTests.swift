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

    // MARK: - authorization

    func testASettledStatusIsReportedAsItself() {
        XCTAssertEqual(authorizationName(of: .fullAccess), "granted")
        XCTAssertEqual(authorizationName(of: .denied), "denied")
        XCTAssertEqual(authorizationName(of: .restricted), "restricted")
        XCTAssertEqual(authorizationName(of: .writeOnly), "writeOnly")
    }

    /// Nothing has been settled yet, so there is nothing to report: the caller
    /// has to ask before it has an answer.
    func testNotDeterminedHasNoSettledName() {
        XCTAssertNil(authorizationName(of: .notDetermined))
    }

    func testAGrantedRequestIsGranted() {
        XCTAssertEqual(
            authorizationOutcome(granted: true, statusAfterRequest: .fullAccess),
            "granted"
        )
    }

    /// The whole point of this one. A request that could not be made — it threw,
    /// or came back false without moving the status off `.notDetermined` — is
    /// not the user saying no. Reporting it as `denied` sent them to a System
    /// Settings pane where nothing was wrong and nothing could be fixed.
    func testAPromptThatNeverAppearedIsNotADenial() {
        let outcome = authorizationOutcome(granted: false, statusAfterRequest: .notDetermined)

        XCTAssertEqual(outcome, "promptUnavailable")
        XCTAssertNotEqual(outcome, "denied")
    }

    /// And the other half: a real Deny does move the status, so it is still
    /// reported as the denial it is.
    func testARefusedPromptIsADenial() {
        XCTAssertEqual(authorizationOutcome(granted: false, statusAfterRequest: .denied), "denied")
    }

    func testAStatusSettledDuringTheRequestIsReportedAsItself() {
        XCTAssertEqual(
            authorizationOutcome(granted: false, statusAfterRequest: .restricted),
            "restricted"
        )
        XCTAssertEqual(
            authorizationOutcome(granted: false, statusAfterRequest: .writeOnly),
            "writeOnly"
        )
    }

    /// `eventKitAuthorizationSchema`'s status enum, member for member. A name
    /// this side invents and the other side has never heard of fails the parse
    /// of the whole reply, and the sign-in with it.
    func testAuthorizationNamesMatchTheSchema() {
        XCTAssertEqual(
            authorizationStatusNames,
            ["granted", "denied", "restricted", "writeOnly", "promptUnavailable"]
        )
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

    /// Case-insensitively, as the Finder orders things: `home` belongs
    /// between `Birthdays` and `Work`, not exiled below every capitalised
    /// name as a byte-wise sort would put it.
    func testCalendarsComeBackInTitleOrder() {
        let store = EKEventStore()
        let titles = ["Work", "Birthdays", "home", "Allotment"]
        let calendars = Set(titles.map { title -> EKCalendar in
            let calendar = EKCalendar(for: .event, eventStore: store)
            calendar.title = title
            return calendar
        })

        let sorted = sortedForDisplay(calendars).map(\.title)

        XCTAssertEqual(sorted, ["Allotment", "Birthdays", "home", "Work"])
    }

    /// Numeric-aware too, so `Term 10` follows `Term 9` rather than `Term 1`.
    func testCalendarsSortNumbersInNumericOrder() {
        let store = EKEventStore()
        let titles = ["Term 10", "Term 2", "Term 1"]
        let calendars = Set(titles.map { title -> EKCalendar in
            let calendar = EKCalendar(for: .event, eventStore: store)
            calendar.title = title
            return calendar
        })

        XCTAssertEqual(sortedForDisplay(calendars).map(\.title), ["Term 1", "Term 2", "Term 10"])
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

    // MARK: - selectedCalendars

    private func calendar(titled title: String) -> EKCalendar {
        let calendar = EKCalendar(for: .event, eventStore: EKEventStore())
        calendar.title = title
        return calendar
    }

    /// The whole point of this one. An empty selection is the user having
    /// unticked every box, and this app's promise is that it reads only what
    /// the user picked — so it reads nothing, rather than everything.
    func testAnEmptySelectionSelectsNothing() {
        let all = [calendar(titled: "Home"), calendar(titled: "Work")]

        XCTAssertTrue(selectedCalendars(from: all, calendarIds: []).isEmpty)
    }

    func testOnlyTheNamedCalendarsAreSelected() {
        let home = calendar(titled: "Home")
        let work = calendar(titled: "Work")

        let selected = selectedCalendars(from: [home, work], calendarIds: [work.calendarIdentifier])

        XCTAssertEqual(selected.map(\.title), ["Work"])
    }

    /// A stale identifier — a calendar deleted in Calendar.app since the user
    /// picked it — selects nothing extra, and in particular does not fall
    /// back to the whole source.
    func testIdentifiersThatMatchNothingSelectNothing() {
        let all = [calendar(titled: "Home")]

        XCTAssertTrue(selectedCalendars(from: all, calendarIds: ["gone"]).isEmpty)
    }

    // MARK: - truncatedForWire

    func testShortTextIsLeftAlone() {
        XCTAssertEqual(truncatedForWire("Standup", to: maxEventTextLength), "Standup")
        XCTAssertNil(truncatedForWire(nil, to: maxEventTextLength))
        XCTAssertEqual(truncatedForWire("", to: maxEventTextLength), "")
    }

    func testTextAtTheLimitIsLeftAlone() {
        let value = String(repeating: "a", count: maxEventTextLength)
        XCTAssertEqual(truncatedForWire(value, to: maxEventTextLength), value)
    }

    /// The agenda-losing case: a pasted wall of text in one event's notes.
    func testOverLongTextIsCutToTheLimit() {
        let value = String(repeating: "a", count: 10_000)
        let truncated = truncatedForWire(value, to: maxEventTextLength)

        XCTAssertEqual(truncated?.utf16.count, maxEventTextLength)
        XCTAssertTrue(value.hasPrefix(truncated!))
    }

    /// The schema counts UTF-16 units, as JavaScript does, so a string of
    /// astral-plane characters is worth more than its character count.
    /// Counting characters alone would let an over-cap payload through.
    func testTruncationCountsUtf16NotCharacters() {
        let value = String(repeating: "👩‍👩‍👧‍👦", count: 2_000)
        let truncated = truncatedForWire(value, to: maxEventTextLength)

        XCTAssertLessThanOrEqual(truncated?.utf16.count ?? 0, maxEventTextLength)
        XCTAssertFalse(truncated?.isEmpty ?? true)
    }

    /// The bounds are the schemas' own numbers, not a shared house figure.
    /// If `EventKitProtocol.ts` moves, these are what have to move with it.
    func testBoundsMatchTheSchemaCaps() {
        XCTAssertEqual(maxEventTextLength, 4_000)
        XCTAssertEqual(maxEventUrlLength, 2_048)
        XCTAssertEqual(maxSourceTitleLength, 120)
        XCTAssertEqual(maxCalendarTitleLength, 4_000)
        XCTAssertEqual(maxExternalIdLength, 512)
    }

    /// The list caps, which until now had no Swift counterpart at all. An
    /// over-long list fails `safeParse` whole, becomes `EventKitError`
    /// `protocol`, is classified transient and retried forever: the account
    /// sits on Offline with nothing the user can do about it.
    func testListBoundsMatchTheSchemaCaps() {
        XCTAssertEqual(maxSourceCount, 50)
        XCTAssertEqual(maxCalendarCount, 500)
        XCTAssertEqual(maxEventCount, 2_000)
    }

    // MARK: - boundedForWire

    func testAListUnderItsCapIsLeftAlone() {
        XCTAssertEqual(boundedForWire([1, 2, 3], to: 10), [1, 2, 3])
        XCTAssertEqual(boundedForWire([Int](), to: 10), [])
    }

    /// The cap is inclusive in the schema, so a list of exactly the cap is
    /// valid and must come through whole.
    func testAListAtItsCapIsLeftAlone() {
        let items = Array(0..<10)
        XCTAssertEqual(boundedForWire(items, to: 10), items)
    }

    func testAnOverLongListIsCutToItsCap() {
        XCTAssertEqual(boundedForWire(Array(0..<25), to: 10), Array(0..<10))
    }

    // MARK: - earliestForWire

    private func event(startingAt secondsSinceEpoch: TimeInterval, in store: EKEventStore) -> EKEvent {
        let event = EKEvent(eventStore: store)
        event.startDate = Date(timeIntervalSince1970: secondsSinceEpoch)
        return event
    }

    /// Under the cap nothing is sorted: the widget sorts downstream, and
    /// paying for a sort on every ordinary day would buy nothing.
    func testEventsUnderTheCapAreNotReordered() {
        let store = EKEventStore()
        let later = event(startingAt: 200, in: store)
        let earlier = event(startingAt: 100, in: store)

        let kept = earliestForWire([later, earlier], to: 10)

        XCTAssertEqual(kept.map(\.startDate), [later.startDate, earlier.startDate])
    }

    /// Over the cap something has to go, and for a widget showing today the
    /// defensible something is the far end of the day, not whatever order
    /// `events(matching:)` happened to return.
    func testOverflowingEventsKeepTheEarliest() {
        let store = EKEventStore()
        let events = (0..<10).reversed().map { event(startingAt: TimeInterval($0) * 60, in: store) }

        let kept = earliestForWire(events, to: 3)

        XCTAssertEqual(kept.map(\.startDate), [0, 60, 120].map { Date(timeIntervalSince1970: $0) })
    }

    /// A calendar title is capped far more loosely than a source's, but the
    /// failure mode is the same: the whole list, not the one calendar.
    func testOverLongCalendarTitleIsCutToItsOwnCap() {
        let value = String(repeating: "a", count: maxCalendarTitleLength + 500)
        XCTAssertEqual(
            truncatedForWire(value, to: maxCalendarTitleLength)?.utf16.count,
            maxCalendarTitleLength
        )
    }

    // MARK: - sourceTitleForWire

    func testOrdinarySourceTitlesSurviveIntact() {
        XCTAssertEqual(sourceTitleForWire("iCloud"), "iCloud")
        XCTAssertEqual(sourceTitleForWire("On My Mac"), "On My Mac")
    }

    /// 120, not 4,000: a source's cap is 33 times tighter than an event's,
    /// and an Exchange account description clears it easily.
    func testOverLongSourceTitleIsCutToItsOwnCap() {
        let value = String(repeating: "a", count: 500)
        let title = sourceTitleForWire(value)

        XCTAssertEqual(title.utf16.count, maxSourceTitleLength)
        XCTAssertTrue(value.hasPrefix(title))
    }

    func testSourceTitleAtTheCapSurvivesIntact() {
        let value = String(repeating: "a", count: maxSourceTitleLength)
        XCTAssertEqual(sourceTitleForWire(value), value)
    }

    /// `min(1)` is the other half of the schema, and truncation cannot help
    /// here: an empty title needs something put in its place.
    func testEmptySourceTitleGetsAFallback() {
        XCTAssertEqual(sourceTitleForWire(""), untitledSourceLabel)
        XCTAssertFalse(untitledSourceLabel.isEmpty)
    }

    /// Blank, not merely empty. A title of spaces satisfies `min(1)`, which
    /// measures length, and still shows the user nothing.
    func testBlankSourceTitleGetsAFallback() {
        XCTAssertEqual(sourceTitleForWire("   "), untitledSourceLabel)
        XCTAssertEqual(sourceTitleForWire("\n\t "), untitledSourceLabel)
    }

    func testTheFallbackLabelItselfFitsTheCap() {
        XCTAssertLessThanOrEqual(untitledSourceLabel.utf16.count, maxSourceTitleLength)
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
        let padding = String(repeating: "a", count: maxEventUrlLength - "https://example.com/".utf16.count)
        let url = "https://example.com/\(padding)"

        XCTAssertEqual(url.utf16.count, maxEventUrlLength)
        XCTAssertEqual(urlForWire(url), url)
    }

    func testUrlJustUnderTheCapSurvivesIntact() {
        let padding = String(repeating: "a", count: maxEventUrlLength - "https://example.com/".utf16.count - 1)
        let url = "https://example.com/\(padding)"

        XCTAssertEqual(url.utf16.count, maxEventUrlLength - 1)
        XCTAssertEqual(urlForWire(url), url)
    }

    /// Dropped, not trimmed: a trimmed URL is a broken link that fails the
    /// allowlist check silently, where null lets the mapper look elsewhere.
    func testOverLongUrlBecomesNull() {
        let url = "https://example.com/\(String(repeating: "a", count: maxEventUrlLength))"

        XCTAssertGreaterThan(url.utf16.count, maxEventUrlLength)
        XCTAssertNil(urlForWire(url))
    }

    /// Under the cap by character count, over it by the UTF-16 count the
    /// schema actually applies. Measuring characters would let this through.
    func testUrlLengthIsMeasuredInUtf16() {
        let url = "https://example.com/\(String(repeating: "𝄞", count: maxEventUrlLength / 2))"

        XCTAssertLessThan(url.count, maxEventUrlLength)
        XCTAssertGreaterThan(url.utf16.count, maxEventUrlLength)
        XCTAssertNil(urlForWire(url))
    }
}
