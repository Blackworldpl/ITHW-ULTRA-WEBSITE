import {readFileSync,writeFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';

async function main(){
 const target=process.env.TEST_DATABASE_URL??parseEnv(readFileSync('.local/test.env','utf8')).TEST_DATABASE_URL;
 if(!target||!new URL(target).pathname.endsWith('_test'))throw new Error('Benchmark wymaga osobnej bazy _test.');
 process.env.DATABASE_URL=target;process.env.APP_URL='http://localhost:3000';Object.assign(process.env,{NODE_ENV:'test'});
 const {query,pool}=await import('../src/server/db'),{searchHardware}=await import('../src/server/search'),{listAssets}=await import('../src/server/services');
 const tag='BENCH-'+randomUUID().slice(0,8),category=randomUUID(),location=randomUUID(),count=10000,user={id:randomUUID(),name:'Synthetic benchmark',email:'benchmark@example.test',role:'ADMIN' as const};
 const results:Record<string,unknown>={fixtureCount:count,environment:'local PostgreSQL 18, synthetic _test only',measurements:'server functions; excludes browser rendering, network and authentication'};
 try{
  await query('INSERT INTO asset_categories(id,name) VALUES($1,$2)',[category,tag]);
  await query("INSERT INTO locations(id,name,kind) VALUES($1,$2,'FOLDER')",[location,tag]);
  await query("INSERT INTO assets(name,category_id,location_id,status,model,manufacturer,serial_number,rfid_tag,hostname) SELECT $1||' device '||n,$2::uuid,$3::uuid,'AVAILABLE','ZT411','Synthetic maker',$1||'-SN-'||n,$1||'-RFID-'||n,$1||'-host-'||n FROM generate_series(1,$4::int) n",[tag,category,location,count]);
  await query('ANALYZE assets');
  const exact=(await query<{asset_id:string}>('SELECT asset_id FROM assets WHERE category_id=$1 ORDER BY asset_id LIMIT 1',[category])).rows[0].asset_id;
  const measurements:Record<string,{p50Ms:number;p95Ms:number;samples:number}>={};
  async function measure(name:string,operation:()=>Promise<unknown>){await operation();const times:number[]=[];for(let i=0;i<12;i++){const start=performance.now();await operation();times.push(performance.now()-start);}times.sort((a,b)=>a-b);measurements[name]={p50Ms:Math.round(times[6]),p95Ms:Math.round(times[11]),samples:times.length};}
  assert.equal((await searchHardware(exact,user))[0].id,exact);
  await measure('searchExactAssetId',()=>searchHardware(exact,user));
  await measure('searchPartialSerial',()=>searchHardware(tag+'-SN-98',user));
  await measure('searchCommonModel',()=>searchHardware('zt411',user));
  await measure('searchTypoName',()=>searchHardware(tag+' devce',user));
  await measure('paginatedAssetTable',async()=>{const page=await listAssets(new URLSearchParams({locationId:location,page:'1',pageSize:'25',sort:'name'}));assert.equal(page.total,count);assert.equal(page.items.length,25);});
  results.measurements=measurements;writeFileSync('docs/PERFORMANCE_RESULTS.json',JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results));
 }finally{
  // Only this run's unreferenced fictional assets are removed. Never alter operational records.
  await query('DELETE FROM assets WHERE category_id=$1 AND location_id=$2',[category,location]);
  await query('DELETE FROM locations WHERE id=$1',[location]);await query('DELETE FROM asset_categories WHERE id=$1',[category]);await pool.end();
 }
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Benchmark failed');process.exitCode=1;});
