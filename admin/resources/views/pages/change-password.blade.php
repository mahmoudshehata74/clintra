<div class="install-scr" data-screen="change-password">
    <div class="install-hero"><h1>تغيير كلمة السر</h1></div>
    <form action="{{ route('panel.password') }}" method="post" data-step-up-form>
        @csrf
        <div class="install-body">
            <x-session-error />
            @if (auth('platform')->user()->must_change_password)<p class="hint">لازم تغيّر كلمة السر الأول</p>@endif
            <label class="field" for="current-password">كلمة السر الحالية<input class="in" id="current-password" name="current_password" type="password" autocomplete="current-password" required></label>
            <label class="field" for="new-password">كلمة السر الجديدة<input class="in" id="new-password" name="password" type="password" autocomplete="new-password" required></label>
            <label class="field" for="repeat-password">كرّر كلمة السر الجديدة<input class="in" id="repeat-password" name="password_confirmation" type="password" autocomplete="new-password" required></label>
            <p class="hint">من 12 لحد 72 بايت، وتكون مختلفة عن كلمة السر الحالية</p>
            <button class="run" type="button" data-open-step-up>تغيير كلمة السر</button>
        </div>
        <x-step-up />
    </form>
    <div class="install-foot"><x-sign-out /></div>
</div>
