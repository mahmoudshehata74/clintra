<?php

namespace App\Support\Sync;

/**
 * docs/reference/clintra-cli-brief.md, section 8: "Local storage covers the
 * last 60 days and the next 60 days." One constant, shared by every class
 * that needs to reason about that window, rather than a magic 60 repeated
 * per call site — SyncOpApplier's clock-skew rejection and
 * SyncBootstrapPuller's date-windowed prefetch are two independent readings
 * of the same brief rule and must never drift apart from each other.
 */
class SyncWindow
{
    public const DAYS = 60;
}
