<?php

use App\Support\Figures;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

beforeEach(function () { $this->fixture = panelFixtureCommand('create'); });
afterEach(function () {
    panelFixtureCommand('retire', $this->fixture['id']);
    DB::disconnect();
});

function clinicPage(string $path): mixed
{
    return test()->withSession(['platform_session_id' => test()->fixture['session']])->get($path);
}

function clinicState(array $data, ?string $target = null): mixed
{
    return test()->withSession(['platform_session_id' => test()->fixture['session']])->post('/clinics/'.($target ?? test()->fixture['org']).'/state', $data);
}

test('the figures table renders every Arabic column exact pounds ISO inputs and clinic links', function () {
    panelFixtureCommand('clinic', $this->fixture['id']);
    $response = clinicPage('/panel/clinics?from=2026-07-01&to=2026-07-01')->assertOk();
    $xpath = logPresentationDocument($response);
    foreach (Figures::COLUMNS as $label) $response->assertSee($label);
    $row = $xpath->query('//tr[@data-org-id="'.$this->fixture['org'].'"]')->item(0);
    expect($row)->not->toBeNull();
    foreach (['billed_piastres' => '123.45', 'collected_piastres' => '100.01', 'active_locations' => '1', 'active_practitioners' => '1', 'active_members' => '1'] as $key => $value) {
        expect(trim($xpath->query('.//*[@data-figure="'.$key.'"]', $row)->item(0)->textContent))->toBe($value);
    }
    expect($xpath->query('.//a', $row)->item(0)->getAttribute('href'))->toEndWith('/panel/clinic/'.$this->fixture['org']);
    foreach (['from', 'to'] as $name) {
        $input = $xpath->query('//input[@name="'.$name.'"]')->item(0);
        expect($input->getAttribute('type'))->toBe('text')->and($input->getAttribute('dir'))->toBe('ltr')->and($input->getAttribute('placeholder'))->toBe('YYYY-MM-DD');
    }
    expect($xpath->query('//header//a[contains(@href,"/panel/admin-log")]')->length)->toBe(1);
    expect(Figures::value('billed_piastres', '9223372036854775807'))->toBe('92233720368547758.07')
        ->and(Figures::value('billed_piastres', 1))->toBe('0.01')->and(Figures::value('billed_piastres', -1))->toBe('-0.01');
});

test('period changes include and exclude the seeded invoice and payment', function () {
    panelFixtureCommand('clinic', $this->fixture['id']);
    foreach (['2026-07-01' => '123.45', '2026-07-02' => '0.00'] as $date => $expected) {
        $xpath = logPresentationDocument(clinicPage('/panel/clinics?from='.$date.'&to='.$date)->assertOk());
        expect($xpath->query('//tr[@data-org-id="'.$this->fixture['org'].'"]//*[@data-figure="billed_piastres"]')->item(0)->textContent)->toBe($expected);
    }
});

test('malformed impossible non scalar reversed and long clinic periods show the mapped refusal with no rows', function (array $query) {
    clinicPage('/panel/clinics?'.http_build_query($query))->assertOk()->assertSee('راجع البيانات وحاول تاني')->assertDontSee('data-org-id=', false);
})->with([
    [['from' => 'bad']], [['from' => '0000-01-01']], [['from' => '2026-02-30']], [['to' => ['2026-07-01']]],
    [['from' => '2026-07-02', 'to' => '2026-07-01']], [['from' => '2024-01-01', 'to' => '2025-01-01']],
]);

test('clinic detail shows only its own name locations state and scoped log link', function () {
    panelFixtureCommand('clinic', $this->fixture['id']);
    $foreign = panelFixtureCommand('create');
    try {
        $response = clinicPage('/panel/clinic/'.$this->fixture['org'])->assertOk()->assertSee($this->fixture['orgName'])->assertSee('فرع التجربة')->assertSee('شغّالة')->assertSee('إيقاف العيادة')->assertDontSee($foreign['orgName']);
        $xpath = logPresentationDocument($response);
        expect($xpath->query('//textarea[@name="reason"]')->item(0)->getAttribute('maxlength'))->toBe('200');
        expect($xpath->query('//textarea[@name="reason" and @required]')->length)->toBe(1);
        expect($xpath->query('//a[contains(@href,"org_id='.$this->fixture['org'].'")]')->length)->toBe(1);
    } finally {
        panelFixtureCommand('retire', $foreign['id']);
    }
});

test('unknown and malformed clinic routes refuse without offering a state form', function () {
    clinicPage('/panel/clinic/'.Str::uuid())->assertOk()->assertSee('البيانات دي مش موجودة')->assertDontSee('name="reason"', false);
    clinicPage('/panel/clinic/not-a-uuid')->assertNotFound();
});

