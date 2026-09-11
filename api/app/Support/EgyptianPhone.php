<?php

namespace App\Support;

use InvalidArgumentException;

/**
 * Normalizes an Egyptian phone number into E.164 (+20 followed by the
 * national number, no leading zero) — the same classification rules as the
 * web client's normalizeEgyptianPhone (web/src/domain/phone.ts), ported so
 * both sides accept the same input shapes and agree on what counts as
 * valid. Not shared via contract/ like the PIN hash params or reference
 * data ids: this is pure validation logic with no stored value either side
 * needs to agree on byte-for-byte, so duplicating the two small
 * classification tables here is simpler than a contract file for a
 * non-data artifact.
 */
class EgyptianPhone
{
    private const MOBILE_NATIONAL_NUMBER = '/^1[0125]\d{8}$/';

    // Verified against the Egyptian numbering plan (Cairo/Giza/Qalyubia = 2,
    // Alexandria = 3, and the two-digit governorate codes below) — same list
    // as web/src/domain/phone.ts, including the same deliberate exclusion of
    // the 10th of Ramadan codes (15, 554): "15" overlaps the WE mobile
    // prefix's digit space and could not be confirmed with confidence.
    private const LANDLINE_TWO_DIGIT_CODES = [
        '13', '40', '45', '46', '47', '48', '50', '55', '57', '62', '64', '65',
        '66', '68', '69', '82', '84', '86', '88', '92', '93', '95', '96', '97',
    ];

    /**
     * Accepts local, bare national, +20 and 0020 international forms,
     * Arabic-Indic digits, and common spacing/punctuation.
     *
     * @throws InvalidArgumentException if the input cannot be normalized.
     */
    public static function normalize(string $input): string
    {
        $digitsAndPlus = preg_replace('/[^\d+]/', '', self::toWesternDigits($input));
        $national = str_starts_with($digitsAndPlus, '+') ? substr($digitsAndPlus, 1) : $digitsAndPlus;

        if (str_starts_with($national, '0020')) {
            $national = substr($national, 4);
        } elseif (str_starts_with($national, '20')) {
            $national = substr($national, 2);
        } elseif (str_starts_with($national, '0')) {
            $national = substr($national, 1);
        }

        if (! self::isValidNationalNumber($national)) {
            throw new InvalidArgumentException("invalid_phone: {$input}");
        }

        return "+20{$national}";
    }

    private static function isValidNationalNumber(string $national): bool
    {
        if (preg_match(self::MOBILE_NATIONAL_NUMBER, $national) === 1) {
            return true;
        }

        if (preg_match('/^2\d{8}$/', $national) === 1 || preg_match('/^3\d{7}$/', $national) === 1) {
            return true;
        }

        $landlineTwoDigit = '/^(?:'.implode('|', self::LANDLINE_TWO_DIGIT_CODES).')\d{7}$/';

        return preg_match($landlineTwoDigit, $national) === 1;
    }

    private static function toWesternDigits(string $value): string
    {
        $map = [];
        for ($digit = 0; $digit <= 9; $digit++) {
            $map[mb_chr(0x0660 + $digit)] = (string) $digit; // Arabic-Indic
            $map[mb_chr(0x06F0 + $digit)] = (string) $digit; // Extended Arabic-Indic
        }

        return strtr($value, $map);
    }
}
