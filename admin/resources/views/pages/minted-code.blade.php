<!doctype html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>كود التفعيل — إدارة كلينترا</title>
    <link rel="stylesheet" href="{{ asset('fonts.css') }}">
    <link rel="stylesheet" href="{{ asset('panel.css') }}">
    <script src="{{ asset('panel.js') }}" defer></script>
</head>
<body class="minted-page">
    <main class="minted-backdrop">
        <dialog class="step-up minted-dialog" open aria-labelledby="minted-title">
            <div class="install-hero"><h1 id="minted-title">الكود جاهز</h1></div>
            <div class="install-body">
                <output class="minted-code" dir="ltr" data-minted-code>{{ $code }}</output>
                <p>الكود ده بيظهر مرة واحدة بس، ابعته للعيادة دلوقتي</p>
                <button class="run" type="button" data-copy-code>نسخ الكود</button>
                <a class="quiet" href="{{ route('filament.admin.pages.clinic', ['org' => $org]) }}">الرجوع للعيادة</a>
            </div>
        </dialog>
    </main>
</body>
</html>
