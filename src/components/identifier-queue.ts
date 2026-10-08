'use client';
import {createUuid} from '@/shared/uuid';
import {useEffect,useRef,useState} from 'react';
export function useIdentifierQueue<T>(save:(code:string,requestId:string)=>Promise<T>,onSaved:(value:T,code:string)=>void){
 const queue=useRef<{code:string;requestId:string}[]>([]),running=useRef(false),blocked=useRef(false),mounted=useRef(true),callbacks=useRef({save,onSaved});callbacks.current={save,onSaved};
 const [queued,setQueued]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState(''),[failedCode,setFailedCode]=useState('');
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 async function drain(){
  if(running.current||blocked.current||!mounted.current)return;running.current=true;setBusy(true);
  try{while(queue.current.length&&mounted.current){const item=queue.current[0];try{const value=await callbacks.current.save(item.code,item.requestId);queue.current.shift();if(mounted.current){callbacks.current.onSaved(value,item.code);setQueued(queue.current.length);setError('');setFailedCode('');}}catch(e){blocked.current=true;if(mounted.current){setError((e as Error).message);setFailedCode(item.code);}break;}}}finally{running.current=false;if(mounted.current)setBusy(false);}
 }
 function enqueue(code:string){if(!code.trim())return false;if(queue.current.length>=200){setError('Kolejka ma 200 odczytów. Poczekaj na zapis i ponownie odczytaj ten kod.');return false;}queue.current.push({code:code.trim(),requestId:createUuid()});setQueued(queue.current.length);void drain();return true;}
 function retry(){blocked.current=false;setError('');void drain();}
 function skip(){if(running.current||!blocked.current)return;queue.current.shift();blocked.current=false;setQueued(queue.current.length);setFailedCode('');setError('');void drain();}
 return {enqueue,retry,skip,busy,queued,error,failedCode};
}
