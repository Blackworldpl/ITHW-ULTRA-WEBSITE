import { NextResponse, type NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { AppError } from './errors';

export function success(data: unknown, status = 200) { return NextResponse.json({data}, {status,headers:{'Cache-Control':'no-store'}}); }
export async function readJson(request: NextRequest, maxBytes = 128 * 1024): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new AppError(415,'Wymagany format JSON.');
  const bytes = await readBytes(request, maxBytes);
  try { return JSON.parse(bytes.toString('utf8')); } catch { throw new AppError(400,'Nieprawidłowy JSON.'); }
}
export async function readBytes(request: NextRequest, maxBytes: number): Promise<Buffer> {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > maxBytes) throw new AppError(413,'Żądanie jest zbyt duże.');
  const reader = request.body?.getReader();
  if (!reader) throw new AppError(400,'Brak danych formularza.');
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const {value,done} = await reader.read(); if(done) break;
    size += value.byteLength;
    if(size > maxBytes) { await reader.cancel(); throw new AppError(413,'Żądanie jest zbyt duże.'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
export function errorResponse(error: unknown) {
  if (error instanceof AppError) return NextResponse.json({error:error.message,...(error.code?{code:error.code}:{})},{status:error.status,headers:{'Cache-Control':'no-store'}});
  if (error instanceof ZodError) return NextResponse.json({error:error.issues.map(i=>`${i.path.join('.') || 'Formularz'}: ${i.message}`).join('; ')},{status:400});
  const code = typeof error==='object' && error && 'code' in error ? String(error.code) : '';
  const known: Record<string,[number,string]> = {
    '23505':[409,'Ten identyfikator, numer dokumentu lub e-mail już istnieje.'],
    '23503':[400,'Wybrany powiązany rekord nie istnieje. Odśwież formularz.'],
    '23514':[400,'Dane nie spełniają ograniczeń systemu.'],
    '22P02':[400,'Nieprawidłowy identyfikator lub format danych.'],
    '40001':[409,'Dane zmieniły się podczas zapisu. Ponów operację.'],
    '40P01':[409,'Równoczesna operacja zablokowała zapis. Ponów operację.'],
    'PASSWORD_BUSY':[503,'Serwer jest chwilowo zajęty. Spróbuj ponownie za chwilę.'],
    'ECONNREFUSED':[503,'Baza PostgreSQL jest niedostępna. Uruchom bazę i wykonaj migracje.'],
    'ENOTFOUND':[503,'Nie można połączyć się z bazą PostgreSQL.'],
    '42P01':[503,'Wykonaj migracje bazy danych przed uruchomieniem aplikacji.']
  };
  const [status,message] = known[code] ?? [500,'Nie udało się wykonać operacji. Sprawdź log serwera.'];
  console.error('IT Hardware request failure', code || (error instanceof Error ? error.name : 'unknown'));
  return NextResponse.json({error:message},{status,headers:{'Cache-Control':'no-store'}});
}
