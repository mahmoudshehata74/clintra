<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::get('/health', function () {
    $composer = json_decode(file_get_contents(base_path('composer.json')), true);

    return response()->json([
        'status' => 'ok',
        'time' => now('UTC')->toIso8601String(),
        'version' => $composer['version'] ?? 'unknown',
    ]);
});

Route::get('/user', function (Request $request) {
    return $request->user();
})->middleware('auth:sanctum');
