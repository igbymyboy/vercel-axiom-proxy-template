import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          bindings: {
            AXIOM_API_TOKEN: "test-axiom-token",
            VERCEL_DRAIN_SECRET: "test-secret",
          },
        },
      },
    },
  },
});
