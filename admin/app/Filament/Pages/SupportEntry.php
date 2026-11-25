<?php

namespace App\Filament\Pages;

use Filament\Pages\Page;
use Filament\Panel;
use Filament\Support\Components\Attributes\Unexposed;

final class SupportEntry extends Page
{
    protected string $view = 'pages.support-entry';
    protected static ?string $title = 'دخول دعم';
    protected static ?string $slug = 'support';

    #[Unexposed]
    public static function getRelativeRouteName(Panel $panel): string { return 'support-entry'; }
    public static function canAccess(): bool { return AdminLog::canAccess(); }
    public function getHeading(): string { return ''; }
}
