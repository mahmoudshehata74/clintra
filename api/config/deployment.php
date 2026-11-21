<?php

return [
    // Set only after the host's every-minute schedule:run job is installed.
    'scheduler_configured' => (bool) env('SCHEDULER_CONFIGURED', false),
];
