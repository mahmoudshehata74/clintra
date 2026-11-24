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
            <section class="detail-card" aria-labelledby="clinic-devices"><h2 id="clinic-devices">الأجهزة</h2>
                @forelse ($devices as $device)
                    <div class="device-row" data-device-id="{{ $device['id'] }}">
                        <span><small>الفرع</small>{{ $device['location_name'] }}</span>
                        <span><small>السلسلة</small><bdi dir="ltr">{{ $device['series'] }}</bdi></span>
                        <span><small>التسجيل</small><bdi dir="ltr">{{ (new DateTimeImmutable($device['registered_at']))->setTimezone(new DateTimeZone('Africa/Cairo'))->format('Y-m-d H:i') }}</bdi></span>
                        <span><small>آخر مزامنة</small>@if ($device['last_sync_at'])<bdi dir="ltr">{{ (new DateTimeImmutable($device['last_sync_at']))->setTimezone(new DateTimeZone('Africa/Cairo'))->format('Y-m-d H:i') }}</bdi>@else لسه @endif</span>
                        <span><small>الحالة</small>{{ $device['revoked_at'] ? 'ملغي' : 'نشط' }}</span>
                        @unless ($device['revoked_at'])
                            <form method="post" action="{{ route('panel.device-revoke', ['org'=>$clinic['id'],'device'=>$device['id']]) }}">@csrf
                                <button type="button" class="run run-danger" data-open-step-up>إلغاء الجهاز</button>
                                <x-step-up id="revoke-{{ $device['id'] }}" />
                            </form>
                        @endunless
                    </div>
                @empty <p>مفيش أجهزة</p> @endforelse
            </section>
            <section class="detail-card" aria-labelledby="clinic-codes"><h2 id="clinic-codes">أكواد التفعيل</h2>
                <div class="code-actions">
                    @foreach (['device'=>'طلب كود تفعيل جهاز','owner_recovery'=>'طلب كود استرجاع للمالك'] as $purpose=>$label)
                        <form method="post" action="{{ route('panel.code-request', ['org'=>$clinic['id']]) }}">@csrf
                            <input type="hidden" name="purpose" value="{{ $purpose }}">
                            <label class="field" for="code-location-{{ $purpose }}">الفرع
                                <select class="in" id="code-location-{{ $purpose }}" name="location_id" required>
                                    <option value="">اختار الفرع</option>
                                    @foreach ($clinic['locations'] as $location)<option value="{{ $location['id'] }}">{{ $location['name'] }}</option>@endforeach
                                </select>
                            </label>
                            <button class="run" type="button" data-open-step-up>{{ $label }}</button>
                            <x-step-up id="request-{{ $purpose }}" />
                        </form>
                    @endforeach
                </div>
            </section>
            <section class="detail-card" aria-labelledby="clinic-approvals"><h2 id="clinic-approvals">طلبات مستنية موافقة</h2>
                @forelse ($approvals as $approval)
                    <div class="approval-row" data-approval-id="{{ $approval['id'] }}">
                        <span>{{ $approval['purpose'] === 'device' ? 'كود تفعيل جهاز' : 'كود استرجاع للمالك' }} — {{ $approval['location_name'] }}</span>
                        <bdi dir="ltr">{{ (new DateTimeImmutable($approval['expires_at']))->setTimezone(new DateTimeZone('Africa/Cairo'))->format('Y-m-d H:i') }}</bdi>
                        @if ($approval['can_approve'])
                            <form method="post" action="{{ route('panel.code-approve', ['org'=>$clinic['id'],'approval'=>$approval['id']]) }}">@csrf
                                <button class="run" type="button" data-open-step-up>موافقة</button>
                                <x-step-up id="approve-{{ $approval['id'] }}" />
                            </form>
                        @endif
                    </div>
                @empty <p>مفيش طلبات مستنية موافقة</p> @endforelse
            </section>
            <section class="detail-card {{ $clinic['disabled_at'] ? '' : 'danger-card' }}" aria-labelledby="clinic-action-title">
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
