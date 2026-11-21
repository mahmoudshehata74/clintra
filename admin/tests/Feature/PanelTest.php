<?php

use App\Support\Platform;
use App\Support\Refusal;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

beforeEach(function () {
    expect(config('database.connections.pgsql.database'))->toBe('clintra_test');
    config(['cache.default' => 'array']);
    $this->fixture = panelFixtureCommand('create');
    $hex = str_replace('-', '', $this->fixture['id']);
    $this->withServerVariables(['REMOTE_ADDR' => '2001:db8:'.implode(':', str_split(substr($hex, 0, 24), 4))]);
});
afterEach(function () {
    if (isset($this->fixture)) {
        panelFixtureCommand('retire', $this->fixture['id']);
    }
    DB::disconnect();
});

test('the only connection authenticates as the panel role and application SQL calls only platform functions', function () {
    expect(array_keys(config('database.connections')))->toBe(['pgsql']);
    expect(DB::selectOne('SELECT current_user AS role')->role)->toBe('clintra_admin_app');
    $queries = [];
    DB::listen(function ($query) use (&$queries) {
        $queries[] = $query->sql;
    });
    $response = $this->withSession(['platform_session_id' => $this->fixture['session']])->get('/panel/admin-log')->assertOk()->assertDontSee($this->fixture['session'], false);
    expect($response->headers->get('Cache-Control'))->toContain('no-store');
    expect($queries)->not->toBeEmpty();
    foreach ($queries as $sql) {
        expect($sql)->toMatch('/^SELECT platform\.admin_(whoami|log_page)\(/');
    }
    foreach (['platform.admin_users', 'platform.admin_sessions', 'platform.admin_log', 'public.patients'] as $table) {
        expect(fn () => DB::select('SELECT * FROM '.$table))->toThrow(QueryException::class);
    }
});

test('sign in accepts TOTP or one recovery code and persists only the platform session identity', function (bool $recovery) {
    $old = session()->getId();
    $otp = $recovery ? $this->fixture['recovery'] : panelOtp($this->fixture);
    $response = $this->post('/sign-in', ['email' => $this->fixture['email'], 'password' => $this->fixture['password'], 'otp' => $otp])->assertRedirect('/panel/admin-log');
    expect(array_map(fn ($cookie) => $cookie->getName(), $response->headers->getCookies()))->toBe(['clintra_admin_session']);
    $id = session('platform_session_id');
    expect($id)->toBeString()->and(session()->getId())->not->toBe($old);
    foreach (['name', 'email', 'password', 'current_password', 'otp', 'must_change_password'] as $key) {
        expect(session()->has($key))->toBeFalse();
    }
    expect(app(Platform::class)->whoami($id)['email'])->toBe($this->fixture['email']);
    $path = config('session.files').'/'.session()->getId();
    expect(file_exists($path))->toBeTrue();
    $payload = file_get_contents($path);
    foreach ([$id, $this->fixture['email'], $this->fixture['password']] as $secret) {
        expect($payload)->not->toContain($secret);
    }
    $this->withSession(['platform_session_id' => $id])->post('/sign-out')->assertRedirect('/panel/sign-in');
    expect(app(Platform::class)->whoami($id))->toBe(['ok' => false, 'reason' => 'session_invalid']);
    if ($recovery) {
        $this->post('/sign-in', ['email' => $this->fixture['email'], 'password' => $this->fixture['password'], 'otp' => $otp])->assertSessionHasErrors(['auth' => 'البيانات دي مش صح']);
    }
})->with([false, true]);

test('wrong password unknown email and wrong verification give the same Arabic refusal', function (string $field) {
    $data = ['email' => $this->fixture['email'], 'password' => $this->fixture['password'], 'otp' => panelOtp($this->fixture)];
    $data[$field] = match ($field) {
        'email' => 'unknown-'.$this->fixture['id'].'@example.invalid', 'password' => 'incorrect', default => 'wrong-code'
    };
    $this->post('/sign-in', $data)->assertRedirect('/panel/sign-in')->assertSessionHasErrors(['auth' => 'البيانات دي مش صح']);
    expect(session('platform_session_id'))->toBeNull();
})->with(['email', 'password', 'otp']);

