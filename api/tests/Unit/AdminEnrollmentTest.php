<?php

use App\Support\AdminEnrollment;

test('admin enrollment encodes RFC 4648 base32 without padding', function (string $bytes, string $encoded) {
    expect(AdminEnrollment::base32($bytes))->toBe($encoded);
})->with([['', ''], ['f', 'MY'], ['fo', 'MZXQ'], ['foo', 'MZXW6'], ['foob', 'MZXW6YQ'], ['fooba', 'MZXW6YTB'], ['foobar', 'MZXW6YTBOI']]);
