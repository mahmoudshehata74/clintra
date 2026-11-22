<?php

test('panel views never use unescaped Blade output', function () {
    $views = new RecursiveIteratorIterator(new RecursiveDirectoryIterator(dirname(__DIR__, 2).'/resources/views'));
    $checked = 0;
    foreach ($views as $view) {
        if ($view->isFile()) {
            expect(file_get_contents($view->getPathname()), $view->getPathname())->not->toContain('{!!');
            $checked++;
        }
    }
    expect($checked)->toBeGreaterThan(0);
});