test('the database and HTTP limits both surface the exact Arabic rate message', function () {
    $data = ['email' => $this->fixture['email'], 'password' => 'incorrect', 'otp' => 'incorrect'];
    for ($i = 0; $i < 5; $i++) {
        $this->post('/sign-in', $data)->assertSessionHasErrors(['auth' => 'البيانات دي مش صح']);
    }
    $this->post('/sign-in', $data)->assertSessionHasErrors(['auth' => 'محاولات كتير، استنى ربع ساعة']);
    for ($i = 0; $i < 4; $i++) {
        $this->post('/sign-in', $data)->assertRedirect();
    }
    $this->post('/sign-in', $data)->assertStatus(429)->assertSee('محاولات كتير، استنى ربع ساعة');
});

test('the must change flow exposes only password change and sign out and consumes a fresh step up', function () {
    panelFixtureCommand('retire', $this->fixture['id']);
    $this->fixture = panelFixtureCommand('create', 'must');
    $session = $this->fixture['session'];
    $this->withSession(['platform_session_id' => $session])->get('/panel/admin-log')->assertRedirect('/panel/change-password');
    $this->withSession(['platform_session_id' => $session])->get('/panel/sign-in')->assertRedirect('/panel/change-password');
    $this->withSession(['platform_session_id' => $session])->get('/panel/change-password')->assertOk()->assertSee('لازم تغيّر كلمة السر الأول')->assertDontSee('فلاتر سجل الإدارة');
    $data = ['current_password' => $this->fixture['password'], 'password' => 'New-panel-password-456', 'password_confirmation' => 'New-panel-password-456', 'otp' => panelOtp($this->fixture)];
    $this->withSession(['platform_session_id' => $session])->post('/change-password', $data)->assertRedirect('/panel/admin-log');
    expect(app(Platform::class)->whoami($session)['must_change_password'])->toBeFalse();
});

test('password validation records a refusal without flashing secrets', function () {
    $this->withSession(['platform_session_id' => $this->fixture['session']])->post('/change-password', [
        'current_password' => $this->fixture['password'], 'password' => 'short', 'password_confirmation' => 'different', 'otp' => 'secret-code',
    ])->assertSessionHasErrors(['auth' => 'راجع البيانات وحاول تاني']);
    expect(session()->getOldInput())->toBe([]);
});

test('the fifth counted refusal returns the database lockout message and ends both browser and platform sessions', function (bool $wrongPassword) {
    $session = $this->fixture['session'];
    $data = ['current_password' => $wrongPassword ? 'wrong-current' : $this->fixture['password'], 'password' => 'New-panel-password-456', 'password_confirmation' => 'New-panel-password-456', 'otp' => 'wrong-code'];
    for ($i = 0; $i < 4; $i++) {
        $this->withSession(['platform_session_id' => $session])->post('/change-password', $data)->assertRedirect('/panel/change-password')->assertSessionHasErrors(['auth' => $wrongPassword ? 'البيانات دي مش صح' : 'كود التحقق مش صح أو اتستخدم قبل كده']);
    }
    $this->withSession(['platform_session_id' => $session])->post('/change-password', $data)->assertRedirect('/panel/sign-in')->assertSessionHasErrors(['auth' => 'اتقفلت كل جلساتك بعد محاولات غلط كتير، ادخل تاني بعد ربع ساعة']);
    expect(session('platform_session_id'))->toBeNull()->and(app(Platform::class)->whoami($session)['ok'])->toBeFalse();
    foreach (panelFixtureCommand('sessions', $this->fixture['id'])['sessions'] as $row) {
        expect($row['ended_at'])->not->toBeNull();
    }
})->with([false, true]);

