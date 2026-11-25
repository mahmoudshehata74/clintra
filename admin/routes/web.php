<?php

use App\Http\Controllers\AuthController;
use App\Http\Controllers\ClinicController;
use App\Http\Controllers\SupportEntryController;
use App\Http\Middleware\ResolvePlatformSession;
use Illuminate\Support\Facades\Route;

Route::middleware(ResolvePlatformSession::class)->group(function (): void {
    Route::post('/sign-in', [AuthController::class, 'signIn'])->middleware('throttle:panel-sign-in')->name('panel.sign-in');
    Route::post('/sign-out', [AuthController::class, 'signOut'])->name('panel.logout');
    Route::post('/change-password', [AuthController::class, 'password'])->name('panel.password');
    Route::post('/clinics/{org}/state', [ClinicController::class, 'state'])->name('panel.clinic-state');
    Route::post('/clinics/{org}/devices/{device}/revoke', [ClinicController::class, 'revoke'])->name('panel.device-revoke');
    Route::post('/clinics/{org}/codes/request', [ClinicController::class, 'requestCode'])->name('panel.code-request');
    Route::post('/clinics/{org}/codes/{approval}/approve', [ClinicController::class, 'approveCode'])->name('panel.code-approve');
    Route::post('/support/open', [SupportEntryController::class, 'open'])->name('panel.support-open');
    Route::get('/', fn () => redirect()->route('filament.admin.pages.admin-log'));
});
