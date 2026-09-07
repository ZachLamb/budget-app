import SwiftUI

struct MenuBarView: View {
    @Environment(SyncCoordinator.self) private var sync
    @Environment(InferenceManager.self) private var inference

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            HStack {
                Text("Snack's Budget")
                    .font(Theme.Font.cardTitle)
                Spacer()
                StatusDot(
                    level: sync.isSyncing ? .busy : (sync.error == nil ? .ok : .error),
                    pulsing: sync.isSyncing
                )
            }

            Divider()

            // AI tier with privacy framing — the whole point of local inference.
            HStack(spacing: Theme.Spacing.sm) {
                Image(systemName: inference.activeTier.symbol)
                    .foregroundStyle(
                        inference.activeTier.isPrivate
                            ? Theme.Palette.positive
                            : Theme.Palette.warning
                    )
                    .frame(width: 16)
                VStack(alignment: .leading, spacing: 1) {
                    Text("AI: \(inference.activeTier.rawValue)")
                        .font(.callout)
                    Text(inference.report?.headline ?? "Not checked")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                StatusDot(level: inference.report?.level ?? .neutral)
            }

            if let lastSync = sync.lastSyncedAt {
                LabeledContent("Last sync") {
                    Text(lastSync, style: .relative)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            if let err = sync.error {
                InlineBanner(level: .error, title: "Sync failed", message: err)
            }

            Divider()

            HStack {
                Button {
                    Task { await sync.syncAll() }
                } label: {
                    Label("Sync Now", systemImage: "arrow.clockwise")
                }
                .disabled(sync.isSyncing)

                Spacer()

                Button {
                    Task { await inference.refreshStatus() }
                } label: {
                    Label("Check AI", systemImage: "stethoscope")
                }
                .disabled(inference.isCheckingServer)
            }
            .buttonStyle(.borderless)
        }
        .padding(Theme.Spacing.lg)
        .frame(width: 280)
    }
}
