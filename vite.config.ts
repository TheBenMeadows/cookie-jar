import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `buffer` and `process` are referenced by @solana/web3.js and @solana/spl-token, which were
// written for Node. The aliases below point them at browser shims that ship inside the Solana
// dependency tree, and `global` is defined because buffer's browser build expects it.
export default defineConfig({
  plugins: [react()],
  define: {
    global: "globalThis",
  },
  resolve: {
    alias: {
      buffer: "buffer/",
    },
  },
  build: {
    target: "es2022",
    rollupOptions: {
      output: {
        manualChunks: {
          solana: ["@solana/web3.js", "@solana/spl-token"],
          wallet: ["@solana/wallet-adapter-react", "@solana/wallet-adapter-base"],
        },
      },
    },
  },
});
