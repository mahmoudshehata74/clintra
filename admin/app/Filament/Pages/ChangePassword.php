<?php

namespace App\Filament\Pages;

use Filament\Pages\Page;
use Illuminate\Support\Facades\Auth;

final class ChangePassword extends Page
{
    protected string $view = 'pages.change-password';

    protected static string $layout = 'filament-panels::components.layout.simple';

    protected static ?string $title = 'تغيير كلمة السر';

    protected static bool $shouldRegisterNavigation = false;

    public static function canAccess(): bool
    {
        return Auth::guard('platform')->check();
    }

    public function getHeading(): string
    {
        return '';
    }

    public function hasLogo(): bool
    {
        return false;
    }

    protected function getLayoutData(): array
    {
        return ['hasTopbar' => false];
    }
}
