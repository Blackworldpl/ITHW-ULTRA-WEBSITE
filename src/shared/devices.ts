import type {InventoryScan,InventoryEvent,IncidentPriority,IncidentStatus} from './product';
import type {AssetStatus} from './types';
export type DeviceKind='TV'|'SCANNER';
export type DeviceMode='OVERVIEW'|'INCIDENTS'|'MESSAGE'|'LOOKUP'|'CONTINUOUS'|'INVENTORY';
export const tvMetricLabels={total:'Urządzenia',available:'Dostępne',assigned:'Wydane',repair:'W naprawie',preparation:'Do przygotowania',damaged:'Uszkodzone',disposal:'Do utylizacji',openIncidents:'Otwarte zgłoszenia',criticalIncidents:'Krytyczne zgłoszenia'} as const;
export type TvMetric=keyof typeof tvMetricLabels;
export const tvIncidentFieldLabels={number:'Numer zgłoszenia',assetName:'Nazwa urządzenia',priority:'Priorytet',status:'Status',updatedAt:'Data aktualizacji'} as const;
export type TvIncidentField=keyof typeof tvIncidentFieldLabels;
export const tvSectionLabels={message:'Komunikat',statistics:'Liczniki',incidents:'Zgłoszenia'} as const;
export type TvSection=keyof typeof tvSectionLabels;
export interface TvDashboardConfig {
 metrics:TvMetric[];incidentStatuses:IncidentStatus[];incidentPriorities:IncidentPriority[];incidentFields:TvIncidentField[];
 categoryId:string|null;includeChildren:boolean;incidentLimit:number;incidentSort:'priority'|'newest'|'oldest';
 sectionOrder:TvSection[];columns:1|2|3;textSize:'standard'|'large'|'xlarge';pageSize:number;rotateSeconds:number;showClock:boolean;
}
export function defaultTvDashboard():TvDashboardConfig{return {metrics:['total','available','assigned','repair','openIncidents','criticalIncidents'],incidentStatuses:['OPEN','ASSIGNED','WAITING'],incidentPriorities:['LOW','NORMAL','HIGH','CRITICAL'],incidentFields:['number','assetName','priority','status','updatedAt'],categoryId:null,includeChildren:true,incidentLimit:20,incidentSort:'priority',sectionOrder:['message','statistics','incidents'],columns:2,textSize:'standard',pageSize:6,rotateSeconds:15,showClock:true};}
export function tvDashboard(config:DeviceConfig):TvDashboardConfig{return {...defaultTvDashboard(),...config.tv};}
export const terminalAssetFieldLabels={assetId:'Asset ID',serialNumber:'Numer seryjny',model:'Model',status:'Status',locationName:'Lokalizacja'} as const;
export const terminalInventoryFieldLabels={sku:'SKU',stock:'Stan magazynowy',minimalStock:'Minimalny stan',locationName:'Lokalizacja'} as const;
export const terminalCounterLabels={expected:'Oczekiwane',observed:'Odczytane',missing:'Brakujące',unexpected:'Nadmiarowe',duplicates:'Duplikaty',unknown:'Nieznane'} as const;
export interface TerminalConfig {
 assetFields:(keyof typeof terminalAssetFieldLabels)[];inventoryFields:(keyof typeof terminalInventoryFieldLabels)[];
 counters:(keyof typeof terminalCounterLabels)[];showCode:boolean;showHistory:boolean;historyLimit:number;showCamera:boolean;
 textSize:'standard'|'large';inputLabel:string;inputPlaceholder:string;
}
export function defaultTerminalConfig():TerminalConfig{return {assetFields:['assetId','serialNumber','model','status','locationName'],inventoryFields:['sku','stock','minimalStock','locationName'],counters:['expected','observed','missing','unexpected','duplicates','unknown'],showCode:true,showHistory:true,historyLimit:20,showCamera:true,textSize:'standard',inputLabel:'Kod QR / RFID / numer urządzenia',inputPlaceholder:'Zeskanuj kod czytnikiem'};}
export function terminalConfig(config:DeviceConfig):TerminalConfig{return {...defaultTerminalConfig(),...config.scanner};}
export type DeviceInventory=Pick<InventoryScan,'id'|'locationName'|'status'> & Partial<Pick<InventoryScan,keyof typeof terminalCounterLabels>>;
export interface DeviceConfig {
 mode:DeviceMode;theme:'light'|'dark';title:string;locationId:string|null;stocktakeId:string|null;
 showStats:boolean;showIncidents:boolean;message:string;messageLevel:'INFO'|'WARNING'|'CRITICAL';refreshSeconds:number;
 tv?:TvDashboardConfig;
 scanner?:TerminalConfig;
}
export const deviceModeLabels:Record<DeviceMode,string>={OVERVIEW:'Centrum operacyjne',INCIDENTS:'Zgłoszenia na żywo',MESSAGE:'Komunikat',LOOKUP:'Sprawdź urządzenie',CONTINUOUS:'Kolejne odczyty',INVENTORY:'Inwentaryzacja'};
export function defaultDeviceConfig(kind:DeviceKind):DeviceConfig{return {mode:kind==='TV'?'OVERVIEW':'LOOKUP',theme:'light',title:'',locationId:null,stocktakeId:null,showStats:true,showIncidents:true,message:'',messageLevel:'INFO',refreshSeconds:5,...(kind==='TV'?{tv:defaultTvDashboard()}:{scanner:defaultTerminalConfig()})};}
export interface ManagedDevice {id:string;name:string;kind:DeviceKind;assetId:string|null;assetName:string|null;enabled:boolean;config:DeviceConfig;version:number;paired:boolean;pairedAt:string|null;lastSeenAt:string|null;pairingExpiresAt:string|null;createdAt:string}
export interface DevicePairing {device:ManagedDevice;url:string;code:string|null;expiresAt:string|null}
export interface TvPairingCode {code:string;expiresAt:string}
export interface TvPairingState {status:'waiting'|'expired'|'approved'|'replaced'}
export interface DeviceScreenData {
 id:string;name:string;kind:DeviceKind;version:number;config:DeviceConfig;csrfToken:string;updatedAt:string;
 statistics:{total?:number;statuses:Partial<Record<AssetStatus,number>>;openIncidents?:number;criticalIncidents?:number}|null;
 metrics:{key:TvMetric;value:number}[];incidentCount:number;
 incidents:{id:string;title:string;number?:string;priority?:IncidentPriority;status?:IncidentStatus;assetName?:string|null;updatedAt?:string}[];
 inventory:DeviceInventory|null;
}
export interface DeviceReading {code:string;title:string;asset:({name:string}&Partial<{assetId:string;serialNumber:string|null;model:string|null;status:AssetStatus;locationName:string|null}>)|null;product?:{name:string;sku?:string|null;stock?:number;minimalStock?:number;unit?:string;locationName?:string|null};event?:InventoryEvent;inventory?:DeviceInventory}
