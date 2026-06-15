import './dock.css';
import type { ReactNode } from 'react';

// Окремий layout доку — ПОЗА (panel): без операторської шапки. Непрозорий (на відміну від
// оверлеїв). <html>/<body> дає кореневий app/layout.tsx; фон доку — у dock.css (body:has).
export const dynamic = 'force-dynamic';

export default function DockLayout({ children }: { children: ReactNode }) {
  return children;
}
