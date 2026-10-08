import type {InventoryItem,PageResult} from './types';
import {subtractQuantity} from './quantity';

export const stockStateLabels={all:'Wszystkie',low:'Do uzupełnienia',out:'Brak na stanie',ok:'Stan prawidłowy',inStock:'Na stanie'} as const;
export type InventoryStockState=keyof typeof stockStateLabels;
export const inventorySortLabels={name:'Produkt',sku:'SKU',category:'Kategoria',stock:'Stan',minimum:'Minimum',shortage:'Niedobór',location:'Lokalizacja',updatedAt:'Aktualizacja'} as const;
export type InventorySort=keyof typeof inventorySortLabels;
export interface InventorySummary {products:number;low:number;out:number;ok:number}
export interface InventoryPage extends PageResult<InventoryItem> {summary?:InventorySummary}
export interface InventoryCategory {name:string;count:number}
export function inventoryState(item:Pick<InventoryItem,'stock'|'minimalStock'>):'out'|'low'|'ok'{return item.stock===0?'out':item.stock<=item.minimalStock?'low':'ok';}
export function inventoryShortage(item:Pick<InventoryItem,'stock'|'minimalStock'>){return Math.max(0,subtractQuantity(item.minimalStock,item.stock));}
