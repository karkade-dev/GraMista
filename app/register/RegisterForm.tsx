'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authClient } from '@/lib/auth-client';
import { cleanDisplayName } from '@/lib/displayName';

export function RegisterForm() {
  const router = useRouter();
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [joinGlobal, setJoinGlobal] = useState(true);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(''); setBusy(true);
    const f = new FormData(e.currentTarget);
    const nameCheck = cleanDisplayName(String(f.get('name')));
    if (!nameCheck.ok) { setBusy(false); setErr(nameCheck.error); return; }
    const email = String(f.get('email'));
    const { error } = await authClient.signUp.email({
      email,
      password: String(f.get('password')),
      name: nameCheck.value,
      showOnGlobalMap: joinGlobal,
      callbackURL: '/dashboard', // куди приведе клік по посиланню з листа (після авто-входу)
    });
    setBusy(false);
    if (error) { setErr(error.message ?? 'Помилка реєстрації'); return; }
    // Сесії ще нема (потрібне підтвердження пошти) — ведемо на сторінку «перевір пошту».
    router.push(`/verify-email?email=${encodeURIComponent(email)}`);
  }

  return (
    <main className="auth-wrap">
      <h1>Реєстрація</h1>
      <form onSubmit={onSubmit} className="auth-form">
        <input name="name" placeholder="Імʼя стрімера" required minLength={2} />
        <input name="email" type="email" placeholder="Email" required />
        <input name="password" type="password" placeholder="Пароль (мін. 8)" required minLength={8} />
        <label className="auth-check">
          <input type="checkbox" checked={joinGlobal} onChange={(e) => setJoinGlobal(e.target.checked)} />{' '}
          Долучити мій збір до загальної мапи України
        </label>
        {err && <p className="auth-err">{err}</p>}
        <button type="submit" disabled={busy}>{busy ? '…' : 'Створити акаунт'}</button>
      </form>
      <p>Вже є акаунт? <Link href="/login">Увійти</Link></p>
    </main>
  );
}
