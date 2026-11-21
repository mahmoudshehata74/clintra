<?php

namespace App\Providers\Filament;

use App\Filament\Pages\AdminLog;
use App\Filament\Pages\ChangePassword;
use App\Filament\Pages\SignIn;
use App\Http\Middleware\ResolvePlatformSession;
use Filament\FontProviders\LocalFontProvider;
use Filament\Http\Middleware\Authenticate;
use Filament\Http\Middleware\DispatchServingFilamentEvent;
use Filament\Panel;
use Filament\PanelProvider;
use Filament\View\PanelsRenderHook;
use Illuminate\Cookie\Middleware\AddQueuedCookiesToResponse;
use Illuminate\Cookie\Middleware\EncryptCookies;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Illuminate\Routing\Middleware\SubstituteBindings;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\Support\HtmlString;
use Illuminate\View\Middleware\ShareErrorsFromSession;

final class AdminPanelProvider extends PanelProvider
{
    public function panel(Panel $panel): Panel
    {
        return $panel->default()->id('admin')->path('panel')->brandName('إدارة كلينترا')
            ->login(SignIn::class)->loginRouteSlug('sign-in')->authGuard('platform')
            ->pages([AdminLog::class, ChangePassword::class])->homeUrl(fn () => AdminLog::getUrl())
            ->navigation(false)->topbar(false)
            ->font('IBM Plex Sans Arabic', url: fn () => asset('fonts.css'), provider: LocalFontProvider::class)
            ->renderHook(PanelsRenderHook::HEAD_END, fn () => new HtmlString('<link rel="stylesheet" href="'.e(asset('panel.css')).'"><script src="'.e(asset('panel.js')).'"></script>'))
            ->middleware([EncryptCookies::class, AddQueuedCookiesToResponse::class, StartSession::class,
                ShareErrorsFromSession::class, ValidateCsrfToken::class, SubstituteBindings::class,
                DispatchServingFilamentEvent::class, ResolvePlatformSession::class])
            ->authMiddleware([ResolvePlatformSession::class, Authenticate::class], isPersistent: true);
    }
}
