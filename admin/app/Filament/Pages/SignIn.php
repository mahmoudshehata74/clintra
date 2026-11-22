<?php

namespace App\Filament\Pages;

use Filament\Pages\SimplePage;
use Illuminate\Support\Facades\Auth;

final class SignIn extends SimplePage
{
    protected string $view = 'auth.sign-in';

    protected static ?string $title = 'تسجيل الدخول';

    public function mount(): void
    {
        if (Auth::guard('platform')->check()) {
            $this->redirect(AdminLog::getUrl());
        }
    }

    public function hasLogo(): bool
    {
        return false;
    }

    public function getHeading(): string
    {
        return '';
    }
}
