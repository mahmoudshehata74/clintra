<?php

use Illuminate\Support\Facades\DB;

beforeEach(function () {
    $this->fixture = panelFixtureCommand('create');
});
afterEach(function () {
    if (isset($this->fixture)) {
        panelFixtureCommand('retire', $this->fixture['id']);
    }
    DB::disconnect();
});

function logPresentationDocument($response): DOMXPath
{
    $document = new DOMDocument;
    $previous = libxml_use_internal_errors(true);
    $document->loadHTML('<?xml encoding="UTF-8">'.$response->getContent());
    libxml_clear_errors();
    libxml_use_internal_errors($previous);

    return new DOMXPath($document);
}

function logPresentationRow(array $fixture, array $payload): string
{
    return panelFixtureCommand('log-row', $fixture['id'], json_encode($payload, JSON_THROW_ON_ERROR))['id'];
}

test('anonymous log actors distinguish CLI from unknown actors and escape attempted login email', function () {
    $email = '"><img src=x onerror=alert(1)>';
    $rows = [];
    foreach (['cli.org_disable' => 'من سطر الأوامر', 'admin.login' => 'مش معروف', 'device.revoke' => 'مش معروف'] as $action => $label) {
        $rows[] = [logPresentationRow($this->fixture, ['action' => $action, 'anonymous' => true, 'detail' => ['email' => $email]]), $action, $label];
    }
    $response = $this->withSession(['platform_session_id' => $this->fixture['session']])->get('/panel/admin-log?org_id='.$this->fixture['org'])->assertOk();
    $xpath = logPresentationDocument($response);
    foreach ($rows as [$id,$action,$label]) {
        $actor = $xpath->query('//tr[@data-log-id="'.$id.'"]/td[@data-log-actor]')->item(0);
        expect($actor)->not->toBeNull();
        expect(trim($actor->textContent))->toContain($label);
        $attempt = $xpath->query('.//*[@data-attempted-email]', $actor);
        expect($attempt->length)->toBe($action === 'admin.login' ? 1 : 0);
        if ($action === 'admin.login') {
            expect($attempt->item(0)->textContent)->toBe($email)->and($attempt->item(0)->getAttribute('dir'))->toBe('ltr');
        }
    }
    expect($xpath->query('//tr//img')->length)->toBe(0);
});

test('a resolved admin keeps their name in the log', function () {
    $id = logPresentationRow($this->fixture, ['action' => 'admin.login']);
    $response = $this->withSession(['platform_session_id' => $this->fixture['session']])->get('/panel/admin-log?org_id='.$this->fixture['org'])->assertOk();
    $xpath = logPresentationDocument($response);
    expect(trim($xpath->query('//tr[@data-log-id="'.$id.'"]/td[@data-log-actor]')->item(0)->textContent))->toBe('مسؤول التجربة');
});

test('every action allowed by the installed CHECK has exactly one Arabic label and select option', function () {
    $constraints = DB::select("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='platform.admin_log'::regclass AND contype='c'");
    $actions = [];
    foreach ($constraints as $constraint) {
        if (str_contains($constraint->definition, 'action')) {
            preg_match_all("/'([^']+)'::text/", $constraint->definition, $matches);
            $actions = array_merge($actions, $matches[1]);
        }
    }
    expect($actions)->not->toBeEmpty();
    expect(array_keys(App\Support\ActionLabels::ALL))->toEqualCanonicalizing($actions);
    $response = $this->withSession(['platform_session_id' => $this->fixture['session']])->get('/panel/admin-log?org_id='.$this->fixture['org'].'&action=org.disable')->assertOk();
    $xpath = logPresentationDocument($response);
    $options = $xpath->query('//select[@name="action"]/option');
    expect($options->item(0)->textContent)->toBe('كل الإجراءات')->and($options->item(0)->getAttribute('value'))->toBe('');
    expect($options->length)->toBe(count($actions) + 1);
    foreach (App\Support\ActionLabels::ALL as $code => $label) {
        expect($xpath->query('//select[@name="action"]/option[@value="'.$code.'"]')->item(0)->textContent)->toBe($label);
    }
    expect($xpath->query('//select[@name="action"]/option[@selected]')->item(0)->getAttribute('value'))->toBe('org.disable');
    $response->assertSee('إيقاف العيادة')->assertDontSee('تشغيل العيادة</td>', false);
});
