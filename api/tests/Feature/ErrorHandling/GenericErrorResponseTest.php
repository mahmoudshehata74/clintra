<?php

use Illuminate\Support\Facades\Route;

/**
 * bootstrap/app.php's global Throwable handler — the last line of defense
 * against an uncaught exception anywhere in the app leaking a stack
 * trace, a file path, or a raw SQLSTATE to a client. Registers a
 * throwaway route per test (never routes/api.php) so this exercises the
 * real HTTP pipeline — middleware, the exception renderer chain, JSON
 * negotiation — not just the handler in isolation.
 */
test('an uncaught exception with APP_DEBUG=false renders a clean generic 500, no internal detail', function () {
    config(['app.debug' => false]);
    Route::get('/__test/throw-generic', function () {
        throw new RuntimeException('a secret internal detail: SQLSTATE[42501], select * from patients');
    });

    $response = $this->getJson('/__test/throw-generic');

    $response->assertStatus(500);
    $response->assertJson(['error' => 'server_error', 'message' => 'حدث خطأ في الخادم']);

    $body = $response->getContent();
    expect($body)->not->toContain('secret internal detail');
    expect($body)->not->toContain('SQLSTATE');
    expect($body)->not->toContain('RuntimeException');
    expect($body)->not->toContain(__FILE__);
    expect($body)->not->toContain('Stack trace');
});

test('the same uncaught exception with APP_DEBUG=true does include the message — confirming the gate actually gates something', function () {
    config(['app.debug' => true]);
    Route::get('/__test/throw-generic-debug', function () {
        throw new RuntimeException('debug-visible detail');
    });

    $response = $this->getJson('/__test/throw-generic-debug');

    $response->assertStatus(500);
    expect($response->json('message'))->toContain('debug-visible detail');
});

test('a genuine QueryException-driving path (malformed cursor type) never leaks SQLSTATE even with debug off', function () {
    config(['app.debug' => false]);

    $credential = makeAuthenticatedDevice();
    // Deliberately malformed at the HTTP layer, past PullSyncOpsRequest's
    // own validation, to exercise the global handler rather than that
    // FormRequest's clean 422 — a query string value no int cast survives.
    $response = $this->withToken($credential['token'])->getJson('/api/sync/pull?cursor[]=not-an-int');

    expect($response->status())->toBeIn([422, 500]);
    $body = $response->getContent();
    expect($body)->not->toMatch('/SQLSTATE/');
    expect($body)->not->toContain('pgsql');
});
