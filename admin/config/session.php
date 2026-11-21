<?php

return [
    'driver' => 'file', 'lifetime' => 480, 'expire_on_close' => true, 'encrypt' => true,
    'files' => storage_path('framework/sessions'), 'connection' => null, 'table' => null,
    'store' => null, 'lottery' => [2, 100], 'cookie' => 'clintra_admin_session', 'path' => '/',
    'domain' => null, 'secure' => env('APP_ENV') !== 'local', 'http_only' => true,
    'same_site' => 'strict', 'partitioned' => false,
];
