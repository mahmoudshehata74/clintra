@props(['title', 'heading' => true])
<header class="appbar">
    <div class="brand"><span class="logo" aria-hidden="true">C</span>@if ($heading)<h1>{{ $title }}</h1>@else<p class="brand-title">{{ $title }}</p>@endif</div>
    <nav aria-label="التنقل"><a class="quiet" href="{{ route('filament.admin.pages.clinics') }}">العيادات</a> <a class="quiet" href="{{ route('filament.admin.pages.admin-log') }}">سجل الإدارة</a></nav>
    <a class="quiet" href="{{ route('filament.admin.pages.change-password') }}">تغيير كلمة السر</a><x-sign-out />
</header>
