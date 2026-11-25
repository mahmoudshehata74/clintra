<div class="panel-shell" data-screen="support-entry">
    <x-panel-header title="دخول دعم" />
    <main class="panel-main support-main">
        @if ($errors->has('auth'))<p role="alert" class="refusal">{{ $errors->first('auth') }}</p>@endif
        <section class="detail-card" aria-labelledby="support-title">
            <h1 id="support-title">دخول دعم</h1>
            <form method="post" action="{{ route('panel.support-open') }}" class="support-form">
                @csrf
                <label class="field" for="support-code">كود الدعم
                    <input class="in" id="support-code" name="code" type="text" dir="ltr" autocomplete="off" required>
                </label>
                <button class="run" type="button" data-open-step-up>دخول دعم</button>
                <x-step-up id="support-step-up" />
            </form>
        </section>
    </main>
</div>
