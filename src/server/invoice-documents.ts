import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { InvoiceDocument, User } from '@/shared/types';
import { requireRole } from './auth';
import { query, transaction } from './db';
import { AppError } from './errors';
import { parse, uuidSchema } from './validation';

export const maxInvoicePdfBytes = 10 * 1024 * 1024;
const projection = `a.id,a.original_name AS name,a.size_bytes::integer AS size,a.sha256,
  u.name AS "uploadedBy",a.created_at AS "createdAt"`;
const from = 'FROM attachments a JOIN users u ON u.id=a.uploaded_by';
const clean = (row: InvoiceDocument): InvoiceDocument => JSON.parse(JSON.stringify(row));

export function validateInvoicePdf(name: string, content: Buffer) {
  if (!name || name.length > 180 || /[\\/\u0000-\u001f\u007f]/.test(name) || !/\.pdf$/i.test(name)) throw new AppError(400, 'Wybierz plik PDF z poprawną nazwą (do 180 znaków).');
  if (content.length > maxInvoicePdfBytes) throw new AppError(413, 'PDF może mieć najwyżej 10 MB.');
  if (!/^%PDF-(?:1\.[0-9]|2\.0)/.test(content.subarray(0, 8).toString('ascii')) || !/%%EOF\s*$/.test(content.subarray(-1024).toString('latin1'))) throw new AppError(400, 'Plik nie ma poprawnego nagłówka i zakończenia PDF.');
}

async function invoiceExists(id: string, client?: PoolClient) {
  parse(uuidSchema, id);
  const result = client ? await client.query('SELECT id FROM invoices WHERE id=$1 FOR UPDATE', [id]) : await query('SELECT id FROM invoices WHERE id=$1', [id]);
  if (!result.rowCount) throw new AppError(404, 'Nie znaleziono faktury.');
}

export async function listInvoiceDocuments(invoiceId: string): Promise<InvoiceDocument[]> {
  await invoiceExists(invoiceId);
  const result = await query<InvoiceDocument>(`SELECT ${projection} ${from} WHERE a.invoice_id=$1 AND a.content IS NOT NULL ORDER BY a.created_at,a.id`, [invoiceId]);
  return result.rows.map(clean);
}

export async function uploadInvoiceDocument(invoiceId: string, name: string, content: Buffer, user: User): Promise<InvoiceDocument> {
  requireRole(user, ['IT_ADVANCED', 'ADMIN']);
  validateInvoicePdf(name, content);
  const sha256 = createHash('sha256').update(content).digest('hex');
  return transaction(async client => {
    await invoiceExists(invoiceId, client);
    const existing = await client.query<InvoiceDocument>(`SELECT ${projection} ${from} WHERE a.invoice_id=$1 AND a.sha256=$2 AND a.content IS NOT NULL`, [invoiceId, sha256]);
    if (existing.rows[0]) return clean(existing.rows[0]);
    const count = await client.query<{count:number}>('SELECT count(*)::integer AS count FROM attachments WHERE invoice_id=$1 AND content IS NOT NULL', [invoiceId]);
    if (count.rows[0].count >= 30) throw new AppError(409, 'Ta faktura ma już 30 dokumentów PDF.');
    const id = randomUUID();
    await client.query(`INSERT INTO attachments(id,invoice_id,storage_key,original_name,mime_type,size_bytes,sha256,uploaded_by,content)
      VALUES($1,$2,$3,$4,'application/pdf',$5,$6,$7,$8)`, [id, invoiceId, `postgresql:invoice/${id}`, name, content.length, sha256, user.id, content]);
    const result = await client.query<InvoiceDocument>(`SELECT ${projection} ${from} WHERE a.id=$1`, [id]);
    const document = clean(result.rows[0]);
    await client.query(`INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,description,after_data)
      VALUES($1,'UPLOAD_INVOICE_PDF','invoice',$2,$3,$4)`, [user.id, invoiceId, `Dołączono PDF faktury: ${name}.`, JSON.stringify(document)]);
    return document;
  });
}

export async function getInvoiceDocument(invoiceId: string, documentId: string) {
  parse(uuidSchema, invoiceId); parse(uuidSchema, documentId);
  const result = await query<{name:string; content:Buffer}>(`SELECT original_name AS name,content FROM attachments
    WHERE id=$1 AND invoice_id=$2 AND content IS NOT NULL`, [documentId, invoiceId]);
  if (!result.rows[0]) throw new AppError(404, 'Nie znaleziono PDF przy tej fakturze.');
  return result.rows[0];
}
