<?php

use App\Support\PlatformSchemaReset;
use Illuminate\Console\Events\CommandFinished;
use Illuminate\Console\Events\CommandStarting;
use Illuminate\Database\Connection;
use Symfony\Component\Console\Input\ArrayInput;
use Symfony\Component\Console\Output\BufferedOutput;

test('fresh and wipe reset the selected PostgreSQL schemas once after the command begins querying', function (string $command) {
    $db = $this->createMock(Connection::class);
    $beforeQuery = null;
    $calls = 0;
    $db->method('getDriverName')->willReturn('pgsql');
    $db->expects($this->once())->method('beforeExecuting')->willReturnCallback(function (Closure $callback) use (&$beforeQuery, $db) {
        $beforeQuery = $callback;

        return $db;
    });
    $db->expects($this->once())->method('unprepared')->with('DROP SCHEMA IF EXISTS platform CASCADE; DROP SCHEMA IF EXISTS platform_crypto CASCADE;')->willReturnCallback(function () use (&$calls) {
        $calls++;

        return true;
    });
    $reset = new PlatformSchemaReset(function ($name) use ($db) {
        expect($name)->toBe('arbitrary_pgsql_connection');

        return $db;
    });
    $input = new ArrayInput(['--database' => 'arbitrary_pgsql_connection']);
    $reset->starting(new CommandStarting($command, $input, new BufferedOutput));
    expect($calls)->toBe(0)->and($beforeQuery)->toBeInstanceOf(Closure::class);
    $beforeQuery('SELECT 1', [], $db);
    $beforeQuery('SELECT 2', [], $db);
    expect($calls)->toBe(1);
})->with(['migrate:fresh', 'db:wipe']);

test('a cancelled or prohibited command cannot reset schemas on a later query', function (int $exitCode) {
    $db = $this->createMock(Connection::class);
    $beforeQuery = null;
    $db->method('getDriverName')->willReturn('pgsql');
    $db->method('beforeExecuting')->willReturnCallback(function (Closure $callback) use (&$beforeQuery, $db) {
        $beforeQuery = $callback;

        return $db;
    });
    $db->expects($this->never())->method('unprepared');
    $reset = new PlatformSchemaReset(fn () => $db);
    $input = new ArrayInput([]);
    $output = new BufferedOutput;
    $reset->starting(new CommandStarting('db:wipe', $input, $output));
    $reset->finished(new CommandFinished('db:wipe', $input, $output, $exitCode));
    $beforeQuery('SELECT 1', [], $db);
})->with([0, 1]);

test('the schema reset ignores non PostgreSQL connections', function () {
    $db = $this->createMock(Connection::class);
    $db->method('getDriverName')->willReturn('sqlite');
    $db->expects($this->never())->method('beforeExecuting');
    $db->expects($this->never())->method('unprepared');
    (new PlatformSchemaReset(fn () => $db))->starting(new CommandStarting('migrate:fresh', new ArrayInput([]), new BufferedOutput));
});

test('ordinary migration and application commands never arm a schema reset', function () {
    $reset = new PlatformSchemaReset(fn () => $this->fail('Connection must not be resolved'));
    $reset->starting(new CommandStarting('migrate', new ArrayInput([]), new BufferedOutput));
    $reset->starting(new CommandStarting('clintra:preflight', new ArrayInput([]), new BufferedOutput));
    expect(true)->toBeTrue();
});