test('disable records its Arabic reason and chip and enable clears both through fresh step ups', function () {
    $org = $this->fixture['org'];
    clinicState(['otp' => panelOtp($this->fixture), 'disabled' => '1', 'reason' => 'سبب التجربة'])->assertRedirect('/panel/clinic/'.$org)->assertSessionHas('notice', 'اتوقفت العيادة');
    expect(panelFixtureCommand('org-state', $this->fixture['id'])['disabled_reason'])->toBe('سبب التجربة');
    clinicPage('/panel/clinic/'.$org)->assertOk()->assertSee('موقوفة')->assertSee('سبب التجربة')->assertSee('تشغيل العيادة');
    $xpath = logPresentationDocument(clinicPage('/panel/clinics')->assertOk());
    expect($xpath->query('//tr[@data-org-id="'.$org.'"]//*[contains(@class,"state-chip")]')->item(0)->textContent)->toBe('موقوفة');
    clinicState(['otp' => panelOtp($this->fixture, 1), 'disabled' => '0'])->assertRedirect('/panel/clinic/'.$org)->assertSessionHas('notice', 'اشتغلت العيادة');
    expect(panelFixtureCommand('org-state', $this->fixture['id']))->toBe(['disabled_at' => null, 'disabled_reason' => null]);
});

test('each organization action refusal maps its actual database result and leaves the clinic unchanged', function (string $case, string $message) {
    $data = ['otp' => panelOtp($this->fixture), 'disabled' => '1', 'reason' => 'سبب التجربة'];
    if ($case === 'wrong') $data['otp'] = panelFixtureCommand('wrong-otp', $this->fixture['id'])['otp'];
    if ($case === 'recovery') $data['otp'] = $this->fixture['recovery'];
    if ($case === 'blank') $data['reason'] = '  ';
    if ($case === 'long') $data['reason'] = str_repeat('س', 201);
    if ($case === 'invalid') $data['disabled'] = 'bad';
    if ($case === 'unchanged') $data['disabled'] = '0';
    $org = $case === 'unknown' ? (string) Str::uuid() : $this->fixture['org'];
    clinicState($data, $org)->assertRedirect('/panel/clinic/'.$org)->assertSessionHasErrors(['auth' => $message]);
    expect(session()->getOldInput())->toBe([])->and(panelFixtureCommand('org-state', $this->fixture['id']))->toBe(['disabled_at' => null, 'disabled_reason' => null]);
})->with([
    ['wrong', 'كود التحقق مش صح أو اتستخدم قبل كده'], ['recovery', 'كود التحقق مش صح أو اتستخدم قبل كده'],
    ['blank', 'اكتب سبب الإيقاف، لحد 200 حرف'], ['long', 'اكتب سبب الإيقاف، لحد 200 حرف'],
    ['invalid', 'راجع البيانات وحاول تاني'], ['unchanged', 'الحالة دي متسجّلة بالفعل'], ['unknown', 'البيانات دي مش موجودة'],
]);

test('a consumed organization step up cannot be used again', function () {
    $code = panelOtp($this->fixture);
    clinicState(['otp' => $code, 'disabled' => '1', 'reason' => str_repeat('س', 200)])->assertSessionHas('notice', 'اتوقفت العيادة');
    clinicState(['otp' => $code, 'disabled' => '0'])->assertSessionHasErrors(['auth' => 'كود التحقق مش صح أو اتستخدم قبل كده']);
    expect(panelFixtureCommand('org-state', $this->fixture['id'])['disabled_reason'])->toBe(str_repeat('س', 200));
});

test('clinic routes recheck idle expired and inactive sessions before reads or state posts', function (string $state) {
    panelFixtureCommand($state, $this->fixture['id']);
    foreach (['/panel/clinics', '/panel/clinic/'.$this->fixture['org']] as $path) clinicPage($path)->assertRedirect('/panel/sign-in');
    clinicState(['otp' => 'secret', 'disabled' => '1', 'reason' => 'test'])->assertRedirect('/panel/sign-in');
})->with(['idle', 'expired', 'inactive']);

test('initial passwords cannot view clinic screens or post organization state', function () {
    $must = panelFixtureCommand('create', 'must');
    try {
        foreach (['/panel/clinics', '/panel/clinic/'.$this->fixture['org']] as $path) $this->withSession(['platform_session_id' => $must['session']])->get($path)->assertRedirect('/panel/change-password');
        $this->withSession(['platform_session_id' => $must['session']])->post('/clinics/'.$this->fixture['org'].'/state', ['otp' => 'secret'])->assertRedirect('/panel/change-password');
    } finally {
        panelFixtureCommand('retire', $must['id']);
    }
});

