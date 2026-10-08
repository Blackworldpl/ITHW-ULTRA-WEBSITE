-- Invoice PDFs are stored transactionally in PostgreSQL and included in its backup.
ALTER TABLE attachments ADD COLUMN content bytea;
ALTER TABLE attachments ADD CONSTRAINT attachments_content_valid CHECK (
  content IS NULL OR (
    invoice_id IS NOT NULL AND asset_id IS NULL AND mime_type = 'application/pdf'
    AND octet_length(content) = size_bytes AND size_bytes <= 10485760
  )
);
CREATE UNIQUE INDEX attachments_invoice_pdf_hash_idx ON attachments(invoice_id, sha256) WHERE content IS NOT NULL;