test('every request rechecks idle absolute and inactive session state', function (string $state) {
    $session = $this->fixture['session'];
    $this->withSession(['platform_session_id' => $session])->get('/panel/admin-log')->assertOk();
    panelFixtureCommand($state, $this->fixture['id']);
    $this->withSession(['platform_session_id' => $session])->get('/panel/admin-log')->assertRedirect('/panel/sign-in');
    expect(session('platform_session_id'))->toBeNull();
})->with(['idle', 'expired', 'inactive']);

test('log filters use the function and keyset URLs retain all filters and escape details', function () {
    $query = ['admin_user_id' => $this->fixture['id'], 'org_id' => $this->fixture['org'], 'action' => 'org.disable', 'page_size' => 1, 'from' => date('Y-m-d'), 'to' => date('Y-m-d')];
    $response = $this->withSession(['platform_session_id' => $this->fixture['session']])->get('/panel/admin-log?'.http_build_query($query))->assertOk()->assertSee('مسؤول التجربة')->assertSee('rel="next"', false)->assertDontSee('<script>alert(1)</script>', false);
    expect(preg_match('/href="([^"]+)"[^>]*>الأقدم/', $response->getContent(), $match))->toBe(1);
    $url = html_entity_decode($match[1]);
    expect($url)->toContain('before_seq=')->toContain('action=org.disable')->toContain('page_size=1');
    $this->withSession(['platform_session_id' => $this->fixture['session']])->get($url)->assertOk();
});

test('security headers secure encrypted cookies and CSRF are enabled', function () {
    $response = $this->get('/panel/sign-in')->assertOk()->assertHeader('Referrer-Policy', 'no-referrer')->assertHeader('X-Frame-Options', 'DENY')->assertHeader('X-Robots-Tag', 'noindex, nofollow');
    expect($response->headers->get('Content-Security-Policy'))->toContain("frame-ancestors 'none'")->toContain("font-src 'self'");
    expect($response->headers->get('Cache-Control'))->toContain('no-store');
    expect(array_map(fn ($cookie) => $cookie->getName(), $response->headers->getCookies()))->toBe(['clintra_admin_session']);
    $cookie = collect($response->headers->getCookies())->first(fn ($cookie) => $cookie->getName() === 'clintra_admin_session');
    expect($cookie)->not->toBeNull()->and($cookie->isSecure())->toBeTrue()->and($cookie->isHttpOnly())->toBeTrue()->and($cookie->getSameSite())->toBe('strict');
    expect(config('session.encrypt'))->toBeTrue();
    $this->app['env'] = 'local';
    $this->post('/sign-in', ['email' => $this->fixture['email'], 'password' => 'secret', 'otp' => 'secret'])->assertStatus(419);
});

test('the optional IP allowlist accepts CIDRs and ignores forwarded addresses from untrusted peers', function () {
    config(['panel.ip_allowlist' => []]);
    $this->get('/panel/sign-in')->assertOk();
    $this->withServerVariables(['REMOTE_ADDR' => '192.0.2.8']);
    config(['panel.ip_allowlist' => ['192.0.2.0/24']]);
    $this->get('/panel/sign-in')->assertOk();
    config(['panel.ip_allowlist' => ['198.51.100.0/24']]);
    $this->withHeader('X-Forwarded-For', '198.51.100.1')->get('/panel/sign-in')->assertStatus(403)->assertContent('Forbidden');
    config(['panel.trusted_proxies' => ['192.0.2.8']]);
    $this->get('/panel/sign-in')->assertOk();
});

test('every database refusal reason has an Arabic message', function (string $reason) {
    expect(Refusal::message(['reason' => $reason]))->toMatch('/[\x{0600}-\x{06FF}]/u');
})->with(['bad_credentials', 'current_password_failed', 'rate_limited', 'session_invalid', 'password_change_required', 'step_up_failed', 'invalid_payload', 'malformed_payload', 'not_found', 'reason_required', 'unchanged']);

test('wildcard trusted proxies are refused in production', function () {
    config(['panel.trusted_proxies' => ['*'], 'app.env' => 'production']);
    $this->withoutExceptionHandling();
    expect(fn () => $this->get('/panel/sign-in'))->toThrow(RuntimeException::class, 'Trusted proxies must be explicit IP addresses or CIDRs.');
});
