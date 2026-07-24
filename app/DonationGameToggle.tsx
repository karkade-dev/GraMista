'use client';

// Кнопка на донаті: вивести з гри / повернути в гру. Submit → setDonationGameAction (перерахунок
// балів, тому підтвердження). У донату без міста балів немає — текст підтвердження без згадки балів.
export function DonationGameToggle({
  externalId,
  outOfGame,
  hasCity,
  action,
}: {
  externalId: string;
  outOfGame: boolean;
  hasCity: boolean;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const confirmMsg = outOfGame
    ? hasCity
      ? 'Повернути цей донат у гру? Місту донарахуються бали.'
      : 'Повернути цей донат у гру? Глядачі знову його бачитимуть.'
    : hasCity
      ? 'Вивести цей донат з гри? Бали знімуться, глядачі його не бачитимуть.'
      : 'Вивести цей донат з гри? Глядачі його не бачитимуть.';
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(confirmMsg)) e.preventDefault();
      }}
    >
      <input type="hidden" name="externalId" value={externalId} />
      <input type="hidden" name="out" value={outOfGame ? 'false' : 'true'} />
      <button type="submit" className={`game-toggle${outOfGame ? ' off' : ''}`} title={confirmMsg}>
        {outOfGame ? '✅ у гру' : '🚫 з гри'}
      </button>
    </form>
  );
}
