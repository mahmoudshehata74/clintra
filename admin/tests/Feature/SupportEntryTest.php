<?php

use App\Http\Controllers\SupportEntryController;
use App\Support\Refusal;
use Illuminate\Support\Facades\DB;

beforeEach(function () {
    $this->fixture = panelFixtureCommand('create');
    panelFixtureCommand('b5', $this->fixture['id']);
});
afterEach(function () {
    panelFixtureCommand('retire', $this->fixture['id']);
    DB::disconnect();
});

function supportPost(array $fixture, string $code, ?string $otp = null): mixed
{
    return test()->withSession(['platform_session_id' => $fixture['session']])->post('/support/open', [
        'code' => $code, 'otp' => $otp ?? panelOtp($fixture),
    ]);
}

test('support code normalization matches the web fixed vector with and without prefix', function () {
    foreach (['CLT-7F3K-9QRT-4XWM-2BCD', '7f3k9qrt4xwm2bcd', 'clt 7f3k-9qrt 4xwm.2bcd'] as $input) {
        expect(hash('sha256', SupportEntryController::normalizeCode($input)))
            ->toBe('c93b3fcfa7ef0927301056a6f3e4d61b783f3324fd8070a69c6b397305b72610');
    }
});

test('success shows the exchange link once without session or log disclosure', function () {
    $code = panelFixtureCommand('support-code', $this->fixture['id'])['code'];
    $response = supportPost($this->fixture, substr($code, 4))->assertOk()->assertSee('افتح التطبيق')->assertSee('الرابط ده شغال دقيقتين بس');
    $xpath = logPresentationDocument($response);
    $url = $xpath->query('//a[@data-support-link]')->item(0)->getAttribute('href');
    expect($url)->toStartWith(config('app.clinic_app_url').'/#support=');
    $exchange = rawurldecode(substr($url, strpos($url, '#support=') + 9));
    expect($exchange)->toMatch('/^CLT-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}(?:-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}){3}$/');
    expect(json_encode(session()->all(), JSON_THROW_ON_ERROR))->not->toContain($exchange);
    test()->withSession(['platform_session_id' => $this->fixture['session']])->get('/panel/support')
        ->assertOk()->assertDontSee($exchange)->assertDontSee('data-support-link', false);
    test()->withSession(['platform_session_id' => $this->fixture['session']])->get('/panel/admin-log')
        ->assertOk()->assertDontSee($exchange);
});

test('each support refusal has its own Arabic message', function (string $case, string $message) {
    $code = $case === 'not_found' ? \App\Support\Code::generate()
        : panelFixtureCommand('support-code', $this->fixture['id'], json_encode(['case' => $case], JSON_THROW_ON_ERROR))['code'];
    supportPost($this->fixture, $code)->assertRedirect('/panel/support')->assertSessionHasErrors(['auth' => $message]);
})->with([
    ['not_found', 'الكود ده مش صحيح'],
    ['wrong_purpose', 'الكود ده مش صحيح'],
    ['used', 'الكود ده اتستخدم قبل كده'],
    ['expired', 'الكود ده خلص، اطلب من المالك كود جديد'],
    ['org_disabled', 'حساب العيادة موقوف'],
    ['no_owner', 'اللي عمل الكود مبقاش مالك للعيادة'],
    ['support_active', 'فيه دعم شغال للعيادة دي دلوقتي'],
]);

test('step up and generic payload refusals retain their existing messages', function () {
    expect(Refusal::supportMessage(['reason' => 'invalid_payload']))->toBe('راجع البيانات وحاول تاني');
    $code = panelFixtureCommand('support-code', $this->fixture['id'])['code'];
    $wrong = panelFixtureCommand('wrong-otp', $this->fixture['id'])['otp'];
    supportPost($this->fixture, $code, $wrong)->assertRedirect('/panel/support')
        ->assertSessionHasErrors(['auth' => 'كود التحقق مش صح أو اتستخدم قبل كده']);
});
