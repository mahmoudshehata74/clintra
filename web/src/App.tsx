const tokens = [
  { name: "الحبر", value: "#16211D" },
  { name: "الأخضر", value: "#1D5B4A" },
  { name: "الأخضر الفاتح", value: "#E8F0EC" },
  { name: "الأحمر", value: "#B23A34" },
  { name: "الكهرماني", value: "#8A6A22" },
  { name: "الحدود", value: "#E2E3DC" },
];

export default function App() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="font-display text-4xl font-semibold text-green">Clintra</h1>
      <p className="mt-2 text-muted">فحص الأساس: الاتجاه والخطوط والألوان.</p>

      <div className="mt-10 rounded-[--radius-frame] border border-line p-6">
        <h2 className="font-display text-xl font-medium">عنوان بخط Readex Pro</h2>
        <p className="mt-3 leading-7">
          نص الفقرة بخط IBM Plex Sans Arabic. الصفحة تبدأ من اليمين، والأرقام
          تظهر بشكل صحيح: ١٢٣٤٥ · 12345.
        </p>
      </div>

      <ul className="mt-8 grid grid-cols-2 gap-3">
        {tokens.map((t) => (
          <li key={t.value} className="flex items-center gap-3">
            <span
              className="size-9 rounded-[--radius-el] border border-line"
              style={{ backgroundColor: t.value }}
            />
            <span className="text-sm">
              {t.name}
              <span className="block text-muted">{t.value}</span>
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}