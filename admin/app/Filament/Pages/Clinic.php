<?php

namespace App\Filament\Pages;

use App\Support\Platform;
use App\Support\Refusal;
use Filament\Pages\Page;
use Filament\Panel;
use Filament\Support\Components\Attributes\Unexposed;
use Illuminate\Support\Facades\Auth;
use Livewire\Attributes\Locked;

final class Clinic extends Page
{
    protected string $view = 'pages.clinic';

    protected static ?string $title = 'العيادة';

    protected static ?string $slug = 'clinic/{org}';

    #[Unexposed]
    public static function getRelativeRouteName(Panel $panel): string
    {
        return 'clinic';
    }

    #[Locked]
    public ?array $clinic = null;

    #[Locked]
    public array $devices = [];

    #[Locked]
    public array $approvals = [];

    #[Locked]
    public int $activeAdminCount = 0;

    #[Locked]
    public ?string $error = null;

    public static function canAccess(): bool
    {
        return AdminLog::canAccess();
    }

    public function mount(Platform $platform, string $org): void
    {
        abort_unless(preg_match('/^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$/D', $org), 404);
        $result = $platform->orgDetail(Auth::guard('platform')->id(), $org);
        if (! $result['ok']) {
            $this->error = Refusal::message($result);
            if ($result['reason'] === 'session_invalid') {
                session()->forget('platform_session_id');
                $this->redirect(route('filament.admin.auth.login'));
            }

            return;
        }
        $this->clinic = $result['org'];
        $devices = $platform->orgDevices(Auth::guard('platform')->id(), $org);
        $approvals = $platform->orgApprovals(Auth::guard('platform')->id(), $org);
        if (! $devices['ok'] || ! $approvals['ok']) {
            $this->error = Refusal::message($devices['ok'] ? $approvals : $devices);
            return;
        }
        $this->devices = $devices['devices'];
        $locationNames = array_column($this->clinic['locations'], 'name', 'id');
        $this->approvals = array_map(fn ($approval) => $approval + [
            'location_name' => $locationNames[$approval['location_id']] ?? '',
        ], $approvals['approvals']);
        $this->activeAdminCount = $approvals['active_admin_count'];
    }

    public function getHeading(): string
    {
        return '';
    }
}
