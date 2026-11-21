<?php

use Symfony\Component\Process\Process;
use Tests\TestCase;

pest()->extend(TestCase::class)->in('Feature');
function panelFixtureCommand(string $command, string $id = '', string $extra = ''): array
{
    $process = new Process([PHP_BINARY, base_path('../api/scripts/panel-test-fixtures.php'), $command, $id, $extra], base_path('../api'), ['APP_ENV' => 'testing', 'DB_DATABASE' => 'clintra_test']);
    $process->setTimeout(30);
    $process->mustRun();

    return json_decode($process->getOutput(), true, flags: JSON_THROW_ON_ERROR);
}
function panelOtp(array $fixture, int $offset = 0): string
{
    return panelFixtureCommand('otp', $fixture['id'], (string) $offset)['otp'];
}

function logPresentationDocument($response): DOMXPath
{
    $document = new DOMDocument;
    $previous = libxml_use_internal_errors(true);
    $document->loadHTML('<?xml encoding="UTF-8">'.$response->getContent());
    libxml_clear_errors();
    libxml_use_internal_errors($previous);

    return new DOMXPath($document);
}
