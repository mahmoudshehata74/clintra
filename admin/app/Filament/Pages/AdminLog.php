<?php

namespace App\Filament\Pages;

use App\Support\Platform;
use App\Support\Refusal;
use Filament\Pages\Page;
use Illuminate\Support\Facades\Auth;
use Livewire\Attributes\Locked;

final class AdminLog extends Page
{
    protected string $view = 'pages.admin-log';

    protected static ?string $title = 'سجل الإدارة';

    #[Locked]
    public array $rows = [];

    #[Locked]
    public array $filters = [];

    #[Locked]
    public ?string $next = null;

    #[Locked]
    public ?string $error = null;

    #[Locked]
    public array $clinics = [];

    #[Locked]
    public array $orgNames = [];

    public static function canAccess(): bool
    {
        return Auth::guard('platform')->check() && ! Auth::guard('platform')->user()->must_change_password;
    }

    public function mount(Platform $platform): void
    {
        $this->filters = array_filter(request()->only('admin_user_id', 'org_id', 'action', 'from', 'to', 'before_seq', 'page_size'), fn ($value) => $value !== null && $value !== '');
        if (isset($this->filters['page_size']) && is_string($this->filters['page_size']) && ctype_digit($this->filters['page_size'])) {
            $this->filters['page_size'] = (int) $this->filters['page_size'];
        }
        $result = $platform->logs(Auth::guard('platform')->id(), $this->filters);
        if (! $result['ok']) {
            if ($result['reason'] === 'session_invalid') {
                session()->forget('platform_session_id');
                $this->redirect(route('filament.admin.auth.login'));

                return;
            }
            $this->error = Refusal::message($result);

            return;
        }
        $this->rows = $result['rows'];
        $this->next = $result['next_before_seq'];
        $session = Auth::guard('platform')->id();
        $names = $platform->orgNames($session, array_values(array_unique(array_filter(array_column($this->rows, 'org_id')))));
        $clinics = $platform->orgList($session);
        foreach ([$names, $clinics] as $read) {
            if (! $read['ok']) {
                $this->error = Refusal::message($read);
                $this->rows = [];
                $this->next = null;
                if ($read['reason'] === 'session_invalid') {
                    session()->forget('platform_session_id');
                    $this->redirect(route('filament.admin.auth.login'));
                }

                return;
            }
        }
        $this->orgNames = $names['names'];
        $this->clinics = array_map(fn ($row) => ['org_id' => $row['id'], 'org_name' => $row['name']], $clinics['clinics']);
    }

    public function getHeading(): string
    {
        return '';
    }
}
