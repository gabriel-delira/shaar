// Next.js instrumentation hook — runs once per server process at startup (Node.js runtime).
// Starts the on-chain indexer that keeps the DB in sync with contract events.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Lazy import so this module is never bundled into the Edge runtime
  const { startIndexer } = await import("./worker/indexer");
  startIndexer();
}
