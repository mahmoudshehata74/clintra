<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Laravel\Sanctum\HasApiTokens;

/**
 * See docs/schema.md's device table (v10 additions: membership_id). Used
 * only to issue a Sanctum token at registration
 * (App\Http\Controllers\DeviceRegistrationController), always as a bare,
 * unfetched instance built from register_device(jsonb)'s own return value
 * — device carries FORCE RLS and no membership context exists yet at
 * registration time, so an actual SELECT against this table would return
 * nothing. App\Http\Middleware\ApplyMembership verifies tokens directly
 * against personal_access_tokens (which has no RLS) rather than Sanctum's
 * auth:sanctum guard, specifically to avoid ever needing to read this
 * table before a membership is known — see the middleware's own doc
 * comment.
 */
class Device extends Model
{
    use HasApiTokens;

    public $incrementing = false;

    protected $keyType = 'string';

    public $timestamps = false;

    protected $table = 'device';

    protected $fillable = ['id'];
}
