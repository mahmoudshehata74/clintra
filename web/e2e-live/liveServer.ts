import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The real API for the live two-device run: PHP's built-in server on the
// Laravel app (what `php artisan serve` starts), on DB_DATABASE=clintra_test
// only, started and stopped by the spec itself so it can take the server
// away mid-run. Never the dev database.

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../api");
export const API_PORT = 8000;
const API_ORIGIN = `http://127.0.0.1:${API_PORT}`;
const ENV = { ...process.env, DB_DATABASE: "clintra_test" };

let server: ChildProcess | null = null;

async function isHealthy(): Promise<boolean> {
  try {
    const response = await fetch(`${API_ORIGIN}/api/health`);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitFor(condition: () => Promise<boolean>, what: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Starts the API; refuses when something else already answers on the port. */
export async function startApi(): Promise<void> {
  if (server) {
    return;
  }
  if (await isHealthy()) {
    throw new Error(`port ${API_PORT} is already serving an API — stop that server first; the live run starts its own on clintra_test`);
  }
  server = spawn(
    "php",
    ["-S", `127.0.0.1:${API_PORT}`, path.join(API_DIR, "vendor/laravel/framework/src/Illuminate/Foundation/resources/server.php")],
    { cwd: path.join(API_DIR, "public"), env: ENV, stdio: "ignore" },
  );
  await waitFor(isHealthy, "the API to answer /api/health");
}

/** Stops the API and waits until the port stops answering. */
export async function stopApi(): Promise<void> {
  if (!server) {
    return;
  }
  const exited = new Promise((resolve) => server!.once("exit", resolve));
  server.kill();
  await exited;
  server = null;
  await waitFor(async () => !(await isHealthy()), "the API to stop answering");
}

/**
 * Runs an artisan command on clintra_test, writing each answer only once its
 * prompt has shown — a hidden prompt (the PIN) reads its line straight from
 * the inherited stdin on Windows, so the line must still be in the pipe.
 */
function artisan(args: string[], answers: readonly (readonly [prompt: string, answer: string])[] = []): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("php", ["artisan", ...args], { cwd: API_DIR, env: ENV });
    let output = "";
    let next = 0;
    let searchFrom = 0;
    const onData = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      while (next < answers.length) {
        const found = output.indexOf(answers[next][0], searchFrom);
        if (found === -1) {
          break;
        }
        searchFrom = found + answers[next][0].length;
        child.stdin.write(`${answers[next][1]}\n`);
        next++;
      }
      if (next === answers.length) {
        child.stdin.end();
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    if (answers.length === 0) {
      child.stdin.end();
    }
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve(output) : reject(new Error(`artisan ${args[0]} exited ${code}:\n${output}`))));
  });
}

const CODE = /CLT(?:-[A-Z0-9]{4}){4}/;

export interface LiveOrg {
  orgId: string;
  locationId: string;
  clinicName: string;
  ownerName: string;
  ownerPhone: string;
  ownerPin: string;
}

/** Provisions a fresh organization for this run (its own owner phone), so no run shares data with another. */
export async function provisionOrg(): Promise<LiveOrg> {
  const suffix = String(Date.now()).slice(-8);
  const org = {
    // Latin on purpose: on Windows the console layer reads piped answers as
    // the OEM code page, which has no Arabic (README.md here).
    clinicName: `Live Clinic ${suffix.slice(-4)}`,
    ownerName: "Live Owner",
    ownerPhone: `010${suffix}`,
    ownerPin: "2468",
  };
  const output = await artisan(
    ["clintra:provision"],
    [
      ["Organization name", org.clinicName],
      ["Location name", "Main branch"],
      ["Location address", "Nile Street, Cairo"],
      ["Location phone", "0222345678"],
      ["full name", org.ownerName],
      ["Doctor's phone", org.ownerPhone],
      ["PIN (4 digits)", org.ownerPin],
      ["Confirm PIN", org.ownerPin],
    ],
  );
  const id = (field: string) => output.match(new RegExp(`${field}\\s*\\|\\s*([0-9a-f-]{36})`))?.[1];
  const orgId = id("organization_id");
  const locationId = id("location_id");
  if (!orgId || !locationId) {
    throw new Error(`could not read the provisioned ids:\n${output}`);
  }
  return { ...org, orgId, locationId };
}

/** A fresh activation code for one more device of the organization. */
export async function mintCode(org: LiveOrg): Promise<string> {
  const output = await artisan(["clintra:mint-activation-code", org.orgId, org.locationId]);
  const code = output.match(CODE)?.[0];
  if (!code) {
    throw new Error(`no activation code in:\n${output}`);
  }
  return code;
}
