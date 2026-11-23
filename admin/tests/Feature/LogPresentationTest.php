<?php

use App\Support\ActionLabels;
use Illuminate\Support\Facades\DB;

beforeEach(function () { $this->fixture = panelFixtureCommand('create'); });
afterEach(function () {
    panelFixtureCommand('retire', $this->fixture['id']);
    DB::disconnect();
});

function presentationRow(array $fixture, array $payload): string
{
    return panelFixtureCommand('log-row', $fixture['id'], json_encode($payload, JSON_THROW_ON_ERROR))['id'];
}

function presentationResponse(): mixed
{
    return test()->withSession(['platform_session_id' => test()->fixture['session']])
        ->get('/panel/admin-log?org_id='.test()->fixture['org'])->assertOk();
}

test('anonymous actors distinguish command line actions and unknown actors and show attempted email only for login', function () {
    $email = '"><img src=x onerror=alert(1)>';
    $rows = [];
    foreach (['cli.org_disable' => 'من سطر الأوامر', 'admin.login' => 'مش معروف', 'device.revoke' => 'مش معروف'] as $action => $label) {
        $rows[] = [presentationRow($this->fixture, ['action' => $action, 'anonymous' => true, 'detail' => ['email' => $email]]), $action, $label];
    }
    $xpath = logPresentationDocument(presentationResponse());
    foreach ($rows as [$id, $action, $label]) {
        $actor = $xpath->query('//tr[@data-log-id="'.$id.'"]/*[@data-log-actor]')->item(0);
        expect($actor)->not->toBeNull()->and(trim($actor->textContent))->toContain($label);
        $attempt = $xpath->query('.//*[@data-attempted-email]', $actor);
        expect($attempt->length)->toBe($action === 'admin.login' ? 1 : 0);
        if ($action === 'admin.login') {
            expect($attempt->item(0)->textContent)->toBe($email)->and($attempt->item(0)->getAttribute('dir'))->toBe('ltr');
        }
    }
    expect($xpath->query('//tr//img|//tr//*[@onerror]')->length)->toBe(0);
});

test('a resolved admin retains their name in the log', function () {
    $id = presentationRow($this->fixture, ['action' => 'admin.login']);
    $xpath = logPresentationDocument(presentationResponse());
    expect(trim($xpath->query('//tr[@data-log-id="'.$id.'"]/*[@data-log-actor]')->item(0)->textContent))->toBe('مسؤول التجربة');
});

test('every installed action CHECK value has exactly one Arabic label and filter option', function () {
    $actions = [];
    foreach (DB::select("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='platform.admin_log'::regclass AND contype='c'") as $check) {
        if (str_contains($check->definition, 'action')) {
            preg_match_all("/'([^']+)'::text/", $check->definition, $matches);
            $actions = array_merge($actions, $matches[1]);
        }
    }
    expect($actions)->not->toBeEmpty()->and(array_keys(ActionLabels::ALL))->toEqualCanonicalizing($actions);
    $response = $this->withSession(['platform_session_id' => $this->fixture['session']])
        ->get('/panel/admin-log?org_id='.$this->fixture['org'].'&action=org.disable')->assertOk();
    $xpath = logPresentationDocument($response);
    $options = $xpath->query('//select[@name="action"]/option');
    expect($options->length)->toBe(count($actions) + 1)->and($options->item(0)->textContent)->toBe('كل الإجراءات')->and($options->item(0)->getAttribute('value'))->toBe('');
    foreach (ActionLabels::ALL as $code => $label) {
        expect($label)->toMatch('/[\x{0600}-\x{06FF}]/u');
        $option = $xpath->query('//select[@name="action"]/option[@value="'.$code.'"]');
        expect($option->length)->toBe(1)->and($option->item(0)->textContent)->toBe($label);
    }
    expect($xpath->query('//select[@name="action"]/option[@selected]')->item(0)->getAttribute('value'))->toBe('org.disable');
    $response->assertSee('إيقاف العيادة')->assertDontSee('تشغيل العيادة</td>', false);
});

test('log dates retain text inputs Latin ISO placeholders patterns and the inclusive period hint', function () {
    $response = presentationResponse();
    $xpath = logPresentationDocument($response);
    foreach (['from', 'to'] as $name) {
        $input = $xpath->query('//input[@name="'.$name.'"]')->item(0);
        expect($input->getAttribute('type'))->toBe('text')->and($input->getAttribute('dir'))->toBe('ltr')
            ->and($input->getAttribute('placeholder'))->toBe('YYYY-MM-DD')->and($input->getAttribute('pattern'))->toBe('[0-9]{4}-[0-9]{2}-[0-9]{2}');
    }
    $response->assertSee('لو سيبت الفترة فاضية، هيظهر آخر 30 يوم. الفترة لحد 366 يوم.');
});

test('the log refuses malformed impossible reversed and oversized periods before rendering any rows', function (array $query) {
    $this->withSession(['platform_session_id' => $this->fixture['session']])->get('/panel/admin-log?'.http_build_query($query))
        ->assertOk()->assertSee('راجع البيانات وحاول تاني')->assertDontSee('data-log-id=', false);
})->with([
    [['from' => '21/11/2026']], [['to' => '2026-11-31']], [['from' => '2026-1-01']],
    [['from' => '2026-11-22', 'to' => '2026-11-21']], [['from' => '2025-01-01', 'to' => '2026-11-21']],
]);

test('all hostile log strings remain literal in actor and expanded detail fields', function (string $payload) {
    $id = presentationRow($this->fixture, ['action' => 'admin.login', 'anonymous' => true, 'reason' => $payload,
        'user_agent' => $payload, 'detail' => ['email' => $payload, 'host_user' => $payload]]);
    $xpath = logPresentationDocument(presentationResponse());
    $row = $xpath->query('//tr[@data-log-id="'.$id.'"]')->item(0);
    expect($row)->not->toBeNull();
    foreach (['data-attempted-email', 'data-log-user-agent', 'data-log-reason', 'data-log-host-user'] as $attribute) {
        expect($xpath->query('.//*[@'.$attribute.']', $row)->item(0)->textContent)->toBe($payload);
    }
    expect($xpath->query('.//script|.//img|.//*[@onerror]', $row)->length)->toBe(0);
})->with(['<script>alert(1)</script>', '"><img src=x onerror=alert(1)>', '{{7*7}}']);
