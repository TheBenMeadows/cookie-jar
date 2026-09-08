import { Buffer } from "buffer";

/**
 * `@solana/web3.js` and `@solana/spl-token` were written for Node and reach for a global `Buffer`.
 * This module is imported before anything that pulls them in, so the global exists by the time their
 * top-level code runs.
 */
const globals = globalThis as { Buffer?: typeof Buffer };
if (!globals.Buffer) globals.Buffer = Buffer;
