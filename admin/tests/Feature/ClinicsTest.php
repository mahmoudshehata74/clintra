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
        expect($xpath->query('//input[@name="reason"]')->item(0)->getAttribute('maxlength'))->toBe('200');
        expect($xpath->query('//input[@name="reason" and @required]')->length)->toBe(1);
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
