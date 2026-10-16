<?php

/**
 * Sends one request through the real HTTP kernel — routes, the
 * `membership` middleware and its transaction, the controller — in its own
 * OS process with its own database connection. Used only by
 * tests/Feature/Rls/SyncSeqOrderTest.php, which needs a second push and a
 * pull to run while the test's own connection holds a push open.
 *
 * Args: method uri bearer-token [json-body]
 * Prints the response's status line ("HTTP <code>") and then its body.
 * The environment (DB_DATABASE=clintra_test and the rest) is the caller's.
 */

use Illuminate\Contracts\Http\Kernel;
use Illuminate\Http\Request;

[, $method, $uri, $token] = $argv;
$body = $argv[4] ?? null;

require __DIR__.'/../../vendor/autoload.php';
$app = require __DIR__.'/../../bootstrap/app.php';

$kernel = $app->make(Kernel::class);
$request = Request::create($uri, $method, [], [], [], [
    'HTTP_AUTHORIZATION' => "Bearer {$token}",
    'HTTP_ACCEPT' => 'application/json',
    'CONTENT_TYPE' => 'application/json',
], $body);

$response = $kernel->handle($request);

echo 'HTTP '.$response->getStatusCode()."\n".$response->getContent();

$kernel->terminate($request, $response);
