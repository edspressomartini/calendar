import Foundation

/*
 * The wire types. Every one of these is validated on the other side by a
 * `z.strictObject` in `EventKitProtocol.ts`, so an extra key is a parse
 * failure and a missing key is too: `nullable()` is not `optional()`.
 *
 * That is why the payloads carrying optionals encode themselves by hand.
 * The synthesised `Encodable` uses `encodeIfPresent`, which drops a nil key
 * instead of writing `null`, and the whole reply would be rejected.
 */

struct SourcePayload: Encodable {
    let id: String
    let title: String
    let defaultCalendarId: String?

    private enum CodingKeys: String, CodingKey {
        case id
        case title
        case defaultCalendarId
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(title, forKey: .title)
        try container.encode(defaultCalendarId, forKey: .defaultCalendarId)
    }
}

struct CalendarPayload: Encodable {
    let id: String
    let title: String
    let isDefault: Bool
}

struct EventPayload: Encodable {
    let id: String
    let calendarId: String
    let externalId: String
    let title: String
    let start: String
    let end: String
    let isAllDay: Bool
    let url: String?
    let location: String?
    let notes: String?
    let status: String
    let selfDeclined: Bool

    private enum CodingKeys: String, CodingKey {
        case id
        case calendarId
        case externalId
        case title
        case start
        case end
        case isAllDay
        case url
        case location
        case notes
        case status
        case selfDeclined
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(calendarId, forKey: .calendarId)
        try container.encode(externalId, forKey: .externalId)
        try container.encode(title, forKey: .title)
        try container.encode(start, forKey: .start)
        try container.encode(end, forKey: .end)
        try container.encode(isAllDay, forKey: .isAllDay)
        try container.encode(url, forKey: .url)
        try container.encode(location, forKey: .location)
        try container.encode(notes, forKey: .notes)
        try container.encode(status, forKey: .status)
        try container.encode(selfDeclined, forKey: .selfDeclined)
    }
}

struct AuthorizationPayload: Encodable {
    let status: String
}

/// The success half of a reply. The failure half is written by hand in
/// `emitError`, because its only variable part is a fixed error kind.
struct Reply<T: Encodable>: Encodable {
    let id: Int
    let ok: Bool
    let result: T
}

struct Request: Decodable {
    let id: Int
    let op: String
    let sourceId: String?
    let calendarIds: [String]?
    let start: String?
    let end: String?
}
