import Foundation

// MARK: - Transaction
struct RemoteTransaction: Codable, Identifiable {
    let id: String
    let date: String
    let amount: Double
    let payeeName: String?
    let categoryName: String?
    let accountName: String?
    let notes: String?

    enum CodingKeys: String, CodingKey {
        case id, date, amount, notes
        case payeeName = "payee_name"
        case categoryName = "category_name"
        case accountName = "account_name"
    }
}

// MARK: - Budget
struct RemoteBudgetCategory: Codable, Identifiable {
    let id: String
    let name: String
    let groupName: String
    let assigned: Double
    let spent: Double
    let available: Double

    enum CodingKeys: String, CodingKey {
        case id, name, assigned, spent, available
        case groupName = "group_name"
    }
}

// MARK: - InferenceContext
struct InferenceContextResponse: Decodable {
    let system: String
    let prompt: String
    let responseSchema: [String: AnyCodable]
    let featureId: String

    enum CodingKeys: String, CodingKey {
        case system, prompt
        case responseSchema = "response_schema"
        case featureId = "feature_id"
    }
}

// Minimal AnyCodable for the schema field — backend returns arbitrary JSON object
struct AnyCodable: Codable {
    let value: Any

    init(_ value: Any) { self.value = value }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let s = try? container.decode(String.self) { value = s; return }
        if let i = try? container.decode(Int.self) { value = i; return }
        if let d = try? container.decode(Double.self) { value = d; return }
        if let b = try? container.decode(Bool.self) { value = b; return }
        if let a = try? container.decode([AnyCodable].self) { value = a.map(\.value); return }
        if let o = try? container.decode([String: AnyCodable].self) {
            value = o.mapValues(\.value); return
        }
        value = ()
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch value {
        case let s as String: try container.encode(s)
        case let i as Int: try container.encode(i)
        case let d as Double: try container.encode(d)
        case let b as Bool: try container.encode(b)
        default: try container.encodeNil()
        }
    }
}