test('log clinic names use one silent list and names call and never a figures query', function () {
    $queries = [];
    DB::listen(function ($query) use (&$queries) { $queries[] = $query->sql; });
    $xpath = logPresentationDocument(clinicPage('/panel/admin-log?org_id='.$this->fixture['org'])->assertOk());
    foreach (['admin_org_list', 'admin_org_names'] as $function) expect(count(array_filter($queries, fn ($sql) => str_contains($sql, 'platform.'.$function.'('))))->toBe(1);
    expect(array_filter($queries, fn ($sql) => str_contains($sql, 'admin_org_figures')))->toBe([]);
    expect($xpath->query('//select[@name="org_id"]/option[1]')->item(0)->textContent)->toBe('كل العيادات');
    expect($xpath->query('//select[@name="org_id"]/option[@selected]')->item(0)->textContent)->toBe($this->fixture['orgName']);
    foreach ($xpath->query('//*[@data-log-clinic]') as $cell) expect($cell->textContent)->toBe($this->fixture['orgName']);
    foreach ($xpath->query('//*[@data-log-org-id]') as $cell) expect($cell->textContent)->toBe($this->fixture['org']);
});

test('hostile clinic and location names stay literal across list detail rows and select options', function (string $payload) {
    panelFixtureCommand('clinic', $this->fixture['id'], json_encode(['name' => $payload, 'location' => $payload], JSON_THROW_ON_ERROR));
    foreach (['/panel/clinics', '/panel/clinic/'.$this->fixture['org'], '/panel/admin-log?org_id='.$this->fixture['org']] as $path) {
        $xpath = logPresentationDocument(clinicPage($path)->assertOk()->assertSee($payload));
        expect($xpath->query('//*[@data-screen]//script|//*[@data-screen]//img|//*[@data-screen]//*[@onerror]')->length)->toBe(0);
        if ($path === '/panel/clinics') expect($xpath->query('//tr[@data-org-id="'.$this->fixture['org'].'"]//a')->item(0)->textContent)->toBe($payload);
        elseif (str_starts_with($path, '/panel/clinic/')) {
            expect($xpath->query('//*[@data-clinic-name]')->item(0)->textContent)->toBe($payload);
            expect($xpath->query('//*[@data-location-name]')->item(0)->textContent)->toBe($payload);
        } else {
            expect($xpath->query('//select[@name="org_id"]/option[@value="'.$this->fixture['org'].'"]')->item(0)->textContent)->toBe($payload);
            foreach ($xpath->query('//*[@data-log-clinic]') as $cell) expect($cell->textContent)->toBe($payload);
        }
    }
})->with(['<script>alert(1)</script>', '"><img src=x onerror=alert(1)>', '{{7*7}}']);


test('clinic cards expose one named heading branches and a full width reason with live count', function () {
    panelFixtureCommand('clinic', $this->fixture['id']);
    $response = clinicPage('/panel/clinic/'.$this->fixture['org'])->assertOk()
        ->assertSee('أجهزة العيادة هتكمّل شغل على الجهاز، والمزامنة هتقف لحد ما العيادة تتشغّل تاني. مفيش أي بيانات بتتمسح.');
    $xpath = logPresentationDocument($response);
    expect($xpath->query('//h1')->length)->toBe(1);
    expect($xpath->query('//h1')->item(0)->textContent)->toBe($this->fixture['orgName']);
    expect($xpath->query('//section[@aria-labelledby="clinic-locations"]/h2')->item(0)->textContent)->toBe('الفروع (1)');
    expect($xpath->query('//section[@aria-labelledby="clinic-locations"]//li')->item(0)->textContent)->toBe('فرع التجربة');
    expect($xpath->query('//section[@aria-labelledby="clinic-name"]/a')->item(0)->getAttribute('class'))->toBe('text-link');
    expect($xpath->query('//output[@aria-live="polite"]')->item(0)->textContent)->toBe('0/200');
    expect($xpath->query('//section[@aria-labelledby="clinic-action-title"]//button[@data-open-step-up]')->item(0)->getAttribute('class'))->toContain('run-danger');
});

