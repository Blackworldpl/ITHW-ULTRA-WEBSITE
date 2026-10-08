export type InventoryDictionaryKind='category'|'unit';
export interface InventoryDictionaryEntry {id:string;kind:InventoryDictionaryKind;name:string;label:string;active:boolean;version:number;used:number;quantityPrecision:number}
export interface InventoryDictionaries {categories:InventoryDictionaryEntry[];units:InventoryDictionaryEntry[]}
