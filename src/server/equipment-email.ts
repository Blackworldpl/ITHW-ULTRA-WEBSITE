import type {EquipmentDocument} from '@/shared/types';
import {documentTitles,equipmentDocumentHtml} from '@/shared/equipment-document';
export function equipmentEmail(doc:EquipmentDocument):string{
 const title=`${documentTitles[doc.kind]} — ${doc.snapshot.subject.name}`,boundary=`ith-${doc.id}`,name=`${doc.reference.replace(/[^a-zA-Z0-9-]/g,'-')}.html`;
 const encode=(text:string)=>Buffer.from(text,'utf8').toString('base64').match(/.{1,76}/g)?.join('\r\n')??'';
 const to=(doc.snapshot.subject.email??'').replace(/[\r\n<>]/g,'');
 return [`To: ${to}`,`Subject: =?UTF-8?B?${Buffer.from(title).toString('base64')}?=`,`X-Unsent: 1`,`MIME-Version: 1.0`,`Content-Type: multipart/mixed; boundary="${boundary}"`,'',`--${boundary}`,'Content-Type: text/plain; charset=utf-8','Content-Transfer-Encoding: base64','',encode(`W załączeniu ${documentTitles[doc.kind].toLowerCase()}: ${doc.reference}.\nDokument jest zapisem stanu z ${new Date(doc.createdAt).toLocaleDateString('pl-PL')}.`),`--${boundary}`,'Content-Type: text/html; charset=utf-8','Content-Transfer-Encoding: base64',`Content-Disposition: attachment; filename="${name}"`,'',encode(equipmentDocumentHtml(doc)),`--${boundary}--`,''].join('\r\n');
}
