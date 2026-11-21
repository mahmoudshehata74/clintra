<?php

namespace App\Http\Middleware;

use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;

final class VerifyPanelCsrf extends PreventRequestForgery
{
    // Native forms and Livewire use hidden/meta tokens; no readable XSRF cookie is needed.
    protected $addHttpCookie = false;
}
