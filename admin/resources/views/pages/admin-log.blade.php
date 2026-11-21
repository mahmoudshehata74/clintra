<div class="panel-shell" data-screen="admin-log">
    <header class="appbar"><div class="brand"><span class="logo" aria-hidden="true">C</span><h1>سجل الإدارة</h1></div><a class="quiet" href="{{ route('filament.admin.pages.change-password') }}">تغيير كلمة السر</a><x-sign-out /></header>
    <main class="panel-main">
        @if (session('notice'))<p role="status" class="notice">{{ session('notice') }}</p>@endif
        @if ($error)<p role="alert" class="refusal">{{ $error }}</p>@endif
        <form method="get" action="{{ route('filament.admin.pages.admin-log') }}" class="filters" aria-label="فلاتر سجل الإدارة">
            @foreach (['admin_user_id'=>'المسؤول', 'org_id'=>'العيادة'] as $key=>$label)
            <label class="field" for="filter-{{ $key }}">{{ $label }}<input class="in" id="filter-{{ $key }}" name="{{ $key }}" dir="ltr" value="{{ is_scalar($filters[$key] ?? '') ? ($filters[$key] ?? '') : '' }}" maxlength="100"></label>
            @endforeach
            <div class="field"><label for="filter-action">الإجراء</label><select class="in" id="filter-action" name="action"><option value="">كل الإجراءات</option>@foreach (App\Support\ActionLabels::ALL as $code=>$label)<option value="{{ $code }}" @selected(($filters['action'] ?? '') === $code)>{{ $label }}</option>@endforeach</select></div>
            @foreach (['from'=>'من','to'=>'لحد'] as $key=>$label)
            <label class="field" for="filter-{{ $key }}">{{ $label }}<input class="in" id="filter-{{ $key }}" name="{{ $key }}" type="text" dir="ltr" placeholder="2026-11-21" pattern="[0-9]{4}-[0-9]{2}-[0-9]{2}" maxlength="10" value="{{ is_scalar($filters[$key] ?? '') ? ($filters[$key] ?? '') : '' }}"></label>
            @endforeach
            <label class="field" for="page-size">عدد الصفوف<select class="in" id="page-size" name="page_size">@foreach ([1,25,50,100] as $size)<option value="{{ $size }}" @selected(($filters['page_size'] ?? 25)===$size)>{{ $size }}</option>@endforeach</select></label>
            <button class="run" type="submit">تصفية</button><a class="quiet" href="{{ route('filament.admin.pages.admin-log') }}">مسح الفلاتر</a>
        </form>
        <p class="hint">لو سيبت الفترة فاضية، هيظهر آخر 30 يوم. الفترة لحد 366 يوم.</p>
        <p class="hint table-hint">اسحب الجدول علشان تشوف باقي التفاصيل</p><div class="table-scroll" tabindex="0" role="region" aria-label="سجل الإدارة، قابل للسحب"><table aria-label="سجل الإدارة"><thead><tr><th>الوقت</th><th>المسؤول</th><th>الإجراء</th><th>العيادة</th><th>النتيجة</th><th>التفاصيل</th></tr></thead><tbody>
        @forelse ($rows as $row)
            <tr data-seq="{{ $row['seq'] }}" data-log-id="{{ $row['id'] }}"><td dir="ltr">{{ (new DateTimeImmutable($row['at']))->setTimezone(new DateTimeZone('Africa/Cairo'))->format('Y-m-d H:i:s') }}</td><td data-log-actor>
                @if ($row['admin_name'] !== null){{ $row['admin_name'] }}
                @elseif (str_starts_with($row['action'], 'cli.'))من سطر الأوامر
                @else مش معروف
                @endif
                @if ($row['admin_user_id'] === null && $row['action'] === 'admin.login' && is_string($row['detail']['email'] ?? null))
                    <div dir="ltr" data-attempted-email>{{ $row['detail']['email'] }}</div>
                @endif
            </td><td>{{ App\Support\ActionLabels::ALL[$row['action']] }}</td><td dir="ltr">{{ $row['org_id'] ?? '—' }}</td><td><span class="{{ $row['succeeded'] ? 'success' : 'failure' }}">{{ $row['succeeded'] ? 'تم' : App\Support\Refusal::message(['reason'=>$row['reason']]) }}</span></td>
            <td><details><summary>عرض التفاصيل</summary><dl><dt>رقم السجل</dt><dd dir="ltr">{{ $row['seq'] }}</dd><dt>المسؤول</dt><dd dir="ltr">{{ $row['admin_user_id'] ?? '—' }}</dd><dt>عنوان الإنترنت</dt><dd dir="ltr">{{ $row['ip'] ?? '—' }}</dd><dt>المتصفح</dt><dd dir="ltr" data-log-user-agent>{{ $row['user_agent'] ?? '—' }}</dd><dt>السبب</dt><dd dir="ltr" data-log-reason>{{ $row['reason'] ?? '—' }}</dd><dt>مستخدم الجهاز</dt><dd dir="ltr" data-log-host-user>{{ is_string($row['detail']['host_user'] ?? null) ? $row['detail']['host_user'] : '—' }}</dd><dt>الهدف</dt><dd dir="ltr">{{ $row['target_id'] ?? '—' }}</dd><dt>التفاصيل</dt><dd><pre>{{ json_encode($row['detail'], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) }}</pre></dd></dl></details></td></tr>
        @empty<tr><td colspan="6" class="empty">مفيش سجلات في الفترة دي</td></tr>@endforelse
        </tbody></table></div>
        <nav class="paging" aria-label="صفحات السجل"><a class="quiet" href="{{ route('filament.admin.pages.admin-log', array_diff_key($filters, ['before_seq'=>true])) }}">الأحدث</a>@if ($next)<a class="run" rel="next" href="{{ route('filament.admin.pages.admin-log', array_replace($filters, ['before_seq'=>$next])) }}">الأقدم</a>@endif</nav>
    </main>
</div>
