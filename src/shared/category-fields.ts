import type {CategoryField} from './types';
export function categoryFieldError(definitions:CategoryField[],values:Record<string,string>):string|null {
 for(const field of definitions){
  const value=values[field.key]?.trim()??'';
  if(!value){if(field.required)return `Uzupełnij pole: ${field.label}.`;continue;}
  if(field.type==='number'&&(!/^-?\d+(?:\.\d+)?$/.test(value)||!Number.isFinite(Number(value))))return `${field.label}: wpisz liczbę.`;
  if(field.type==='boolean'&&!['true','false'].includes(value))return `${field.label}: wybierz Tak lub Nie.`;
  if(field.type==='select'&&!field.options?.includes(value))return `${field.label}: wybierz wartość z listy.`;
  if(field.type==='date'){const date=new Date(value+'T00:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value)return `${field.label}: podaj poprawną datę.`;}
 }
 return null;
}
