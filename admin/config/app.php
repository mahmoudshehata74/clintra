<?php

return [
    'name' => 'إدارة كلينترا', 'env' => env('APP_ENV', 'production'), 'debug' => (bool) env('APP_DEBUG', false),
    'url' => env('APP_URL', 'http://localhost:8001'), 'clinic_app_url' => env('CLINIC_APP_URL', 'http://localhost:5173'), 'timezone' => 'Africa/Cairo', 'locale' => 'ar',
    'fallback_locale' => 'ar', 'cipher' => 'AES-256-CBC', 'key' => env('APP_KEY'), 'previous_keys' => [],
    'maintenance' => ['driver' => 'file'],
];
