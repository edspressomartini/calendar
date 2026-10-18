import XCTest
@testable import UpNextEventKit

/*
 * The other half of this protocol validates every message with a
 * `z.strictObject` it cannot see from here. An extra key is a parse failure
 * and so is a missing one, because `nullable()` is not `optional()`.
 *
 * These assert the exact key set and that absent values arrive as `null`,
 * which is the one mistake the Swift compiler will happily make for us:
 * a synthesised `Encodable` drops a nil key rather than writing it.
 */

final class ProtocolTests: XCTestCase {
    private func object(encoding value: some Encodable) throws -> [String: Any] {
        let data = try JSONEncoder().encode(value)
        let decoded = try JSONSerialization.jsonObject(with: data)
        return try XCTUnwrap(decoded as? [String: Any])
    }

    func testSourceKeepsNullDefaultCalendar() throws {
        let payload = SourcePayload(id: "src", title: "iCloud", defaultCalendarId: nil)
        let encoded = try object(encoding: payload)

        XCTAssertEqual(Set(encoded.keys), ["id", "title", "defaultCalendarId"])
        XCTAssertTrue(encoded["defaultCalendarId"] is NSNull)
    }

    func testCalendarMatchesTheSchema() throws {
        let payload = CalendarPayload(id: "cal", title: "Work", isDefault: true)
        let encoded = try object(encoding: payload)

        XCTAssertEqual(Set(encoded.keys), ["id", "title", "isDefault"])
        XCTAssertEqual(encoded["isDefault"] as? Bool, true)
    }

    func testEventKeepsNullOptionals() throws {
        let payload = EventPayload(
            id: "evt",
            calendarId: "cal",
            externalId: "ext",
            title: "Standup",
            start: "2026-10-17T10:00:00+01:00",
            end: "2026-10-17T10:15:00+01:00",
            isAllDay: false,
            url: nil,
            location: nil,
            notes: nil,
            status: "confirmed",
            selfDeclined: false
        )
        let encoded = try object(encoding: payload)

        XCTAssertEqual(
            Set(encoded.keys),
            [
                "id", "calendarId", "externalId", "title", "start", "end",
                "isAllDay", "url", "location", "notes", "status", "selfDeclined",
            ]
        )
        XCTAssertTrue(encoded["url"] is NSNull)
        XCTAssertTrue(encoded["location"] is NSNull)
        XCTAssertTrue(encoded["notes"] is NSNull)
    }

    func testAuthorizationMatchesTheSchema() throws {
        let encoded = try object(encoding: AuthorizationPayload(status: "granted"))

        XCTAssertEqual(Set(encoded.keys), ["status"])
        XCTAssertEqual(encoded["status"] as? String, "granted")
    }

    func testReplyEnvelopeMatchesTheSchema() throws {
        let reply = Reply(id: 7, ok: true, result: AuthorizationPayload(status: "denied"))
        let encoded = try object(encoding: reply)

        XCTAssertEqual(Set(encoded.keys), ["id", "ok", "result"])
        XCTAssertEqual(encoded["id"] as? Int, 7)
        XCTAssertEqual(encoded["ok"] as? Bool, true)
    }

    /// A reply must be one line: a raw newline in a title would otherwise
    /// split one frame into two and desynchronise the stream.
    func testEncodedRepliesStayOnOneLine() throws {
        let payload = CalendarPayload(id: "cal", title: "Work\nHome", isDefault: false)
        let data = try JSONEncoder().encode(Reply(id: 1, ok: true, result: [payload]))
        let line = try XCTUnwrap(String(data: data, encoding: .utf8))

        XCTAssertFalse(line.contains("\n"))
    }

    func testRequestDecodesWithOnlyTheRequiredFields() throws {
        let line = Data(#"{"id":3,"op":"sources"}"#.utf8)
        let request = try JSONDecoder().decode(Request.self, from: line)

        XCTAssertEqual(request.id, 3)
        XCTAssertEqual(request.op, "sources")
        XCTAssertNil(request.sourceId)
        XCTAssertNil(request.calendarIds)
    }

    /// The consumer frames `{ ...payload, id, op }`, so unknown keys arrive.
    func testRequestIgnoresUnknownFields() throws {
        let line = Data(#"{"id":4,"op":"events","sourceId":"s","unexpected":true}"#.utf8)
        let request = try JSONDecoder().decode(Request.self, from: line)

        XCTAssertEqual(request.sourceId, "s")
    }

    func testErrorKindsMatchTheSchema() {
        XCTAssertEqual(HelperError.denied.kind, "denied")
        XCTAssertEqual(HelperError.restricted.kind, "restricted")
        XCTAssertEqual(HelperError.writeOnly.kind, "writeOnly")
        XCTAssertEqual(HelperError.unknownSource.kind, "unknown_source")
        XCTAssertEqual(HelperError.badRequest.kind, "bad_request")
        XCTAssertEqual(HelperError.storeFailure.kind, "store_failure")
    }
}
