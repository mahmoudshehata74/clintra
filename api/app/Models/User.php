<?php

namespace App\Models;

use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;

// See docs/schema.md's users table. Clintra has no password-based login
// (device registration + a PIN per membership, see the CLI brief) — this
// model carries no password/remember_token.
#[Fillable(['full_name', 'phone', 'email', 'is_active'])]
class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasFactory, Notifiable;

    // IDs are UUID v4, generated on the client — never by Laravel.
    public $incrementing = false;

    protected $keyType = 'string';

    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
        ];
    }
}
