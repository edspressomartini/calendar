import XCTest
@testable import UpNextEventKit

final class StoreTests: XCTestCase {
    func testFormatsWithOffset() {
        let date = Date(timeIntervalSince1970: 1_792_227_600)
        let formatted = isoString(from: date, timeZone: TimeZone(identifier: "Europe/London")!)
        XCTAssertEqual(formatted, "2026-10-17T10:00:00+01:00")
    }

    func testAllDayEndIsExclusiveMidnight() {
        let calendar = Calendar(identifier: .gregorian)
        var components = DateComponents()
        components.year = 2026
        components.month = 10
        components.day = 17
        let start = calendar.date(from: components)!
        let end = allDayEnd(start: start, days: 1, calendar: calendar)
        XCTAssertEqual(calendar.component(.day, from: end), 18)
    }

    func testSurvivesADstChange() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Europe/London")!
        var components = DateComponents()
        components.year = 2026
        components.month = 10
        components.day = 24
        let start = calendar.date(from: components)!
        let end = allDayEnd(start: start, days: 2, calendar: calendar)
        XCTAssertEqual(calendar.component(.day, from: end), 26)
    }
}
