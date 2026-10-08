import type {Asset,History,Location,Role} from './types';
import type {Permission} from './permissions';
export interface PermissionRole {id:string;name:string;baseRole:Role;permissions:Permission[];version:number}
export interface Configuration {id:string;name:string;categoryId:string|null;categoryName:string|null;manufacturer:string|null;model:string|null;description:string;latestVersion:number;updatedAt:string;author:string}
export interface ConfigurationVersion {id:string;version:string;releaseNotes:string|null;createdAt:string;author:string;attachmentId:string}
export interface ConfigurationDetail extends Configuration {versions:ConfigurationVersion[];content:string}
export interface LibraryDocument {id:string;name:string;mimeType:string;size:number;createdAt:string;author:string;assetId:string|null;invoiceId:string|null;equipmentDocument?:boolean}
export type IncidentStatus='OPEN'|'ASSIGNED'|'WAITING'|'RESOLVED';
export type IncidentPriority='LOW'|'NORMAL'|'HIGH'|'CRITICAL';
export interface Incident {id:string;number:string;title:string;description:string;assetId:string|null;assetName:string|null;assignedTo:string|null;assignedName:string|null;status:IncidentStatus;priority:IncidentPriority;externalReference:string|null;version:number;createdAt:string;updatedAt:string;author:string}
export const incidentStatusLabels:Record<IncidentStatus,string>={OPEN:'Otwarte',ASSIGNED:'W realizacji',WAITING:'Oczekujące',RESOLVED:'Rozwiązane'};
export const incidentPriorityLabels:Record<IncidentPriority,string>={LOW:'Niski',NORMAL:'Normalny',HIGH:'Wysoki',CRITICAL:'Krytyczny'};
export interface InventoryExpected {id:string;assetId:string;name:string;serialNumber:string|null;locationName:string|null}
export interface InventoryScan {id:string;locationId:string;locationName:string;startedBy:string;startedAt:string;completedAt:string|null;status:'OPEN'|'COMPLETED'|'CANCELLED';version:number;expected:number;observed:number;missing:number;unexpected:number;duplicates:number;unknown:number}
export interface InventoryEvent {id:string;assetId:string|null;name:string|null;code:string;result:'EXPECTED'|'UNEXPECTED'|'UNKNOWN'|'DUPLICATE';createdAt:string}
export interface InventoryScanDetail extends InventoryScan {snapshot:InventoryExpected[];events:InventoryEvent[];missingItems:InventoryExpected[]}
export interface LocationDetail {location:Location;children:Location[];assets:Asset[];activity:History[]}
export interface OperationsSummary {openIncidents:number;criticalIncidents:number;openInventory:number;locationCount:number;configurationCount:number;recentIncidents:Incident[];lowStockCount:number}
export interface SystemSettings {serviceNowUrl:string|null;version:number;appUrl:string;integrationMode:'link'}
