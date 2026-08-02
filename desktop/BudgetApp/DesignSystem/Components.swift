import SwiftUI

// MARK: - Card

/// Elevated content container. The app's default grouping primitive.
struct Card<Content: View>: View {
    var title: String?
    var systemImage: String?
    var footnote: String?
    @ViewBuilder var content: Content

    init(
        _ title: String? = nil,
        systemImage: String? = nil,
        footnote: String? = nil,
        @ViewBuilder content: () -> Content
    ) {
        self.title = title
        self.systemImage = systemImage
        self.footnote = footnote
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            if let title {
                HStack(spacing: Theme.Spacing.sm) {
                    if let systemImage {
                        Image(systemName: systemImage)
                            .foregroundStyle(Theme.Palette.brand)
                    }
                    Text(title).font(Theme.Font.cardTitle)
                }
            }
            content
            if let footnote {
                Text(footnote)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(Theme.Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.Palette.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.lg)
                .strokeBorder(Theme.Palette.border, lineWidth: 1)
        )
    }
}

// MARK: - Status indicators

/// Small filled dot. Used where space is tight (menu bar, list rows).
struct StatusDot: View {
    let level: StatusLevel
    var pulsing = false

    @State private var animating = false

    var body: some View {
        Circle()
            .fill(level.color)
            .frame(width: 8, height: 8)
            .opacity(pulsing && animating ? 0.35 : 1)
            .animation(
                pulsing
                    ? .easeInOut(duration: 0.8).repeatForever(autoreverses: true)
                    : .default,
                value: animating
            )
            .onAppear { if pulsing { animating = true } }
            .accessibilityHidden(true)
    }
}

/// Labelled status chip with an icon — the readable counterpart to `StatusDot`.
struct StatusPill: View {
    let level: StatusLevel
    let text: String

    var body: some View {
        HStack(spacing: Theme.Spacing.xs) {
            Image(systemName: level.symbol)
                .font(.caption2)
            Text(text)
                .font(.caption)
                .fontWeight(.medium)
        }
        .foregroundStyle(level.color)
        .padding(.horizontal, Theme.Spacing.sm)
        .padding(.vertical, Theme.Spacing.xs)
        .background(level.color.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(text)")
    }
}

// MARK: - Diagnostics

/// One line of a diagnostic checklist: an outcome icon plus explanation.
struct CheckRow: View {
    let level: StatusLevel
    let title: String
    var detail: String?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.sm) {
            Image(systemName: level.symbol)
                .foregroundStyle(level.color)
                .font(.caption)
                .frame(width: 14)
            VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                Text(title)
                    .font(.callout)
                if let detail {
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}

/// Numbered recovery instructions shown when a check fails.
struct RecoverySteps: View {
    let steps: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.sm) {
                    Text("\(index + 1)")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(Theme.Palette.brand)
                        .frame(width: 16, height: 16)
                        .background(Theme.Palette.brand.opacity(0.15), in: Circle())
                    Text(step)
                        .font(.caption)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                }
            }
        }
        .padding(Theme.Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Theme.Palette.surfaceSunken,
            in: RoundedRectangle(cornerRadius: Theme.Radius.md)
        )
    }
}

/// Inline coloured banner for a single actionable message.
struct InlineBanner: View {
    let level: StatusLevel
    let title: String
    var message: String?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.sm) {
            Image(systemName: level.symbol)
                .foregroundStyle(level.color)
            VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                Text(title)
                    .font(.callout.weight(.medium))
                if let message {
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(Theme.Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(level.color.opacity(0.10), in: RoundedRectangle(cornerRadius: Theme.Radius.md))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.md)
                .strokeBorder(level.color.opacity(0.30), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Misc

/// Monospaced inline code chip, for URLs and shell commands in help text.
struct CodeChip: View {
    let text: String

    var body: some View {
        Text(text)
            .font(Theme.Font.code)
            .padding(.horizontal, Theme.Spacing.xs)
            .padding(.vertical, Theme.Spacing.xxs)
            .background(
                Theme.Palette.surfaceSunken,
                in: RoundedRectangle(cornerRadius: Theme.Radius.sm)
            )
            .textSelection(.enabled)
    }
}
