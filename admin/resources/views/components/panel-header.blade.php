@props(['title', 'heading' => true])
@php
    $clinicsActive = request()->routeIs('filament.admin.pages.clinics', 'filament.admin.pages.clinic');
    $logActive = request()->routeIs('filament.admin.pages.admin-log');
    $supportActive = request()->routeIs('filament.admin.pages.support-entry');
@endphp
<header class="appbar">
    <div class="brand"><span class="logo" aria-hidden="true">C</span>@if ($heading)<h1>{{ $title }}</h1>@else<p class="brand-title">{{ $title }}</p>@endif</div>
    <nav class="panel-nav" aria-label="التنقل">
        <a class="quiet {{ $clinicsActive ? 'nav-active' : '' }}" @if ($clinicsActive) aria-current="page" @endif href="{{ route('filament.admin.pages.clinics') }}">العيادات</a>
        <a class="quiet {{ $logActive ? 'nav-active' : '' }}" @if ($logActive) aria-current="page" @endif href="{{ route('filament.admin.pages.admin-log') }}">سجل الإدارة</a>
        <a class="quiet {{ $supportActive ? 'nav-active' : '' }}" @if ($supportActive) aria-current="page" @endif href="{{ route('filament.admin.pages.support-entry') }}">دخول دعم</a>
    </nav>
    <div class="desktop-account"><a class="quiet" href="{{ route('filament.admin.pages.change-password') }}">تغيير كلمة السر</a><x-sign-out /></div>
    <details class="mobile-account"><summary class="quiet">الحساب</summary><div class="account-items"><a class="quiet" href="{{ route('filament.admin.pages.change-password') }}">تغيير كلمة السر</a><x-sign-out /></div></details>
</header>
