export default function OfflinePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-xl font-semibold">You are offline</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Reconnect to sign in and sync your budget. On-device AI models cached on this device may still be available
        when you return online.
      </p>
    </main>
  );
}
