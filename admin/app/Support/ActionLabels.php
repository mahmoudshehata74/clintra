<?php

namespace App\Support;

final class ActionLabels
{
    public const ALL = [
        'admin.login' => 'تسجيل دخول',
        'admin.logout' => 'تسجيل خروج',
        'admin.password_change' => 'تغيير كلمة السر',
        'admin.log_view' => 'عرض السجل',
        'figures.view' => 'عرض الأرقام والعيادات',
        'org.provision' => 'إنشاء عيادة',
        'code.mint_request' => 'طلب كود تفعيل',
        'code.mint_approve' => 'الموافقة على كود تفعيل',
        'device.revoke' => 'إلغاء جهاز',
        'org.disable' => 'إيقاف العيادة',
        'org.enable' => 'تشغيل العيادة',
        'support.open' => 'دخول دعم',
        'cli.provision' => 'إنشاء عيادة (سطر الأوامر)',
        'cli.mint' => 'كود تفعيل (سطر الأوامر)',
        'cli.revoke' => 'إلغاء جهاز (سطر الأوامر)',
        'cli.admin_create' => 'إضافة مسؤول (سطر الأوامر)',
        'cli.org_disable' => 'إيقاف العيادة (سطر الأوامر)',
        'cli.org_enable' => 'تشغيل العيادة (سطر الأوامر)',
    ];

    public static function row(string $action, array $detail): string
    {
        if ($action !== 'figures.view') return self::ALL[$action];
        return match ($detail['operation'] ?? null) {
            'org.detail' => 'عرض العيادة',
            'org.list', 'org.names' => 'عرض أسماء العيادات',
            default => 'عرض الأرقام',
        };
    }
}
