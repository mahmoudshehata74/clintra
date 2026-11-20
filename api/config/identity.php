<?php

/*
 * Per-person identity (docs/design-identity-permissions.md). Passwords are
 * Argon2id with RFC 9106's second recommended option at one lane: 64 MiB,
 * 3 passes. Only the test suite lowers them (phpunit.xml), as it lowers
 * BCRYPT_ROUNDS.
 */
return [
    'argon' => [
        'memory_cost' => (int) env('IDENTITY_ARGON_MEMORY_KIB', 65536),
        'time_cost' => (int) env('IDENTITY_ARGON_TIME_COST', 3),
        'threads' => 1,
    ],
];