test('disabled clinic summary renders Cairo minute and escaped reason with the enable action', function () {
    $reason = '<img src=x onerror=alert(1)>';
    clinicState(['otp' => panelOtp($this->fixture), 'disabled' => '1', 'reason' => $reason])->assertSessionHas('notice', 'اتوقفت العيادة');
    $state = panelFixtureCommand('org-state', $this->fixture['id']);
    $minute = (new DateTimeImmutable($state['disabled_at']))->setTimezone(new DateTimeZone('Africa/Cairo'))->format('Y-m-d H:i');
    $response = clinicPage('/panel/clinic/'.$this->fixture['org'])->assertOk()->assertSee($reason)
        ->assertSee('المزامنة هترجع، وكل اللي اتسجّل على الأجهزة وقت الإيقاف هيتبعت.');
    $xpath = logPresentationDocument($response);
    expect($xpath->query('//*[@data-disabled-reason]')->item(0)->textContent)->toBe('موقوفة من '.$minute.' — السبب: '.$reason);
    expect($xpath->query('//*[@data-disabled-reason]//img')->length)->toBe(0);
    expect($xpath->query('//textarea[@name="reason"]')->length)->toBe(0);
    $button = $xpath->query('//section[@aria-labelledby="clinic-action-title"]//button[@data-open-step-up]')->item(0);
    expect($button->textContent)->toBe('تشغيل العيادة')->and($button->getAttribute('class'))->not->toContain('run-danger');
});


test('clinic and log navigation mark only their current section including clinic detail', function (string $path, string $label) {
    $response = clinicPage($path === 'detail' ? '/panel/clinic/'.$this->fixture['org'] : $path)->assertOk();
    $xpath = logPresentationDocument($response);
    $active = $xpath->query('//nav[@aria-label="التنقل"]/a[@aria-current="page"]');
    expect($active->length)->toBe(1)->and(trim($active->item(0)->textContent))->toBe($label)
        ->and($active->item(0)->getAttribute('class'))->toContain('nav-active');
    expect($xpath->query('//details[contains(@class,"mobile-account")]/summary')->item(0)->textContent)->toBe('الحساب');
    expect($xpath->query('//details[contains(@class,"mobile-account")]//form[@method="post"]//input[@name="_token"]')->length)->toBe(1);
})->with([['/panel/clinics', 'العيادات'], ['detail', 'العيادات'], ['/panel/admin-log', 'سجل الإدارة']]);

test('B5 clinic cards show scoped devices codes approvals and escaped location names', function () {
    $hostile = '<img src=x onerror=alert(1)>';
    $b5 = panelFixtureCommand('b5', $this->fixture['id'], json_encode(['location' => $hostile], JSON_THROW_ON_ERROR));
    $response = clinicPage('/panel/clinic/'.$this->fixture['org'])->assertOk();
    foreach (['الأجهزة', 'أكواد التفعيل', 'طلبات مستنية موافقة', 'طلب كود تفعيل جهاز', 'طلب كود استرجاع للمالك', 'إلغاء الجهاز'] as $label) $response->assertSee($label);
    $xpath = logPresentationDocument($response);
    expect($xpath->query('//*[@data-device-id="'.$b5['device'].'"]')->length)->toBe(1);
    expect($xpath->query('//*[@data-screen]//img|//*[@data-screen]//*[@onerror]')->length)->toBe(0);
    expect($xpath->query('//select[@name="location_id"]/option[@value="'.$b5['location'].'"]')->item(0)->textContent)->toBe($hostile);
});

test('B5 device revoke uses step up and reports unchanged on repetition', function () {
    $b5 = panelFixtureCommand('b5', $this->fixture['id']);
    $path = '/clinics/'.$this->fixture['org'].'/devices/'.$b5['device'].'/revoke';
    $this->withSession(['platform_session_id' => $this->fixture['session']])->post($path, ['otp' => panelOtp($this->fixture)])
        ->assertRedirect('/panel/clinic/'.$this->fixture['org'])->assertSessionHas('notice', 'اتلغى الجهاز');
    clinicPage('/panel/clinic/'.$this->fixture['org'])->assertOk()->assertSee('ملغي');
    $this->withSession(['platform_session_id' => $this->fixture['session']])->post($path, ['otp' => panelOtp($this->fixture, 1)])
        ->assertSessionHasErrors(['auth' => 'الحالة دي متسجّلة بالفعل']);
});

