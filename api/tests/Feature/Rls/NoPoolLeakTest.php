<?php

// Decision B (api/docs/rls.md): set_config(..., true) is exactly as
// transaction-scoped as SET LOCAL, so a pooled connection reused for the
// next request must start with no membership declared. Proven here on a
// single connection instance, not just across two requests: the GUC must be
// gone the instant the transaction that set it ends.
test('app.membership_id does not survive past the transaction that set it, on the same connection', function () {
    $orgId = $this->makeOrganization();
    $userId = $this->makeUser();
    $membershipId = $this->makeMembership($userId, $orgId, ['role' => 'owner']);

    $connection = $this->asApp();

    $seenDuring = $connection->transaction(function () use ($connection, $membershipId) {
        $connection->select("select set_config('app.membership_id', ?, true)", [$membershipId]);

        return $connection->selectOne("select current_setting('app.membership_id', true) as v")->v;
    });

    expect($seenDuring)->toBe($membershipId);

    $seenAfter = $connection->selectOne("select current_setting('app.membership_id', true) as v")->v;

    expect($seenAfter)->toBeEmpty();
});
