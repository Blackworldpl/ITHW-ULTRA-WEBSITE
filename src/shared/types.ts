export const roles = ['VIEWER', 'IT_USER', 'IT_ADVANCED', 'ADMIN'] as const;
export type Role = typeof roles[number];
export const statuses = ['AVAILABLE', 'ASSIGNED', 'DAMAGED', 'REPAIR', 'PREPARATION', 'DISPOSAL', 'RETIRED'] as const;
export type AssetStatus = typeof statuses[number];
export const statusLabels: Record<AssetStatus, string> = { AVAILABLE: 'Dostępny', ASSIGNED: 'Wydany', DAMAGED: 'Uszkodzony', REPAIR: 'W naprawie', PREPARATION: 'Do przygotowania', DISPOSAL: 'Do utylizacji', RETIRED: 'Zutylizowany' };
export const roleLabels: Record<Role, string> = {VIEWER:'Tylko odczyt',IT_USER:'IT User',IT_ADVANCED:'IT Advanced',ADMIN:'Administrator'};
export interface User { id: string; name: string; email: string; role: Role; active?: boolean; mustChangePassword?:boolean; passwordVersion?:number; passwordChangedAt?:string|null; permissions?:import('./permissions').Permission[]; customRoleId?:string|null; customRoleName?:string|null; lastLoginAt?:string|null }
export interface SessionUser extends User { csrfToken: string }
export interface Named { id: string; name: string }
export interface CategoryField { key:string; label:string; type:'text'|'number'|'date'|'boolean'|'select'; required:boolean; options?:string[] }
export interface Category extends Named {description:string|null;fieldDefinitions:CategoryField[];standardFields:import('./asset-fields').StandardFields;version:number}
export interface Supplier extends Named {taxId:string|null;regon:string|null;street:string|null;postalCode:string|null;city:string|null;country:string|null;contactName:string|null;email:string|null;phone:string|null;website:string|null;bankAccount:string|null;notes:string|null;version:number}
export interface Employee extends Named {employeeNumber:string|null;email:string|null;phone:string|null;department:string|null;position:string|null;locationId:string|null;locationName:string|null;userId:string|null;userActive?:boolean|null;active:boolean;notes:string|null;version:number;assetCount:number}
export interface Location extends Named { path: string; kind: string; parentId: string | null; version:number; assetCount?:number; childCount?:number }
export interface Asset {
  id: string; assetId: string; name: string; categoryId: string; categoryName: string;
  manufacturer: string | null; model: string | null; serialNumber: string | null;
  macAddress: string | null; ipAddress: string | null; hostname: string | null;
  locationId: string | null; locationName: string | null; status: AssetStatus;
  owner: string | null; employeeId:string|null; sku:string|null;productCode:string|null; purchasedAt: string | null; purchasePrice: string | null; purchaseCurrency?: string;
  invoiceItemPosition?:number|null; invoiceItemName?:string|null; invoiceId: string | null; invoiceNumber: string | null; supplierName: string | null;
  warrantyUntil: string | null; receivedAt: string; issuedAt: string | null;
  isFixedAsset: boolean; fixedAssetNumber: string | null; rfidTag: string | null;
  notes: string | null; createdAt: string; updatedAt: string; version: number;
  customFields: Record<string, string>;
}
export interface InventoryItem { id: string; slug: string; sku: string|null; productCode:string|null; name: string; category: string; unit: string; quantityPrecision:number; stock: number; minimalStock: number; locationId: string | null; locationName: string | null; notes: string | null; updatedAt: string; version: number }
export interface History { id: string; action: string; actorName: string; createdAt: string; description: string; delta?: number; balanceAfter?: number; invoiceNumber?: string | null; before?: unknown; after?: unknown }
export interface Invoice { id: string; number: string; supplierId: string; supplierName: string; date: string; amount: string|null; currency: string; orderNumber: string | null; receivedBy: string; createdAt: string; version:number; notes:string|null }
export interface InvoiceLine { id: string; name: string; quantity: number; unitPrice: string|null; position?:number; unit?:string; quantityPrecision?:number; serialNumbers?:string[]; manufacturer?:string|null; model?:string|null; locationId?:string|null; inventoryItemName?:string|null; inventoryItemSlug?:string|null; receivedQuantity?:number; inventoryItemId: string | null; categoryId?: string | null; assetIds?: string[] }
export interface InvoiceDetail extends Invoice { items: InvoiceLine[]; assets: Asset[]; deliveries: Delivery[]; supplier?:Supplier }
export interface InvoiceDocument { id: string; name: string; size: number; sha256: string; uploadedBy: string; createdAt: string }
export interface Delivery { id: string; invoiceId: string; invoiceNumber: string; supplierName: string; receivedAt: string; receivedBy: string; itemCount: number; quantities?:{unit:string;quantity:number}[]; notes: string | null }
export interface Lookups { categories: Category[]; locations: Location[]; suppliers: Supplier[]; users: User[]; employees:Employee[]; invoices: Pick<Invoice, 'id'|'number'>[]; serviceNowUrl: string | null }
export interface PageResult<T> { items: T[]; total: number; page: number; pageSize: number }
export interface Dashboard { totalAssets: number; activeAssets: number; statusCounts: Record<AssetStatus,number>; inventoryCount: number; lowStockCount: number; lowStock: InventoryItem[]; monthDeliveries: number; monthReceivedAssets: number; recentDeliveries: Delivery[]; recentAssets: Asset[]; activity: History[] }
export interface SearchResult { type: 'asset'|'inventory'|'invoice'|'location'|'employee'|'incident'|'config'|'document'|'user'; id: string; title: string; subtitle: string; href: string; score?:number }
export interface ReportGroup { id?: string | null; label: string; count: number }
export interface Reports {
  totalAssets: number; fixedAssets: number; unpriced: number;
  byCategory: ReportGroup[]; byStatus: ReportGroup[]; byLocation: ReportGroup[];
  warranty: { expired: number; soon: number; valid: number; unknown: number };
  values: { currency: string; total: string; active: string; fixed: string }[];
  monthly: { month: string; currency: string; count: number; value: string|null; unpriced:number }[];
  bySupplier: { id: string; label: string; currency: string; count: number; value: string|null; unpriced:number }[];
  topWithdrawals: { slug: string; label: string; unit: string; quantity: number }[];
  shortages: { slug: string; sku: string; name: string; unit: string; stock: number; minimum: number; missing: number; location: string | null }[];
}
export interface ApiResponse<T> { data: T; error?: never }
export interface ApiError { error: string; details?: unknown }
export interface Workstation extends Location {assetCount:number}
export interface WorkstationEquipment {location:Workstation;assets:Asset[]}
export interface EquipmentDocumentSummary {id:string;reference:string;kind:'equipment'|'clearance'|'workstation';createdAt:string;createdBy:string;itemCount:number}
export interface EquipmentDocument extends EquipmentDocumentSummary {snapshot:{subject:{name:string;employeeNumber?:string|null;department?:string|null;position?:string|null;email?:string|null;locationName?:string|null};items:{assetId:string;name:string;model:string|null;serialNumber:string|null;status:AssetStatus;locationName:string|null}[];notes:string}}
