<?php

namespace App\Support\Identity;

use RuntimeException;

/** An auth_* function refused or failed; see AuthCall. Carries no payload. */
final class AuthCallFailed extends RuntimeException
{
    public function __construct(public readonly string $function, public readonly string $sqlState)
    {
        parent::__construct("{$function} failed (SQLSTATE {$sqlState})");
    }
}
