import {readFileSync,writeFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';

async function main(){
 const target=process.env.TEST_DATABASE_URL??parseEnv(readFileSync('.local/test.env','utf8')).TEST_DATABASE_URL;
 if(!target||!new URL(target).pathname.endsWith('_test'))throw Error('Benchmark requires an isolated _test database.');
 process.env.DATABASE_URL=target;
 const {query,pool}=await import('../src/server/db'),{listInventory,inventoryCategories}=await import('../src/server/inventory-list');
 const tag='WHBENCH-'+randomUUID().slice(0,8),slugPrefix=tag.toLowerCase()+'-',count=12000,location=randomUUID();
 const measurements:Record<string,{p50Ms:number;p95Ms:number;samples:number}>={};
 async function measure(name:string,operation:()=>Promise<unknown>){await operation();const times:number[]=[];for(let i=0;i<12;i++){const start=performance.now();await operation();times.push(performance.now()-start);}times.sort((a,b)=>a-b);measurements[name]={p50Ms:Math.round(times[6]),p95Ms:Math.round(times[11]),samples:times.length};}
 try{
  await query("INSERT INTO locations(id,name,kind) VALUES($1,$2,'FOLDER')",[location,tag]);
  await query(`INSERT INTO inventory_items(name,slug,sku,product_code,category,unit,stock,minimal_stock,location_id)
   SELECT $1||' cable '||i,$2||i,$1||'-SKU-'||i,$1||'-MODEL-'||i,$1||' category '||(i%24),'szt.',i%100,15,$3 FROM generate_series(1,$4::integer) i`,[tag,slugPrefix,location,count]);
  await query('ANALYZE inventory_items');
  await measure('scopedTableAndSummary50',async()=>{const page=await listInventory(new URLSearchParams({locationId:location,pageSize:'50',overview:'true'}));assert.equal(page.total,count);assert.equal(page.items.length,50);});
  await measure('multiwordSearch',async()=>{const page=await listInventory(new URLSearchParams({q:tag+' cable',pageSize:'50',overview:'true'}));assert.equal(page.total,count);assert.equal(page.items.length,50);});
  await measure('stockSort100',async()=>{const page=await listInventory(new URLSearchParams({locationId:location,sort:'stock',direction:'asc',pageSize:'100',overview:'true'}));assert.equal(page.items.length,100);});
  await measure('shortageSort',async()=>{const page=await listInventory(new URLSearchParams({locationId:location,sort:'shortage',pageSize:'50',stockState:'low',overview:'true'}));assert.equal(page.total,1920);});
  await measure('deepPage',async()=>{const page=await listInventory(new URLSearchParams({locationId:location,pageSize:'50',page:'200',overview:'true'}));assert.equal(page.items.length,50);});
  await measure('categorySuggestions',async()=>{const page=await inventoryCategories(new URLSearchParams({q:tag}));assert.equal(page.total,24);});
  const results={fixtureCount:count,environment:'local PostgreSQL 18, isolated synthetic _test',scope:'server queries only; excludes authentication, network and browser rendering',measurements};
  writeFileSync('docs/WAREHOUSE_PERFORMANCE.json',JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results));
 }finally{
  // Only this run's unreferenced synthetic fixtures, identified by UUID and prefix.
  await query("DELETE FROM inventory_items WHERE location_id=$1 AND left(slug,length($2))=$2",[location,slugPrefix]);
  await query('DELETE FROM locations WHERE id=$1 AND name=$2',[location,tag]);await pool.end();
 }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
