import { isIP } from 'node:net';
import { z } from 'zod';
import { statuses } from '@/shared/types';
import { AppError } from './errors';
import {standardFieldKeys} from '@/shared/asset-fields';
import {validQuantity} from '@/shared/quantity';

export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new AppError(400, `Nieprawidłowe dane: ${issue.path.join('.') || 'formularz'} — ${issue.message}`);
  }
  return parsed.data;
}

export const uuidSchema = z.string().uuid('Wymagany poprawny identyfikator UUID.');
export const assetIdSchema = z.string().regex(/^ITHW-\d{8}$/, 'Nieprawidłowy Asset ID.');
export const slugSchema = z.string().trim().min(1).max(100).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Użyj małych liter, cyfr i myślników.');
const requiredText = (max: number) => z.string().trim().min(1, 'Pole jest wymagane.').max(max);
const nullable = <T extends z.ZodType>(schema: T) => z.preprocess(value => value === '' ? null : value, schema.nullable().optional());
const optionalText = (max: number) => z.preprocess(value => typeof value === 'string' ? value.trim() || null : value, z.string().max(max).nullable().optional());
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Oczekiwana data RRRR-MM-DD.').refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value;
}, 'Nieprawidłowa data.');
export const moneySchema = z.union([z.string(), z.number().finite()]).transform(value => String(value)).pipe(
  z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, 'Kwota musi być nieujemna i mieć najwyżej 2 miejsca po przecinku.')
);
export const quantitySchema=(min=0.001,max=1_000_000)=>z.number().finite().min(min).max(max).refine(value=>validQuantity(value),'Najwyżej 3 miejsca po przecinku.');
export const purchaseLineSchema=z.object({
 kind:z.enum(['asset','inventory','other']),name:optionalText(200),quantity:quantitySchema(),unitPrice:moneySchema.nullable().default(null),
 categoryId:nullable(uuidSchema),inventoryItemId:nullable(uuidSchema),manufacturer:optionalText(120),model:optionalText(160),locationId:nullable(uuidSchema),serialNumbers:z.array(requiredText(160)).max(1000).optional(),
 matches:z.array(z.object({serialNumber:requiredText(160),assetId:assetIdSchema,version:z.number().int().positive()}).strict()).max(1000).optional(),
}).strict().superRefine((v,c)=>{
 if(v.kind==='asset'&&(!v.name||!v.categoryId))c.addIssue({code:'custom',message:'Podaj nazwę i kategorię urządzenia.'});
 if(v.kind==='inventory'&&!v.inventoryItemId)c.addIssue({code:'custom',message:'Wybierz produkt magazynowy.'});
 if(v.kind==='other'&&!v.name)c.addIssue({code:'custom',message:'Podaj nazwę pozycji.'});
 if(v.kind!=='inventory'&&!validQuantity(v.quantity,0))c.addIssue({code:'custom',message:'Ta pozycja wymaga ilości całkowitej.'});
 if(v.kind==='asset'&&v.quantity>1000)c.addIssue({code:'custom',message:'Najwyżej 1000 urządzeń w pozycji.'});
 if(v.kind!=='asset'&&v.serialNumbers?.length)c.addIssue({code:'custom',message:'Numery seryjne dotyczą tylko urządzeń.'});
 if(v.serialNumbers?.length&&v.serialNumbers.length>v.quantity)c.addIssue({code:'custom',message:'Liczba numerów seryjnych przekracza ilość.'});
 if(v.kind!=='asset'&&v.matches?.length)c.addIssue({code:'custom',message:'Dopasowania dotyczą tylko urządzeń.'});
});
export const invoiceSchema = z.object({
  number: requiredText(160), supplierId: uuidSchema, date: dateSchema,
  amount: moneySchema.nullable().default(null), currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).default('PLN'), orderNumber: optionalText(160),notes:optionalText(4000),
  items:z.array(purchaseLineSchema).min(1).max(100).optional(),receive:z.boolean().default(false),requestId:uuidSchema.optional(),
}).strict();
export const invoicePatchSchema=invoiceSchema.omit({receive:true,requestId:true}).extend({
 version:z.number().int().positive(),
 itemPrices:z.array(z.object({id:uuidSchema,unitPrice:moneySchema.nullable()}).strict()).min(1).max(100).optional(),
}).strict().refine(v=>!v.items||!v.itemPrices,'Wybierz edycję pozycji albo uzupełnienie cen.');
const macSchema = z.string().trim().regex(/^(?:[0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}$/, 'Nieprawidłowy adres MAC.').transform(value => value.replaceAll('-', ':').toLowerCase());
const ipSchema = z.string().trim().refine(value => isIP(value) !== 0, 'Nieprawidłowy adres IPv4 lub IPv6.');

export const assetSchema = z.object({
  name: requiredText(200),
  categoryId: uuidSchema,
  manufacturer: optionalText(120),
  model: optionalText(160),
  serialNumber: optionalText(160),
  macAddress: nullable(macSchema),
  ipAddress: nullable(ipSchema),
  hostname: optionalText(160),
  locationId: nullable(uuidSchema),
  status: z.enum(statuses).default('PREPARATION'),
  owner: optionalText(200),
  employeeId: nullable(uuidSchema), sku:optionalText(100), productCode:optionalText(160),
  purchasedAt: nullable(dateSchema),
  purchasePrice: nullable(moneySchema),
  invoiceId: nullable(uuidSchema),
  warrantyUntil: nullable(dateSchema),
  isFixedAsset: z.boolean().default(false),
  fixedAssetNumber: optionalText(120),
  rfidTag: optionalText(200),
  notes: optionalText(4000),
  customFields: z.record(z.string().min(1).max(100), z.string().max(1000)).default({}).refine(value => Object.keys(value).length <= 40, 'Najwyżej 40 pól dodatkowych.'),
}).strict();
// Creation defaults must never reset omitted fields during PATCH.
export const assetPatchSchema = assetSchema.partial().extend({
  status: z.enum(statuses).optional(),
  isFixedAsset: z.boolean().optional(),
  customFields: z.record(z.string().min(1).max(100), z.string().max(1000)).refine(value => Object.keys(value).length <= 40, 'Najwyżej 40 pól dodatkowych.').optional(),
  version: z.number().int().positive(),
}).strict().refine(value => Object.entries(value).some(([key,item]) => key !== 'version' && item !== undefined), 'Brak zmian do zapisania.');

export const inventorySchema = z.object({
  name: requiredText(200),
  sku: optionalText(100),
  productCode:optionalText(160),
  slug: slugSchema,
  category: requiredText(120),
  unit: requiredText(30).default('szt.'),
  minimalStock: quantitySchema(0,10_000_000).default(0),
  locationId: nullable(uuidSchema),
  notes: optionalText(4000),
  openingStock:quantitySchema(0).optional(),openingNote:optionalText(1000),requestId:uuidSchema.optional(),
}).strict();
export const movementSchema = z.object({
  delta: quantitySchema(-1_000_000).refine(value => value !== 0, 'Ilość nie może wynosić 0.'),
  note: optionalText(1000),
  requestId: uuidSchema,
}).strict();

const inventoryLineSchema = z.object({
  kind: z.literal('inventory'),
  inventoryItemId: uuidSchema,
  quantity: quantitySchema(),
  unitPrice: moneySchema,
}).strict();
const assetLineSchema = z.object({
  kind: z.literal('asset'),
  name: requiredText(200),
  categoryId: uuidSchema,
  manufacturer: optionalText(120),
  model: optionalText(160),
  locationId: nullable(uuidSchema),
  quantity: z.number().int().min(1).max(1000),
  unitPrice: moneySchema,
  serialNumbers: z.array(requiredText(160)).max(1000).optional(),
}).strict().refine(value => !value.serialNumbers || value.serialNumbers.length === value.quantity, 'Liczba numerów seryjnych musi odpowiadać ilości.');
export const deliverySchema = z.object({
  invoiceNumber: requiredText(160),
  supplierId: uuidSchema,
  date: dateSchema,
  orderNumber: optionalText(160),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).default('PLN'),
  notes: optionalText(4000),
  requestId: uuidSchema,
  items: z.array(z.discriminatedUnion('kind', [inventoryLineSchema, assetLineSchema])).min(1).max(100),
}).strict().superRefine((value, ctx) => {
  const assetLines = value.items.filter(item => item.kind === 'asset');
  if (assetLines.reduce((sum, item) => sum + item.quantity, 0) > 1000) {
    ctx.addIssue({code:'custom',path:['items'],message:'Jedna dostawa może zawierać najwyżej 1000 urządzeń.'});
  }
  const serials = assetLines.flatMap(item => item.serialNumbers ?? []).map(serial => serial.toLowerCase());
  if (new Set(serials).size !== serials.length) {
    ctx.addIssue({code:'custom',path:['items'],message:'Numery seryjne w dostawie muszą być unikalne.'});
  }
});

