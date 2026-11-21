@props(['id' => 'step-up'])
<dialog class="step-up" id="{{ $id }}" aria-labelledby="{{ $id }}-title">
    <div class="install-hero"><h2 id="{{ $id }}-title">اكتب كود التحقق تاني</h2></div>
    <div class="install-body">
        <label class="field" for="{{ $id }}-code">كود التحقق<input class="in" id="{{ $id }}-code" name="otp" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" dir="ltr" autocomplete="one-time-code" required></label>
        <p class="hint">استخدم كود جديد من تطبيق التحقق، كود الاسترجاع للدخول بس</p>
        <button class="run" type="submit" data-confirm-step-up>تأكيد</button>
        <button class="quiet" type="button" data-close-step-up>إلغاء</button>
    </div>
</dialog>
