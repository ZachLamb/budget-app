import SwiftUI

struct MenuBarView: View {
    @Environment(SyncCoordinator.self) private var sync
    @Environment(InferenceManager.self) private var inference

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Budget App")
                    .font(.headline)
                Spacer()
                Circle()
                    .fill(sync.isSyncing ? Color.orange : Color.green)
                    .frame(width: 8, height: 8)
            }
            Divider()
            LabeledContent("AI Tier") {
                Text(inference.activeTier.rawValue)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if let lastSync = sync.lastSyncedAt {
                LabeledContent("Last Sync") {
                    Text(lastSync, style: .relative)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            if let err = sync.error {
                Text(err)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
            Divider()
            Button("Sync Now") {
                Task { await sync.syncAll() }
            }
            .disabled(sync.isSyncing)
        }
        .padding()
        .frame(width: 240)
    }
}
