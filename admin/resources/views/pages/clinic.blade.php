<div class="panel-shell" data-screen="clinic">
    <x-panel-header title="العيادة" />
    <main class="panel-main">
        @if (session('notice'))<p role="status" class="notice">{{ session('notice') }}</p>@endif
        @if ($errors->has('auth'))<p role="alert" class="refusal">{{ $errors->first('auth') }}</p>@endif
        @if ($error)<p role="alert" class="refusal">{{ $error }}</p>@endif
        @if ($clinic)
            <h2 data-clinic-name>{{ $clinic['name'] }}</h2>
            <p>الحالة: @if ($clinic['disabled_at'])<span class="state-chip">موقوفة</span>@else<span class="success">شغّالة</span>@endif</p>
            @if ($clinic['disabled_reason'])<p data-disabled-reason>سبب الإيقاف: {{ $clinic['disabled_reason'] }}</p>@endif
            <section aria-label="الفروع"><h2>الفروع</h2><ul>@forelse ($clinic['locations'] as $location)<li data-location-name>{{ $location['name'] }}</li>@empty<li>مفيش فروع</li>@endforelse</ul></section>
            <form method="post" action="{{ route('panel.clinic-state', ['org'=>$clinic['id']]) }}" class="clinic-state-form">
                @csrf
                <input type="hidden" name="disabled" value="{{ $clinic['disabled_at'] ? '0' : '1' }}">
                @unless ($clinic['disabled_at'])<label class="field" for="disable-reason">سبب الإيقاف<input class="in" id="disable-reason" name="reason" required maxlength="200"></label>@endunless
                <button class="run" type="button" data-open-step-up>{{ $clinic['disabled_at'] ? 'تشغيل العيادة' : 'إيقاف العيادة' }}</button>
                <x-step-up id="clinic-step-up" />
            </form>
            <a class="quiet" href="{{ route('filament.admin.pages.admin-log', ['org_id'=>$clinic['id']]) }}">سجل الإدارة للعيادة</a>
        @endif
    </main>
</div>
