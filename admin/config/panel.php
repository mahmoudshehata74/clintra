<?php

$entries = static fn (string $name): array => array_values(array_filter(
    array_map('trim', explode(',', (string) env($name, ''))),
    static fn (string $value): bool => $value !== '',
));

return [
    'trusted_proxies' => $entries('ADMIN_TRUSTED_PROXIES'),
    'ip_allowlist' => $entries('ADMIN_IP_ALLOWLIST'),
];
