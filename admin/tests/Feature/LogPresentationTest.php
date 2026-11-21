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
