<div class="panel-shell" data-screen="clinic">
    <x-panel-header title="العيادة" :heading="$clinic === null" />
    <main class="panel-main">
        @if (session('notice'))<p role="status" class="notice">{{ session('notice') }}</p>@endif
        @if ($errors->has('auth'))<p role="alert" class="refusal">{{ $errors->first('auth') }}</p>@endif
        @if ($error)<p role="alert" class="refusal">{{ $error }}</p>@endif
        @if ($clinic)
            <section class="detail-card clinic-summary" aria-labelledby="clinic-name">
                <div class="clinic-title"><h1 id="clinic-name" data-clinic-name>{{ $clinic['name'] }}</h1><span class="state-chip {{ $clinic['disabled_at'] ? '' : 'state-chip-success' }}" data-clinic-state>{{ $clinic['disabled_at'] ? 'موقوفة' : 'شغّالة' }}</span></div>
                @if ($clinic['disabled_at'])<p data-disabled-reason>موقوفة من <bdi dir="ltr">{{ (new DateTimeImmutable($clinic['disabled_at']))->setTimezone(new DateTimeZone('Africa/Cairo'))->format('Y-m-d H:i') }}</bdi> — السبب: {{ $clinic['disabled_reason'] }}</p>@endif
                <a class="text-link" href="{{ route('filament.admin.pages.admin-log', ['org_id'=>$clinic['id']]) }}">سجل الإدارة للعيادة</a>
            </section>
            <section class="detail-card location-card" aria-labelledby="clinic-locations"><h2 id="clinic-locations">الفروع ({{ count($clinic['locations']) }})</h2><ul>@forelse ($clinic['locations'] as $location)<li data-location-name>{{ $location['name'] }}</li>@empty<li>مفيش فروع</li>@endforelse</ul></section>
            <section class="detail-card danger-card" aria-labelledby="clinic-action-title">
                <h2 id="clinic-action-title">{{ $clinic['disabled_at'] ? 'تشغيل العيادة' : 'إيقاف العيادة' }}</h2>
                <p>{{ $clinic['disabled_at'] ? 'المزامنة هترجع، وكل اللي اتسجّل على الأجهزة وقت الإيقاف هيتبعت.' : 'أجهزة العيادة هتكمّل شغل على الجهاز، والمزامنة هتقف لحد ما العيادة تتشغّل تاني. مفيش أي بيانات بتتمسح.' }}</p>
                <form method="post" action="{{ route('panel.clinic-state', ['org'=>$clinic['id']]) }}" class="clinic-state-form">
                    @csrf
                    <input type="hidden" name="disabled" value="{{ $clinic['disabled_at'] ? '0' : '1' }}">
                    @unless ($clinic['disabled_at'])
                        <label class="field" for="disable-reason">سبب الإيقاف<textarea class="in" id="disable-reason" name="reason" rows="3" required maxlength="200" aria-describedby="disable-reason-count" data-disable-reason></textarea></label>
                        <output class="hint reason-count" id="disable-reason-count" for="disable-reason" dir="ltr" aria-live="polite">0/200</output>
                    @endunless
                    <button class="run {{ $clinic['disabled_at'] ? '' : 'run-danger' }}" type="button" data-open-step-up>{{ $clinic['disabled_at'] ? 'تشغيل العيادة' : 'إيقاف العيادة' }}</button>
                    <x-step-up id="clinic-step-up" />
                </form>
            </section>
        @endif
    </main>
</div>
