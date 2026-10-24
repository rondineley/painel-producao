export const activeLines = ['7011','7021','7022','7023','7025','7041','7042','7051','7053','7054','7060','SERIGRAFIA','PRE'];
// Retired lines remain readable in historical records and backups.
const storedLines = new Set([...activeLines, '7052', 'TODAS']);
export const topics = ['absenteismo','requisicoes','qualidade','produtividade','tpm'];
export class AppError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T12:00:00Z');
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
export function validateLine(line: unknown): asserts line is string {
  if (typeof line !== 'string' || !storedLines.has(line.startsWith('MENSAL:') ? line.slice(7) : line)) throw new AppError('Linha inválida.');
}
export function validate(line: unknown, period: unknown): asserts line is string {
  validateLine(line);
  if (typeof period !== 'string' || (line.startsWith('MENSAL:') ? !/^\d{4}-(0[1-9]|1[0-2])$/.test(period) : !validDate(period))) throw new AppError(line.startsWith('MENSAL:') ? 'Mês inválido.' : 'Data inválida.');
}
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_TOTAL_IMAGE_BYTES = 12 * 1024 * 1024;
export function decodeImage(src: unknown) {
  if (typeof src !== 'string') throw new AppError('Imagem inválida.');
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(src);
  if (!match || match[2].length % 4 !== 0) throw new AppError('Escolha uma imagem JPG, PNG ou WebP.');
  if (match[2].length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) throw new AppError('A imagem comprimida deve ter até 8 MB.', 413);
  let raw: string;
  try { raw = atob(match[2]); } catch { throw new AppError('Conteúdo de imagem inválido.'); }
  const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
  const valid = match[1] === 'image/jpeg'
    ? bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : match[1] === 'image/png'
      ? [137,80,78,71,13,10,26,10].every((b, i) => bytes[i] === b)
      : bytes.length >= 12 && String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP';
  if (!valid) throw new AppError('O arquivo não contém uma imagem válida.');
  if (bytes.length > MAX_IMAGE_BYTES) throw new AppError('Imagem muito grande.', 413);
  return { bytes, contentType: match[1] };
}
