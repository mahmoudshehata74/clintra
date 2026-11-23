<?php

namespace App\Filament\Pages;

use App\Support\Platform;
use App\Support\Refusal;
use Filament\Pages\Page;
use Illuminate\Support\Facades\Auth;
use Livewire\Attributes\Locked;

final class Clinics extends Page
{
    protected string $view = 'pages.clinics';

    protected static ?string $title = 'العيادات';

    #[Locked]
    public array $rows = [];

    #[Locked]
    public array $filters = [];

    #[Locked]
    public ?string $error = null;

    public static function canAccess(): bool
    {
        return AdminLog::canAccess();
    }

    public function mount(Platform $platform): void
    {
        $this->filters = request()->only('from', 'to');
        $result = $platform->figures(Auth::guard('platform')->id(), $this->filters['from'] ?? null, $this->filters['to'] ?? null);
        if (! $result['ok']) {
            $this->error = Refusal::message($result);
            if ($result['reason'] === 'session_invalid') {
                session()->forget('platform_session_id');
                $this->redirect(route('filament.admin.auth.login'));
            }

            return;
        }
        $this->rows = $result['rows'];
    }

    public function getHeading(): string
    {
        return '';
    }
}
