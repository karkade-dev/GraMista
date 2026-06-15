'use client';

// Кнопка «Відкрити док» на сторінці «Історія донатів»: відкриває /dock?k=<dockKey> окремим
// вузьким вікном (для другого монітора). Приватна силка з повними іменами — через dockKey.
// Стиль — як «Експорт CSV» поруч (.btn-csv), щоб виглядало рідним для панелі.
export function OpenDockButton({ dockKey }: { dockKey: string }) {
  const open = () => {
    const url = `/dock?k=${encodeURIComponent(dockKey)}`;
    window.open(url, 'gramista-dock', 'width=400,height=820');
  };
  return (
    <button
      type="button"
      className="btn-csv"
      onClick={open}
      title="Окреме вікно зі стрічкою донатів — для другого монітора або Custom Browser Dock в OBS"
    >
      🪟 Відкрити док
    </button>
  );
}
