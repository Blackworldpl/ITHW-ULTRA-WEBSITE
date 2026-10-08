import QRCode from 'qrcode';
import {z} from 'zod';
import {getAsset,getInventory} from './services';
import {query} from './db';
import {AppError} from './errors';
import {parse,uuidSchema} from './validation';

// ZPL graphics encode the exact same QR matrix used by the website. This avoids
// interpreting user text as printer commands and permits a fixed measured size.
export function zplText(value:string){return Array.from(Buffer.from(value,'utf8'),byte=>'_'+byte.toString(16).padStart(2,'0').toUpperCase()).join('');}
export function labelZpl(name:string,id:string,url:string,widthMm:number,heightMm:number,dpi:number){
 const width=Math.round(widthMm*dpi/25.4),height=Math.round(heightMm*dpi/25.4),pad=Math.round(2*dpi/25.4),font=Math.round(2.5*dpi/25.4);
 const matrix=QRCode.create(url,{errorCorrectionLevel:'M'}).modules;
 const side=Math.min(width-2*pad,height-3*font-3*pad),scale=Math.floor(side/(matrix.size+8));
 if(scale<2)throw new AppError(400,'Ten rozmiar jest zbyt mały dla adresu QR. Zwiększ etykietę.');
 const pixels=(matrix.size+8)*scale,rowBytes=Math.ceil(pixels/8),bytes=Buffer.alloc(rowBytes*pixels);
 for(let row=0;row<matrix.size;row++)for(let col=0;col<matrix.size;col++)if(matrix.get(row,col))for(let dy=0;dy<scale;dy++)for(let dx=0;dx<scale;dx++){const y=(row+4)*scale+dy,x=(col+4)*scale+dx;bytes[y*rowBytes+Math.floor(x/8)]|=1<<(7-x%8);}
 return `^XA\n^CI28\n^PW${width}\n^LL${height}\n^LH0,0\n^FO${Math.floor((width-pixels)/2)},${pad}^GFA,${bytes.length},${bytes.length},${rowBytes},${bytes.toString('hex').toUpperCase()}^FS\n^FO${pad},${pixels+2*pad}^A0N,${font},${font}^FB${width-2*pad},1,0,C^FH_^FD${zplText(name.slice(0,55))}^FS\n^FO${pad},${pixels+2*pad+font}^A0N,${font},${font}^FB${width-2*pad},1,0,C^FH_^FD${zplText(id)}^FS\n^PQ1\n^XZ\n`;
}
export async function generateLabelZpl(params:URLSearchParams){
 const type=z.enum(['asset','inventory','location']).parse(params.get('type')),id=z.string().min(1).max(150).parse(params.get('id'));
 const number=(key:string,fallback:number,min:number,max:number)=>z.coerce.number().int().min(min).max(max).parse(params.get(key)??fallback);
 const width=number('width',60,30,120),height=number('height',50,30,120),dpi=z.coerce.number().pipe(z.union([z.literal(203),z.literal(300),z.literal(600)])).parse(params.get('dpi')??300);
 let name:string,path:string,identifier=id;
 if(type==='asset'){const record=await getAsset(id);name=record.name;identifier=record.assetId;path='/asset/'+record.assetId;}
 else if(type==='inventory'){const record=await getInventory(id);name=record.name;identifier=record.sku??record.slug;path='/inventory/'+record.slug;}
 else{parse(uuidSchema,id);const record=(await query<{name:string;kind:string}>('SELECT name,kind FROM locations WHERE id=$1',[id])).rows[0];if(!record)throw new AppError(404,'Nie znaleziono lokalizacji.');name=record.name;path=record.kind==='DESK'?'/workstations/'+id:'/assets?locationId='+id;}
 if(!process.env.APP_URL)throw new AppError(503,'Ustaw APP_URL przed generowaniem etykiet.');
 return labelZpl(name,identifier,new URL(path,process.env.APP_URL).href,width,height,dpi);
}
