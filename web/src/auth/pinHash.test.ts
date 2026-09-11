import { describe, expect, it } from "vitest";
import pinHashConfig from "../../../contract/pin-hash.json";
import { generatePinSalt, hashPin, verifyPin } from "./pinHash";

describe("pinHash", () => {
  // Pinned so the API's PHP implementation (sodium_crypto_pwhash,
  // ALG_ARGON2ID13) can be proven byte-identical to this one — see
  // contract/README.md and api/tests/Unit/PinHashTest.php.
  it("matches contract/pin-hash.json's shared test vector", () => {
    const { pin, saltHex, hashHex } = pinHashConfig.testVector;
    expect(hashPin(pin, saltHex)).toBe(hashHex);
  });

  it("verifies a PIN against its own hash and salt", () => {
    const salt = generatePinSalt();
    const hash = hashPin("1234", salt);
    expect(verifyPin("1234", salt, hash)).toBe(true);
  });

  it("rejects a wrong PIN", () => {
    const salt = generatePinSalt();
    const hash = hashPin("1234", salt);
    expect(verifyPin("9999", salt, hash)).toBe(false);
  });

  it("produces different hashes for the same PIN under different salts", () => {
    const same = "1234";
    expect(hashPin(same, generatePinSalt())).not.toBe(hashPin(same, generatePinSalt()));
  });

  it("generates a 16-byte (32 hex char) salt", () => {
    expect(generatePinSalt()).toMatch(/^[0-9a-f]{32}$/);
  });
});
