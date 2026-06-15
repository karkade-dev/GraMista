import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { nextCookies } from 'better-auth/next-js';
import { twoFactor } from 'better-auth/plugins';
import { prisma } from './db';
import { cleanDisplayName } from './displayName';
import { sendEmail, buildVerificationEmail, buildResetPasswordEmail } from './email';
import { signupsClosed } from './signups';

// Дефолтні назви моделей Better Auth (user/session/account/verification) збігаються з нашими
// Prisma-делегатами (prisma.user/session/...), тож мапінг назв не потрібен.
export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  emailAndPassword: {
    enabled: true,
    // Закрита програма (див. lib/signups.ts): блокує сам ендпойнт реєстрації,
    // а не лише форму — curl на /api/auth/sign-up/email теж отримає відмову.
    disableSignUp: signupsClosed(),
    autoSignIn: true,
    requireEmailVerification: true,
    minPasswordLength: 8,
    sendResetPassword: async ({ user, url }) => {
      await sendEmail(user.email, buildResetPasswordEmail(url));
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail(user.email, buildVerificationEmail(url));
    },
    sendOnSignUp: true,
    sendOnSignIn: true, // спроба входу без підтвердження → автоматично новий лист
    autoSignInAfterVerification: true,
  },
  user: {
    additionalFields: {
      // Галочка «глобальна мапа» передається прямо в signUp: після реєстрації з
      // requireEmailVerification сесії ще НЕМА, тож post-signup server action не спрацює.
      showOnGlobalMap: { type: 'boolean', defaultValue: true, input: true },
    },
  },
  // Захист входу: вбудований ліміт спроб (проти перебору паролів). У dev вимкнений за
  // замовчуванням — вмикаємо явно, щоб поведінка збігалася з продом. Спека global-map §3.
  // Поштові ендпойнти й реєстрацію лімітуємо жорсткіше — щоб не спамили листами і не
  // палили Resend-квоту (кожна реєстрація = лист). IP за проксі Caddy береться з
  // x-forwarded-for — це дефолт Better Auth, додатковий конфіг не потрібен.
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      '/sign-in/email': { window: 60, max: 5 },
      '/sign-up/email': { window: 60, max: 3 },
      '/request-password-reset': { window: 60, max: 3 },
      '/send-verification-email': { window: 60, max: 3 },
    },
  },
  // Жорсткий гейт імені на сервері (клієнтська валідація — лише UX): чистимо керівні символи,
  // обмежуємо довжину; негодне ім'я → реєстрація відхиляється. Ім'я світиться публічно.
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const c = cleanDisplayName(String((user as { name?: unknown }).name ?? ''));
          if (!c.ok) return false;
          return { data: { ...user, name: c.value } };
        },
      },
    },
  },
  // 2FA (TOTP) — захист адмін-акаунта сервісу; код із застосунку-автентифікатора при вході.
  plugins: [twoFactor(), nextCookies()], // nextCookies — ОСТАННІМ (вимога better-auth)
});
