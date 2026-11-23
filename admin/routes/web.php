<?php

use App\Http\Controllers\AuthController;
use App\Http\Controllers\ClinicController;
use App\Http\Middleware\ResolvePlatformSession;
use Illuminate\Support\Facades\Route;

Route::middleware(ResolvePlatformSession::class)->group(function (): void {
    Route::post('/sign-in', [AuthController::class, 'signIn'])->middleware('throttle:panel-sign-in')->name('panel.sign-in');
    Route::post('/sign-out', [AuthController::class, 'signOut'])->name('panel.logout');
    Route::post('/change-password', [AuthController::class, 'password'])->name('panel.password');
    Route::post('/clinics/{org}/state', [ClinicController::class, 'state'])->name('panel.clinic-state');
    Route::get('/', fn () => redirect()->route('filament.admin.pages.admin-log'));
});
