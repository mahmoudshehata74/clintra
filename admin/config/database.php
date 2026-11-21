<?php

// This is the panel's only connection. No URL override, owner credential, or table access.
return ['default' => 'pgsql', 'connections' => ['pgsql' => [
    'driver' => 'pgsql', 'url' => null, 'host' => env('DB_HOST', '127.0.0.1'), 'port' => env('DB_PORT', '5432'),
    'database' => env('DB_DATABASE', 'clintra'), 'username' => 'clintra_admin_app',
    'password' => env('DB_ADMIN_APP_PASSWORD'), 'charset' => 'utf8', 'prefix' => '',
    'search_path' => 'platform', 'sslmode' => env('DB_SSLMODE', 'require'),
]]];
