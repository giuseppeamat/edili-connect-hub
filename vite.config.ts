// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

const cloudPublicConfig = {
  url: "https://nceslltrprwqxogorxnp.supabase.co",
  publishableKey: "sb_publishable_dRfi3LkrB_Ed8aQ7p7M7ig_q7gYAKzt",
};

export default defineConfig({
  vite: {
    // Lovable Cloud normally injects these values. Keeping the project's public
    // client configuration as a build fallback prevents a broken browser bundle
    // if the managed build environment is temporarily unavailable.
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(
        process.env.VITE_SUPABASE_URL || cloudPublicConfig.url,
      ),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(
        process.env.VITE_SUPABASE_PUBLISHABLE_KEY || cloudPublicConfig.publishableKey,
      ),
    },
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
