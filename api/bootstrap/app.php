<?php

use App\Http\Middleware\ApplyMembership;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Not global — see ApplyMembership's own doc comment. Attached
        // per-route-group as 'membership' until real auth replaces the
        // X-Membership-Id bridge.
        $middleware->alias(['membership' => ApplyMembership::class]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        // This is an API-only backend: every response is JSON, never an HTML error page.
        $exceptions->shouldRenderJsonWhen(fn (Request $request) => true);

        $exceptions->render(function (NotFoundHttpException $e, Request $request) {
            return response()->json([
                'error' => 'not_found',
                'message' => 'لم يتم العثور على المورد',
            ], 404);
        });

        // Registered before the generic Throwable handler below — Laravel
        // uses the first registered handler whose type hint matches (via
        // instanceof), so a Throwable handler registered earlier would
        // shadow these unconditionally, since every exception is a
        // Throwable.
        $exceptions->render(function (ValidationException $e, Request $request) {
            return response()->json([
                'error' => 'validation_failed',
                'message' => 'بيانات غير صالحة',
                'errors' => $e->errors(),
            ], 422);
        });

        $exceptions->render(function (AuthenticationException $e, Request $request) {
            return response()->json([
                'error' => 'unauthenticated',
                'message' => 'يجب تسجيل الدخول',
            ], 401);
        });

        $exceptions->render(function (Throwable $e, Request $request) {
            $status = method_exists($e, 'getStatusCode') ? $e->getStatusCode() : 500;

            return response()->json([
                'error' => 'server_error',
                'message' => config('app.debug') ? $e->getMessage() : 'حدث خطأ في الخادم',
            ], $status);
        });
    })->create();
