import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { SETTLEMENTS } from './seed-settlements';
import { CHORNOBYL_ZONE } from './seed-chornobyl';
import { normalize } from '../lib/text';
import { DEFAULT_USER_ID } from '../lib/tenant';

// Сід: дефолтний User (бо userId всюди) + базовий довідник міст (./seed-settlements).
// Повний датасет НП — окремо через db:import. Ідемпотентний: повторний запуск не плодить дублів.
const prisma = new PrismaClient();

async function main(): Promise<void> {
  // Дефолтний користувач для тестів/демо (userId всюди). Пароль зберігає Better Auth у Account —
  // тут лише сам User; через цей запис не логінимось (акаунт credential не створюється).
  await prisma.user.upsert({
    where: { id: DEFAULT_USER_ID },
    update: {},
    create: {
      id: DEFAULT_USER_ID,
      email: 'default@gramista.local',
      name: 'Default',
    },
  });

  let settlements = 0;
  let aliases = 0;

  // Базовий довідник + НП Чорнобильської зони (Прип'ять/Чорнобиль/Дуга + покинуті села) — у тестову БД
  // потрапляє лише через seed, тож зону додаємо й тут (на проді її ставить db:import тим самим списком).
  for (const s of [...SETTLEMENTS, ...CHORNOBYL_ZONE]) {
    // id лишаємо людський (slug із seed-довідника) — стабільний, спрощує імпорт state.json (Крок 3).
    await prisma.settlement.upsert({
      where: { id: s.id },
      update: {
        name: s.name,
        nameNorm: normalize(s.name),
        type: s.type,
        oblast: s.oblast,
        population: s.population,
        lat: s.lat,
        lon: s.lon,
      },
      create: {
        id: s.id,
        name: s.name,
        nameNorm: normalize(s.name),
        type: s.type,
        oblast: s.oblast,
        population: s.population,
        lat: s.lat,
        lon: s.lon,
      },
    });
    settlements++;

    // Аліаси перестворюємо (ідемпотентність), дедуп за нормалізованою формою; форму назви не дублюємо.
    const nameNorm = normalize(s.name);
    const seen = new Set<string>([nameNorm]);
    const rows = [];
    for (const a of s.aliases) {
      const aliasNorm = normalize(a);
      if (!aliasNorm || seen.has(aliasNorm)) continue;
      seen.add(aliasNorm);
      rows.push({ settlementId: s.id, alias: a, aliasNorm, source: 'seed' });
    }
    await prisma.settlementAlias.deleteMany({ where: { settlementId: s.id } });
    if (rows.length) {
      await prisma.settlementAlias.createMany({ data: rows });
      aliases += rows.length;
    }
  }

  console.log(`[seed] User: ${DEFAULT_USER_ID}; Settlement: ${settlements}; SettlementAlias: ${aliases}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
