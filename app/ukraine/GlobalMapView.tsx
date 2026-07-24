'use client';

import { MapUkraine } from '@/app/MapUkraine';
import type { MapPoint } from '@/lib/map';
import { openCity } from './openCity';

// Мапа /ukraine: той самий MapUkraine, клік на місто → картка глобального міста.
export function GlobalMapView({ points }: { points: MapPoint[] }) {
  return <MapUkraine points={points} showControls={false} initialLabels="all" onCitySelect={openCity} valueUnit="uah" />;
}
