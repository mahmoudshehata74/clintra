import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // The service worker activates as soon as it finishes installing, so a
      // returning assistant always gets the latest build without a manual
      // "update available" prompt — there is no user-facing update flow yet.
      registerType: "autoUpdate",
      manifest: {
        name: "Clintra",
        short_name: "Clintra",
        lang: "ar",
        dir: "rtl",
        start_url: "/",
        display: "standalone",
        // --color-green and --color-paper from src/index.css.
        theme_color: "#1D5B4A",
        background_color: "#FBFAF7",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
      workbox: {
        // Precache every built script, style, font and icon so a reload with
        // the network off renders the day screen exactly as online.
        globPatterns: ["**/*.{js,css,html,woff,woff2,png,ico}"],
        // vite-plugin-pwa's generateSW strategy defaults navigateFallback to
        // "index.html", which makes workbox-build auto-register its own
        // NavigationRoute (bound straight to the precached index.html) ahead
        // of any runtimeCaching rule below — confirmed by inspecting the
        // built dist/sw.js, where that NavigationRoute was registered before
        // our own app-shell rule and so always won, leaving the rule below
        // dead code since this file was written. navigateFallback exists for
        // single-page apps that need every unmatched route to fall back to
        // one HTML shell; this app has no client-side router, so there is
        // nothing for it to do here except shadow our own navigation
        // handling. Set to undefined so our runtimeCaching rule is the only
        // one registered for a navigation request.
        navigateFallback: undefined,
        // The app shell (the navigation request for index.html) is the one
        // thing that can change without its filename changing, so it alone
        // gets a stale-while-revalidate runtime strategy: serve the cached
        // shell instantly, then refresh the cache in the background when
        // online. Every other precached asset is content-hashed by Vite, so
        // it never needs revalidating — a new build simply has new hashes
        // and its own precache entries. There are no runtime API calls yet
        // (no backend exists), so no other runtime caching rule is added.
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === "navigate",
            handler: "StaleWhileRevalidate",
            options: { cacheName: "app-shell" },
          },
        ],
      },
    }),
  ],
  server: {
    // `pnpm dev` proxies /api to the local Laravel server (`php artisan
    // serve`, default port) — every fetch in src/sync/httpTransport.ts and
    // src/db/registration.ts already uses a relative "/api/..." URL, same
    // origin as this dev server, so nothing in application code needs to
    // know this exists. Never used by the production build (Vercel serves
    // the built static app; the real API is deployed separately).
    proxy: {
      "/api": "http://127.0.0.1:8000",
    },
  },
});
