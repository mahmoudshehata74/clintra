<?php

namespace App\Support\Sync;

use RuntimeException;

/**
 * Thrown inside a sync group's savepoint (SyncPushController::applyGroup)
 * once one of its ops is not accepted, so every write the group made is
 * rolled back. Never leaves the controller.
 */
final class SyncGroupRefused extends RuntimeException {}