export const locationSchema = z.object({
  name: requiredText(160),
  kind: z.enum(['FOLDER','SITE','BUILDING','ZONE','ROOM','RACK','SHELF','BIN','DESK']).optional(),
  parentId: nullable(uuidSchema),
  version:z.number().int().positive().optional(),
}).strict();
const categoryFieldSchema=z.object({key:z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/),label:requiredText(100),type:z.enum(['text','number','date','boolean','select']),required:z.boolean(),options:z.array(requiredText(100)).max(50).optional()}).strict().refine(f=>f.type!=='select'||!!f.options?.length,'Lista wyboru wymaga opcji.');
export const categorySchema = z.object({ name: requiredText(120),description:optionalText(1000),standardFields:z.partialRecord(z.enum(standardFieldKeys),z.boolean()).optional(),fieldDefinitions:z.array(categoryFieldSchema).max(30).refine(fields=>new Set(fields.map(f=>f.key)).size===fields.length,'Klucze pól muszą być unikalne.').optional(),version:z.number().int().positive().optional() }).strict();
export const supplierSchema = z.object({ name: requiredText(200),taxId:optionalText(40),regon:optionalText(40),street:optionalText(200),postalCode:optionalText(30),city:optionalText(120),country:optionalText(80),contactName:optionalText(160),email:nullable(z.string().trim().toLowerCase().email().max(254)),phone:optionalText(60),website:nullable(z.url().max(500).refine(v=>/^https?:\/\//i.test(v),'Użyj adresu HTTP/HTTPS.')),bankAccount:optionalText(100),notes:optionalText(4000),version:z.number().int().positive().optional() }).strict();
export const employeeSchema=z.object({name:z.string().trim().min(2).max(200),employeeNumber:optionalText(80),email:nullable(z.string().trim().toLowerCase().email().max(254)),phone:optionalText(60),department:optionalText(120),position:optionalText(120),locationId:nullable(uuidSchema),userId:nullable(uuidSchema),active:z.boolean().optional(),notes:optionalText(4000),version:z.number().int().positive().optional()}).strict();

export const inventoryPatchSchema = inventorySchema.omit({slug:true,openingStock:true,openingNote:true,requestId:true}).partial().extend({
  unit: requiredText(30).optional(), minimalStock:quantitySchema(0,10_000_000).optional(), version:z.number().int().positive(),
}).strict().refine(value=>Object.entries(value).some(([key,item])=>key!=='version'&&item!==undefined),'Brak zmian do zapisania.');
export const stockCorrectionSchema = z.object({
  stock:quantitySchema(0,10_000_000), expectedStock:quantitySchema(0,10_000_000),
  note:z.string().trim().min(3,'Podaj powód korekty.').max(1000), requestId:uuidSchema,
}).strict();
const actionBase = {version:z.number().int().positive(),note:optionalText(1000)};
export const assetActionSchema = z.discriminatedUnion('action',[
  z.object({...actionBase,action:z.literal('assign'),owner:optionalText(200),employeeId:nullable(uuidSchema)}).strict().refine(v=>!!v.owner||!!v.employeeId,'Wybierz pracownika lub wpisz odbiorcę.'),
  z.object({...actionBase,action:z.literal('return'),status:z.enum(['AVAILABLE','PREPARATION','DAMAGED','REPAIR','DISPOSAL']),locationId:nullable(uuidSchema)}).strict(),
  z.object({...actionBase,action:z.literal('move'),locationId:uuidSchema}).strict(),
  z.object({...actionBase,action:z.literal('status'),status:z.enum(statuses)}).strict(),
  z.object({...actionBase,action:z.literal('rfid'),rfidTag:optionalText(200)}).strict(),
  z.object({version:z.number().int().positive(),action:z.literal('note'),note:requiredText(1000)}).strict(),
]);
