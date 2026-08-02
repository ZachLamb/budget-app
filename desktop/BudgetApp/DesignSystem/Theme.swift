import SwiftUI

/// Design tokens for the app.
///
/// Defined in code rather than an asset catalog on purpose: the package builds
/// with SwiftPM (`swift build`) as well as Xcode, and a SwiftPM target has no
/// asset catalog to read colors from. Every custom color is a dynamic
/// `NSColor` so light/dark both work without a second definition.
enum Theme {

    // MARK: - Spacing

    /// A 4pt scale. Use these instead of literals so density stays consistent.
    enum Spacing {
        static let xxs: CGFloat = 2
        static let xs: CGFloat = 4
        static let sm: CGFloat = 8
        static let md: CGFloat = 12
        static let lg: CGFloat = 16
        static let xl: CGFloat = 24
        static let xxl: CGFloat = 32
    }

    // MARK: - Radius

    enum Radius {
        static let sm: CGFloat = 6
        static let md: CGFloat = 10
        static let lg: CGFloat = 14
        static let pill: CGFloat = 999
    }

    // MARK: - Palette

    enum Palette {
        /// Brand accent — also the tint for primary buttons and selection.
        static let brand = dynamic(
            light: NSColor(srgbRed: 0.08, green: 0.52, blue: 0.42, alpha: 1),
            dark: NSColor(srgbRed: 0.29, green: 0.80, blue: 0.66, alpha: 1)
        )

        /// Money coming in / healthy state.
        static let positive = dynamic(
            light: NSColor(srgbRed: 0.10, green: 0.50, blue: 0.31, alpha: 1),
            dark: NSColor(srgbRed: 0.35, green: 0.82, blue: 0.55, alpha: 1)
        )

        /// Overspent / error.
        static let negative = dynamic(
            light: NSColor(srgbRed: 0.72, green: 0.19, blue: 0.19, alpha: 1),
            dark: NSColor(srgbRed: 0.98, green: 0.45, blue: 0.45, alpha: 1)
        )

        /// Needs attention but not broken.
        static let warning = dynamic(
            light: NSColor(srgbRed: 0.70, green: 0.44, blue: 0.05, alpha: 1),
            dark: NSColor(srgbRed: 0.98, green: 0.75, blue: 0.35, alpha: 1)
        )

        /// Informational / neutral highlight.
        static let info = dynamic(
            light: NSColor(srgbRed: 0.16, green: 0.40, blue: 0.75, alpha: 1),
            dark: NSColor(srgbRed: 0.45, green: 0.70, blue: 0.98, alpha: 1)
        )

        /// Card background — sits slightly above the window background.
        static let surface = dynamic(
            light: NSColor(srgbRed: 1.0, green: 1.0, blue: 1.0, alpha: 1),
            dark: NSColor(srgbRed: 0.16, green: 0.17, blue: 0.19, alpha: 1)
        )

        /// Recessed background for code blocks and inset content.
        static let surfaceSunken = dynamic(
            light: NSColor(srgbRed: 0.96, green: 0.96, blue: 0.97, alpha: 1),
            dark: NSColor(srgbRed: 0.12, green: 0.13, blue: 0.15, alpha: 1)
        )

        /// Hairline borders on cards and inset containers.
        static let border = dynamic(
            light: NSColor(white: 0.0, alpha: 0.10),
            dark: NSColor(white: 1.0, alpha: 0.12)
        )

        private static func dynamic(light: NSColor, dark: NSColor) -> Color {
            Color(nsColor: NSColor(name: nil) { appearance in
                let isDark = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
                return isDark ? dark : light
            })
        }
    }

    // MARK: - Typography

    enum Font {
        static let sectionTitle = SwiftUI.Font.system(.subheadline, design: .rounded).weight(.semibold)
        static let cardTitle = SwiftUI.Font.system(.headline, design: .rounded)
        static let numeric = SwiftUI.Font.system(.body, design: .rounded).monospacedDigit()
        static let numericSmall = SwiftUI.Font.system(.caption, design: .rounded).monospacedDigit()
        static let code = SwiftUI.Font.system(.caption, design: .monospaced)
    }
}

// MARK: - Semantic status

/// Shared vocabulary for "how healthy is this thing" across the menu bar,
/// settings diagnostics, and inline banners, so one concept has one color.
enum StatusLevel {
    case ok
    case warning
    case error
    case neutral
    case busy

    var color: Color {
        switch self {
        case .ok: return Theme.Palette.positive
        case .warning: return Theme.Palette.warning
        case .error: return Theme.Palette.negative
        case .neutral: return .secondary
        case .busy: return Theme.Palette.info
        }
    }

    var symbol: String {
        switch self {
        case .ok: return "checkmark.circle.fill"
        case .warning: return "exclamationmark.triangle.fill"
        case .error: return "xmark.octagon.fill"
        case .neutral: return "circle.dashed"
        case .busy: return "clock.fill"
        }
    }
}
