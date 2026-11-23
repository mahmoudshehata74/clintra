<div class="panel-shell" data-screen="clinics">
    <x-panel-header title="العيادات" />
    <main class="panel-main">
        @if ($error)<p role="alert" class="refusal">{{ $error }}</p>@endif
        <form method="get" class="filters" aria-label="فترة الأرقام">
            @foreach (['from'=>'من','to'=>'لحد'] as $key=>$label)
                <label class="field" for="period-{{ $key }}">{{ $label }}<input class="in" id="period-{{ $key }}" name="{{ $key }}" type="text" dir="ltr" placeholder="YYYY-MM-DD" pattern="[0-9]{4}-[0-9]{2}-[0-9]{2}" maxlength="10" value="{{ is_scalar($filters[$key] ?? '') ? ($filters[$key] ?? '') : '' }}"></label>
            @endforeach
            <button type="submit" class="run">تصفية</button>
        </form>
        <p class="hint">لو سيبت الفترة فاضية، هيظهر آخر 30 يوم. الفترة لحد 366 يوم. المبالغ بالجنيه.</p>
        <div class="table-scroll responsive-table clinics-table"><table aria-label="العيادات"><thead><tr><th>العيادة</th>@foreach (App\Support\Figures::COLUMNS as $label)<th>{{ $label }}</th>@endforeach<th class="mobile-details">التفاصيل</th></tr></thead><tbody>
        @forelse ($rows as $row)
            <tr data-org-id="{{ $row['org_id'] }}">
                <td data-label="العيادة"><a class="clinic-name" href="{{ route('filament.admin.pages.clinic', ['org'=>$row['org_id']]) }}">{{ $row['org_name'] }}</a>@if ($row['disabled_at']) <span class="state-chip">موقوفة</span>@endif</td>
                @foreach (App\Support\Figures::COLUMNS as $key=>$label)<td class="figure-cell" data-label="{{ $label }}" data-figure="{{ $key }}"><bdi dir="ltr">{{ App\Support\Figures::value($key,$row[$key]) }}</bdi></td>@endforeach
                <td class="mobile-details"><details><summary>عرض التفاصيل</summary><dl>@foreach (App\Support\Figures::COLUMNS as $key=>$label)<dt>{{ $label }}</dt><dd dir="ltr">{{ App\Support\Figures::value($key,$row[$key]) }}</dd>@endforeach</dl></details></td>
            </tr>
        @empty<tr><td class="empty" colspan="13">مفيش عيادات في الفترة دي</td></tr>@endforelse
        </tbody></table></div>
    </main>
</div>
