<?php

namespace App\Support;

final class Refusal
{
    public static function message(array $result): string
    {
        if ($result['all_sessions_ended'] ?? false) {
            return 'اتقفلت كل جلساتك بعد محاولات غلط كتير، ادخل تاني بعد ربع ساعة';
        }

        return match ($result['reason'] ?? '') {
            'bad_credentials', 'current_password_failed' => 'البيانات دي مش صح',
            'rate_limited' => 'محاولات كتير، استنى ربع ساعة',
            'session_invalid' => 'الجلسة انتهت، سجّل الدخول تاني',
            'password_change_required' => 'لازم تغيّر كلمة السر الأول',
            'step_up_failed' => 'كود التحقق مش صح أو اتستخدم قبل كده',
            'invalid_payload', 'malformed_payload' => 'راجع البيانات وحاول تاني',
            'not_found' => 'البيانات دي مش موجودة', 'reason_required' => 'اكتب سبب الإيقاف، لحد 200 حرف',
            'unchanged' => 'الحالة دي متسجّلة بالفعل',
            default => 'الطلب ماكملش، حاول تاني',
        };
    }
}
