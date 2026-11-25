<?php

namespace App\Support;

final class Refusal
{
    public static function supportMessage(array $result): string
    {
        return match ($result['reason'] ?? '') {
            'not_found' => 'الكود ده مش صحيح',
            'unchanged' => 'الكود ده اتستخدم قبل كده',
            'expired' => 'الكود ده خلص، اطلب من المالك كود جديد',
            'org_disabled' => 'حساب العيادة موقوف',
            'no_owner' => 'اللي عمل الكود مبقاش مالك للعيادة',
            'support_active' => 'فيه دعم شغال للعيادة دي دلوقتي',
            default => self::message($result),
        };
    }

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
            'org_disabled' => 'العيادة موقوفة، شغّلها قبل إصدار الكود',
            'location_mismatch' => 'الفرع ده مش تابع للعيادة',
            'no_owner' => 'مفيش مالك نشط للعيادة',
            'expired' => 'طلب الموافقة انتهى، اطلب كود جديد',
            'same_admin' => 'لازم مسؤول تاني يوافق على الطلب',
            'approval_unavailable' => 'الموافقة مش متاحة، اطلب كود جديد',
            default => 'الطلب ماكملش، حاول تاني',
        };
    }
}
