import { test, after } from 'node:test';
import assert from 'node:assert/strict';

import { testDb } from './db';
import { searchSettlements } from '../lib/settlements';
import { resolveCity } from '../lib/cityResolve';

// НП Чорнобильської зони (prisma/seed-chornobyl) сідаються у тестову БД через seed. КАТОТТГ не дає
// їх на рівні 4, тож без курованого списку вони були б відсутні (донат «Прип'ять» ішов у село на Волині).

after(async () => {
  await testDb.$disconnect();
});

test('зона ЧАЕС: Прип\'ять і Чорнобиль — міста з координатами (на мапі)', async () => {
  for (const name of ["Прип'ять", 'Чорнобиль']) {
    const s = await testDb.settlement.findFirst({
      where: { name, oblast: 'Київська' },
      select: { lat: true, lon: true, type: true, country: true },
    });
    assert.ok(s, `${name} є в довіднику`);
    assert.ok(s!.lat != null && s!.lon != null, `${name} має координати (інакше не на мапі)`);
    assert.equal(s!.type, 'місто');
    assert.equal(s!.country, 'UA');
  }
});

test('зона ЧАЕС: знаходяться пошуком пікера (вибір вручну)', async () => {
  assert.ok(
    (await searchSettlements(testDb, 'Прип')).some((h) => h.name === "Прип'ять" && h.oblast === 'Київська'),
    'Прип’ять у пошуку',
  );
  assert.ok((await searchSettlements(testDb, 'Чорнобиль')).some((h) => h.name === 'Чорнобиль'), 'Чорнобиль у пошуку');
  assert.ok((await searchSettlements(testDb, 'Копачі')).some((h) => h.name === 'Копачі'), 'Копачі у пошуку');
  assert.ok((await searchSettlements(testDb, 'Янів')).some((h) => h.name === 'Янів'), 'Янів у пошуку');
  // Дуга — за аліасом: назва «Чорнобиль-2» нормалізується в «чорнобиль», тож шукаємо за «дуга».
  assert.ok((await searchSettlements(testDb, 'Дуга')).some((h) => h.name === 'Чорнобиль-2'), 'Дуга → Чорнобиль-2');
});

test('зона ЧАЕС: Чорнобиль авто-розпізнається з коментаря', async () => {
  const r = await resolveCity(testDb, 'донат на Чорнобиль, тримаймося');
  assert.ok(r, 'розпізнано');
  const s = await testDb.settlement.findUnique({
    where: { id: r!.settlementId },
    select: { name: true, oblast: true },
  });
  assert.equal(s?.name, 'Чорнобиль');
  assert.equal(s?.oblast, 'Київська');
});

test("зона ЧАЕС: «Прип'ять» (омонім словоформи) розпізнається з контекстом — маркер і область", async () => {
  // «прип'ять» збігається зі звичайною словоформою (ВЕСУМ), тож як усі назви-омоніми зараховується
  // лише з контекстом (маркер «місто …» або підказка області) — штатна поведінка стоп-форм, без
  // підгону населення під поріг. (Голий-коментар-кейс — у загальних тестах стоп-форм cityResolve;
  // тут не асертимо `null`, бо на повних даних голе слово може фаззі-збігтися з тезкою на кшталт
  // «Заприп'ять» — у малій тестовій БД його нема, тож такий асерт проходив би хибно.)
  for (const msg of ['донат на місто Прип’ять', "Прип'ять Київщина"]) {
    const r = await resolveCity(testDb, msg);
    assert.ok(r, `«${msg}» розпізнано`);
    const s = await testDb.settlement.findUnique({ where: { id: r!.settlementId }, select: { name: true, oblast: true } });
    assert.equal(s?.name, "Прип'ять", `«${msg}» → Прип'ять`);
    assert.equal(s?.oblast, 'Київська');
  }
});
