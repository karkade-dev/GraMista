import QRCode from 'qrcode';

// QR донату для картинки-звіту: satori не має canvas, тож віддаємо готовий PNG data-URI
// у кольорах картки (темні модулі на світлому «тихому полі»).
export function qrDataUri(url: string): Promise<string> {
  return QRCode.toDataURL(url, { margin: 2, color: { dark: '#1B1714', light: '#F3E9DF' } });
}
