/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** See src/config/apiBaseUrl.ts — unset means same-origin "/api". */
  readonly VITE_API_BASE_URL?: string;
}
