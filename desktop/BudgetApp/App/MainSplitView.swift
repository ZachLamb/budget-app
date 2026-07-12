import SwiftUI

struct MainSplitView: View {
    var body: some View {
        NavigationSplitView {
            Text("Sidebar")
        } content: {
            Text("Main Pane")
        } detail: {
            Text("Detail")
        }
    }
}
