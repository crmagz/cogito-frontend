import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [
      react(),
      {
        name: "workbench-relay",
        async configureServer(server) {
          const { createRelay } = await import("./server.mjs");
          server.middlewares.use(
            createRelay({
              upstreamUrl: environment.COGITO_UPSTREAM_URL ?? "",
              token: environment.COGITO_UPSTREAM_TOKEN ?? ""
            })
          );
        }
      }
    ]
  };
});
