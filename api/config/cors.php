<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Cross-Origin Resource Sharing (CORS) Configuration
    |--------------------------------------------------------------------------
    |
    | Here you may configure your settings for cross-origin resource sharing
    | or "CORS". This determines what cross-origin operations may execute
    | in web browsers. You are free to adjust these settings as needed.
    |
    | To learn more: https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS
    |
    */

    'paths' => ['api/*', 'sanctum/csrf-cookie'],

    'allowed_methods' => ['*'],

    // From env, never hardcoded and never a wildcard — the deployed web
    // origin is a per-environment fact (staging/production may differ,
    // and no hosting provider is chosen yet), not something to commit as
    // code. Comma-separated; the two localhost forms are Vite's own dev
    // server (see web/vite.config.ts) and stay available even when
    // CORS_ALLOWED_ORIGINS is set, so a local frontend can always reach a
    // real deployed API for manual testing without needing to add itself
    // to that list.
    'allowed_origins' => array_values(array_unique(array_merge(
        array_filter(array_map('trim', explode(',', (string) env('CORS_ALLOWED_ORIGINS', '')))),
        ['http://localhost:5173', 'http://127.0.0.1:5173'],
    ))),

    'allowed_origins_patterns' => [],

    // Not '*': the Fetch spec never lets a wildcard cover the Authorization
    // header, regardless of credentials mode — a real, easy-to-miss CORS
    // gotcha, confirmed by this app's own preflight test
    // (tests/Feature/Cors/CrossOriginTest.php). Every header this app's own
    // client (web/src/sync/httpTransport.ts) actually sends is listed
    // explicitly instead.
    'allowed_headers' => ['Authorization', 'Accept', 'Content-Type', 'X-Requested-With'],

    'exposed_headers' => [],

    'max_age' => 0,

    // Never true: auth is a Bearer token in the Authorization header
    // (api/docs/rls.md's "Registration"), never a cookie — there is
    // nothing here for CORS "credentials" (cookies, HTTP auth) to apply
    // to, and turning this on would only add a blast radius this app has
    // no use for.
    'supports_credentials' => false,

];
