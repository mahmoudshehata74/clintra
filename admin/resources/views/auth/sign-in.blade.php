<div class="install-scr" data-screen="sign-in">
    <div class="install-hero"><span class="logo" aria-hidden="true">C</span><p class="brand-name" dir="ltr">Clintra</p><h1>تسجيل الدخول</h1></div>
    <form action="{{ route('panel.sign-in') }}" method="post">
        @csrf
        <div class="install-body">
            <x-session-error />
            <label class="field" for="email">البريد الإلكتروني<input class="in" id="email" name="email" type="email" dir="ltr" autocomplete="username" maxlength="254" required autofocus></label>
            <label class="field" for="password">كلمة السر<input class="in" id="password" name="password" type="password" autocomplete="current-password" required></label>
            <label class="field" for="otp">كود التحقق<input class="in" id="otp" name="otp" dir="ltr" autocomplete="one-time-code" maxlength="128" required></label>
            <p class="hint">أو كود من أكواد الاسترجاع</p>
        </div>
        <div class="install-foot"><button class="run" type="submit">تسجيل الدخول</button></div>
    </form>
</div>
