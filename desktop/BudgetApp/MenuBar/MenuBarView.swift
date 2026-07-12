import SwiftUI

struct MenuBarView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Budget App")
                .font(.headline)
            Divider()
            Text("Connecting…")
                .foregroundStyle(.secondary)
        }
        .padding()
        .frame(width: 220)
    }
}
