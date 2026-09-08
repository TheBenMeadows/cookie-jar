/**
 * One env reader for both runtimes. The app is bundled by Vite, where configuration arrives as
 * `import.meta.env.VITE_*`; the live-check script runs under tsx, where the same names arrive as
 * `process.env.VITE_*`. Reading through this helper keeps `src/lib` importable from both without a
 * second copy of every constant.
 */
export function readEnv(key: string): string | undefined {
  const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const fromVite = viteEnv?.[key];
  if (typeof fromVite === "string" && fromVite.length > 0) return fromVite;

  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  const fromNode = proc?.env?.[key];
  if (typeof fromNode === "string" && fromNode.length > 0) return fromNode;

  return undefined;
}

export function envUrl(key: string, fallback: string): string {
  return (readEnv(key) ?? fallback).trim().replace(/\/$/, "");
}
