export function integerQuantity(text:string,min=1,max=1000000):number {
 const value=text.trim();
 if(!/^\d+$/.test(value))throw new Error('Wpisz ilość jako liczbę całkowitą.');
 const number=Number(value);
 if(!Number.isSafeInteger(number)||number<min||number>max)throw new Error(`Wpisz liczbę od ${min.toLocaleString('pl-PL')} do ${max.toLocaleString('pl-PL')}.`);
 return number;
}

// Keep calculations in thousandths: 0.1 + 0.2 must produce exactly 0.3.
export function quantityUnits(value:string|number):bigint {
 const text=String(value).trim().replace(',','.');
 if(!/^-?\d{1,10}(\.\d{1,3})?$/.test(text))throw new Error('Wpisz poprawną ilość, np. 2,5 (najwyżej 3 miejsca po przecinku).');
 const negative=text.startsWith('-'),[whole,fraction='']=(negative?text.slice(1):text).split('.');
 return (BigInt(whole)*1000n+BigInt(fraction.padEnd(3,'0')))*(negative?-1n:1n);
}
export function quantityNumber(units:bigint):number {
 if(units>BigInt(Number.MAX_SAFE_INTEGER)||units<BigInt(Number.MIN_SAFE_INTEGER))throw new Error('Ilość przekracza dopuszczalny zakres.');
 return Number(`${units<0n?'-':''}${(units<0n?-units:units)/1000n}.${String((units<0n?-units:units)%1000n).padStart(3,'0')}`);
}
export function quantityValue(value:string|number,precision=3,min=0.001,max=1000000):number {
 if(!Number.isInteger(precision)||precision<0||precision>3)throw new Error('Nieprawidłowa precyzja jednostki.');
 const units=quantityUnits(value);
 if(units%10n**BigInt(3-precision)!==0n)throw new Error(precision===0?'Ta jednostka wymaga całych sztuk.':`Ta jednostka dopuszcza ${precision} miejsca po przecinku.`);
 if(units<quantityUnits(min)||units>quantityUnits(max))throw new Error(`Wpisz liczbę od ${min.toLocaleString('pl-PL')} do ${max.toLocaleString('pl-PL')}.`);
 return quantityNumber(units);
}
export function validQuantity(value:unknown,precision=3):value is number {
 if(typeof value!=='number'||!Number.isFinite(value))return false;
 try{quantityValue(value,precision,-10000000,10000000);return true;}catch{return false;}
}
export function addQuantity(a:number,b:number):number{return quantityNumber(quantityUnits(a)+quantityUnits(b));}
export function subtractQuantity(a:number,b:number):number{return quantityNumber(quantityUnits(a)-quantityUnits(b));}
export function quantityStep(precision:number):number{return 10**-precision;}
export function quantityOrNaN(value:string,precision=3,min=0.001,max=1000000):number{try{return quantityValue(value,precision,min,max);}catch{return NaN;}}
