<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * audit_log_insert's `WITH CHECK (org_id = current_org())` only ever scoped
 * the row's org — not who it claims did the write. Any membership inside an
 * org could INSERT an audit_log row naming any *other* membership in that
 * same org as `actor_membership_id` (docs/sync-plan.md's Q13 flagged this as
 * a live hole the moment anything ever inserts a client-influenced actor
 * through the ordinary RLS-bound connection). The audit trail is the only
 * record of who did what; an attacker-forgeable actor column makes it
 * worthless as evidence, not just imprecise.
 *
 * Fixed by adding `actor_membership_id = current_membership()` to the same
 * WITH CHECK — current_membership() (2026_09_11_170029_enable_rls_policies.php)
 * is a plain, non-SECURITY-DEFINER function that reads the session's own
 * declared app.membership_id; already EXECUTE-granted to clintra_app. Org
 * scoping is untouched — this ANDs a second condition onto the existing one,
 * it does not replace it. The SELECT policy and the deliberate absence of
 * UPDATE/DELETE policies (audit_log is immutable by construction) are
 * likewise untouched.
 *
 * Confirmed, not assumed, before this landed: grepping app/ and every
 * migration turned up zero application-level INSERT INTO audit_log — the
 * only three call sites are provision_organization, mint_activation_code,
 * and register_device, all SECURITY DEFINER functions owned by BYPASSRLS
 * roles (clintra_provision/clintra_mint/clintra_register) that compute their
 * own actor_membership_id server-side and never accept one from a caller.
 * BYPASSRLS means RLS policies — including this new check — never apply to
 * their execution at all, regardless of content; tests/Feature/Rls/ProvisioningTest.php,
 * MintActivationCodeTest.php, and DeviceRegistrationTest.php (unmodified by
 * this migration) passing after it lands is the confirmation, not an
 * assumption about what BYPASSRLS does. Nothing today writes an audit row
 * through the ordinary clintra_app connection at all (no entity endpoints
 * exist yet), so there is no existing legitimate use this narrows.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('DROP POLICY IF EXISTS audit_log_insert ON audit_log');
        DB::statement(
            'CREATE POLICY audit_log_insert ON audit_log FOR INSERT '.
            'WITH CHECK (org_id = current_org() AND actor_membership_id = current_membership())'
        );
    }

    public function down(): void
    {
        DB::statement('DROP POLICY IF EXISTS audit_log_insert ON audit_log');
        DB::statement('CREATE POLICY audit_log_insert ON audit_log FOR INSERT WITH CHECK (org_id = current_org())');
    }
};