test('B5 one admin receives the code once in a copy dialog and a reused step up refuses', function () {
    $b5 = panelFixtureCommand('b5', $this->fixture['id']);
    $others = panelFixtureCommand('solo', $this->fixture['id'])['others'];
    try {
        $path = '/clinics/'.$this->fixture['org'].'/codes/request';
        $data = ['otp' => panelOtp($this->fixture), 'location_id' => $b5['location'], 'purpose' => 'device'];
        $response = $this->withSession(['platform_session_id' => $this->fixture['session']])->post($path, $data)->assertOk()
            ->assertSee('الكود ده بيظهر مرة واحدة بس، ابعته للعيادة دلوقتي')->assertSee('نسخ الكود');
        expect($response->getContent())->toMatch('/CLT-[2-9A-HJKMNP-Z]{4}(?:-[2-9A-HJKMNP-Z]{4}){3}/');
        expect(session()->has('minted_code'))->toBeFalse();
        $this->withSession(['platform_session_id' => $this->fixture['session']])->post($path, $data)
            ->assertSessionHasErrors(['auth' => 'كود التحقق مش صح أو اتستخدم قبل كده']);
        clinicPage('/panel/clinic/'.$this->fixture['org'])->assertDontSee('الكود ده بيظهر مرة واحدة بس، ابعته للعيادة دلوقتي');
    } finally {
        panelFixtureCommand('restore', $this->fixture['id'], json_encode($others, JSON_THROW_ON_ERROR));
    }
});

test('B5 two admins request and approve while requester cannot see approval button', function () {
    $b5 = panelFixtureCommand('b5', $this->fixture['id']);
    $second = panelFixtureCommand('create');
    try {
        $path = '/clinics/'.$this->fixture['org'].'/codes/request';
        $this->withSession(['platform_session_id' => $this->fixture['session']])->post($path,
            ['otp' => panelOtp($this->fixture), 'location_id' => $b5['location'], 'purpose' => 'owner_recovery'])
            ->assertSessionHas('notice', 'طلب الكود مستني موافقة مسؤول تاني');
        $xpath = logPresentationDocument(clinicPage('/panel/clinic/'.$this->fixture['org'])->assertOk());
        $approval = $xpath->query('//*[@data-approval-id]')->item(0);
        expect($approval)->not->toBeNull();
        expect($xpath->query('.//button[text()="موافقة"]', $approval)->length)->toBe(0);
        $id = $approval->getAttribute('data-approval-id');
        $this->withSession(['platform_session_id' => $second['session']])->post('/clinics/'.$this->fixture['org'].'/codes/'.$id.'/approve', ['otp' => panelOtp($second)])
            ->assertOk()->assertSee('الكود ده بيظهر مرة واحدة بس، ابعته للعيادة دلوقتي');
        $this->withSession(['platform_session_id' => $second['session']])->post('/clinics/'.$this->fixture['org'].'/codes/'.$id.'/approve', ['otp' => panelOtp($second, 1)])
            ->assertSessionHasErrors(['auth' => 'الحالة دي متسجّلة بالفعل']);
    } finally {
        panelFixtureCommand('retire', $second['id']);
    }
});

test('B5 code request refuses a location from another clinic', function () {
    panelFixtureCommand('b5', $this->fixture['id']);
    $other = panelFixtureCommand('create');
    try {
        $foreign = panelFixtureCommand('b5', $other['id']);
        $this->withSession(['platform_session_id' => $this->fixture['session']])
            ->post('/clinics/'.$this->fixture['org'].'/codes/request',
                ['otp' => panelOtp($this->fixture), 'location_id' => $foreign['location'], 'purpose' => 'device'])
            ->assertSessionHasErrors(['auth' => 'الفرع ده مش تابع للعيادة']);
    } finally {
        panelFixtureCommand('retire', $other['id']);
    }
});

test('B5 expired approval returns its mapped refusal to the second admin', function () {
    $b5 = panelFixtureCommand('b5', $this->fixture['id']);
    $second = panelFixtureCommand('create');
    try {
        $this->withSession(['platform_session_id' => $this->fixture['session']])
            ->post('/clinics/'.$this->fixture['org'].'/codes/request',
                ['otp' => panelOtp($this->fixture), 'location_id' => $b5['location'], 'purpose' => 'device'])
            ->assertSessionHas('notice', 'طلب الكود مستني موافقة مسؤول تاني');
        $xpath = logPresentationDocument(clinicPage('/panel/clinic/'.$this->fixture['org'])->assertOk());
        $approval = $xpath->query('//*[@data-approval-id]')->item(0)->getAttribute('data-approval-id');
        panelFixtureCommand('expire-approval', $this->fixture['id'], $approval);
        $this->withSession(['platform_session_id' => $second['session']])
            ->post('/clinics/'.$this->fixture['org'].'/codes/'.$approval.'/approve', ['otp' => panelOtp($second)])
            ->assertSessionHasErrors(['auth' => 'طلب الموافقة انتهى، اطلب كود جديد']);
    } finally {
        panelFixtureCommand('retire', $second['id']);
    }
});
