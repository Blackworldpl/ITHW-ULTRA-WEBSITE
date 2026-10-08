export type ImportRow = {row:number;name:string;quantity:number;serialNumber?:string;sku?:string;manufacturer?:string;model?:string;notes?:string;fixedAssetNumber?:string};
export type ImportPayload = {sourceHash:string;sheet:string;mode:'assets'|'inventory';unit?:string;categoryId?:string;category:string;locationId?:string;fixedAssets:boolean;rows:ImportRow[]};
export type ImportPreview = {rows:{row:number;name:string;quantity:number;status:'new'|'duplicate'|'error';reason:string}[];newRows:number;newUnits:number;duplicates:number;errors:number};
export type ImportResult = {batchId:string;createdRows:number;createdUnits:number;skipped:number};

// RFC4180 quoting, including separators and newlines inside quoted fields.
export function parseCsv(text:string):string[][] {
  text=text.replace(/^\uFEFF/,'');
  const first=text.split(/\r?\n/,1)[0];
  const count=(delimiter:string)=>{let quoted=false,n=0;for(let i=0;i<first.length;i++){if(first[i]==='"'){if(quoted&&first[i+1]==='"'){i++;continue;}quoted=!quoted;}else if(!quoted&&first[i]===delimiter)n++;}return n;};
  const delimiter=[';',',','\t'].sort((a,b)=>count(b)-count(a))[0];
  const rows:string[][]=[]; let row:string[]=[],value='',quoted=false,closed=false;
  const field=()=>{row.push(value);value='';closed=false;};
  const finish=()=>{field();rows.push(row);row=[];if(rows.length>10001)throw new Error('Plik ma więcej niż 10 000 wierszy. Podziel eksport na mniejsze pliki.');};
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){if(c==='"'){if(text[i+1]==='"'){value+='"';i++;}else{quoted=false;closed=true;}}else value+=c;}
    else if(c===delimiter){field();}
    else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;finish();}
    else if(c==='"'&&value===''){quoted=true;}
    else {if(closed&&!/\s/.test(c))throw new Error('Niepoprawny CSV: znak po zamknięciu cudzysłowu.');value+=c;}
    if(row.length>255||value.length>10000)throw new Error('Zbyt dużo kolumn lub za długa komórka.');
  }
  if(quoted)throw new Error('Niepoprawny CSV: niezamknięty cudzysłów.');
  if(value||row.length)finish();
  return rows;
}
