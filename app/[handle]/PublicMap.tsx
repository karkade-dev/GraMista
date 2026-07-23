'use client';

import { MapUkraine } from '@/app/MapUkraine';
import type { MapPoint } from '@/lib/map';
import { openCity } from './TopCities';

// Мапа публічної сторінки: той самий MapUkraine, клік на місто → подія картки (gramista:city).
// flyToSelectedCity — мапа сама летить до міста на подію gramista:city (клік у топі/стрічці/мапі).
export function PublicMap({ points, world }: { points: MapPoint[]; world?: boolean }) {
  return (
    <MapUkraine
      points={points}
      showControls={false}
      initialLabels="all"
      onCitySelect={openCity}
      flyToSelectedCity
      world={world}
    />
  );
}
