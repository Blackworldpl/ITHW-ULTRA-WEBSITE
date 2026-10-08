import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

// The query optimisations of migration 017 must not change results: the same rows,
// in the same order, as the former expressions. Synthetic data only.
const PL='ąćęłńóśźżĄĆĘŁŃÓŚŹŻ',PLAIN='acelnoszzACELNOSZZ';
const escapeLike=(value:string)=>value.replace(/[\\%_]/g,c=>'\\'+c);
const normalized=(value:string)=>value.replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g,c=>PLAIN[PL.indexOf(c)]);
// Former recursive definitions, kept here as the reference.
const recursivePaths=`WITH RECURSIVE tree AS (SELECT id,name::text AS path FROM locations WHERE parent_id IS NULL UNION ALL SELECT l.id,t.path||' / '||l.name FROM locations l JOIN tree t ON l.parent_id=t.id)`;
const formerAssetPredicate=`((coalesce(a.asset_id,'') || ' ' || coalesce(a.name,'') || ' ' || coalesce(a.serial_number,'') || ' ' ||
 coalesce(a.model,'') || ' ' || coalesce(a.manufacturer,'') || ' ' || coalesce(a.hostname,'') || ' ' || coalesce(emp.name,a.owner,'') || ' ' || coalesce(a.rfid_tag,'') || ' ' || coalesce(a.sku,'') || ' ' || coalesce(a.product_code,'')) ILIKE $1
 OR a.mac_address::text ILIKE $1 OR host(a.ip_address) ILIKE $1 OR i.number ILIKE $1 OR a.fixed_asset_number ILIKE $1)`;

test('Query optimisations return the same rows in the same order',{skip:!process.env.TEST_DATABASE_URL},async t=>{
 const url=process.env.TEST_DATABASE_URL!;assert.ok(new URL(url).pathname.endsWith('_test'));assert.notEqual(url,process.env.DATABASE_URL);
 process.env.DATABASE_URL=url;process.env.APP_URL='http://localhost:3000';Object.assign(process.env,{NODE_ENV:'test'});
 const {NextRequest}=await import('next/server'),route=await import('../src/app/api/[...path]/route'),{query,closePools}=await import('../src/server/db'),{hashPassword}=await import('../src/server/passwords');
 const tag=randomUUID().slice(0,6).toUpperCase(),password='Synthetic equivalence test only!';
 let session={cookie:'',csrf:''};
 async function call(method:'GET'|'PATCH',path:string,body?:unknown){
  const headers:Record<string,string>={origin:'http://localhost:3000','content-type':'application/json',cookie:session.cookie,'x-csrf-token':session.csrf};
  const request=new NextRequest('http://localhost:3000/api/'+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
  const response=await route[method](request,{params:Promise.resolve({path:path.split('?')[0].split('/')})});
  const json=await response.json();assert.ok(response.ok,JSON.stringify(json));return json.data;
 }
 try{
  const email=`equivalence-${tag.toLowerCase()}@test.invalid`;
  const admin=(await query<{id:string}>("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'ADMIN') RETURNING id",['Equivalence '+tag,email,await hashPassword(password)])).rows[0];
  {const request=new NextRequest('http://localhost:3000/api/auth/login',{method:'POST',headers:{origin:'http://localhost:3000','content-type':'application/json'},body:JSON.stringify({email,password})});
   const response=await route.POST(request,{params:Promise.resolve({path:['auth','login']})});const user=(await response.json()).data;session={cookie:response.headers.get('set-cookie')!.split(';')[0],csrf:user.csrfToken};}

  // Synthetic tree, people, documents, equipment and products with awkward values.
  const root=(await query<{id:string}>("INSERT INTO locations(name,kind) VALUES($1,'SITE') RETURNING id",[`Łódź ${tag}`])).rows[0].id;
  const building=(await query<{id:string}>("INSERT INTO locations(name,kind,parent_id) VALUES('Budynek Ż','BUILDING',$1) RETURNING id",[root])).rows[0].id;
  const room=(await query<{id:string}>("INSERT INTO locations(name,kind,parent_id) VALUES('Pokój 12','ROOM',$1) RETURNING id",[building])).rows[0].id;
  const other=(await query<{id:string}>("INSERT INTO locations(name,kind) VALUES($1,'SITE') RETURNING id",[`Gdańsk ${tag}`])).rows[0].id;
  const category=(await query<{id:string}>('INSERT INTO asset_categories(name) VALUES($1) RETURNING id',['Equivalence '+tag])).rows[0].id;
  const supplier=(await query<{id:string}>('INSERT INTO suppliers(name) VALUES($1) RETURNING id',['Equivalence supplier '+tag])).rows[0].id;
  const invoice=(await query<{id:string}>("INSERT INTO invoices(number,supplier_id,date,received_by) VALUES($1,$2,'2026-01-02',$3) RETURNING id",[`FV/${tag}/1`,supplier,admin.id])).rows[0].id;
  const zofia=(await query<{id:string}>('INSERT INTO employees(name) VALUES($1) RETURNING id',[`Zofia Żółć ${tag}`])).rows[0].id;
  const pawel=(await query<{id:string}>('INSERT INTO employees(name) VALUES($1) RETURNING id',[`Paweł Nowak ${tag}`])).rows[0].id;
  const stamp='2026-03-01T10:00:00.123456Z';
  for(let n=0;n<60;n++){
   const assigned=n%3===0,employee=n%6===0?pawel:n%3===0?zofia:null,owner=employee===pawel?`Paweł Nowak ${tag}`:employee===zofia?`Zofia Żółć ${tag}`:n%3===1?`Gość ${tag} ${n}`:null;
   await query(`INSERT INTO assets(name,category_id,manufacturer,model,serial_number,mac_address,ip_address,hostname,location_id,status,owner,employee_id,invoice_id,fixed_asset_number,is_fixed_asset,rfid_tag,sku,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,[
    `${['Laptop','Monitor','Stacja dokująca'][n%3]} ${['Dell','Lenovo'][n%2]} ${tag}`,category,['Dell','Lenovo'][n%2],`Latitude 54${40+n%4}`,`SN-${tag}-${n}`,
    n%4===0?`02:00:00:00:${(n%256).toString(16).padStart(2,'0')}:01`:null,n%5===0?`10.9.${n}.1`:null,n%2===0?`ROB-${tag}-${n}`:null,
    [room,building,other,null][n%4],assigned?'ASSIGNED':'AVAILABLE',assigned?owner:n%3===1?owner:null,employee,n%2===0?invoice:null,
    n%7===0?`ST/${tag}/${n}`:null,n%7===0,n%5===0?`RFID${tag}${n}`:null,n%3===2?`SKU-${tag}-${n}`:null,
    // Rows 20–39 share one timestamp, so keyset paging must break ties by id.
    n>=20&&n<40?stamp:new Date(Date.UTC(2026,2,1,9,n)).toISOString()]);
  }
  // A renamed employee: the stored owner text no longer equals the current name.
  await query('UPDATE employees SET name=$2 WHERE id=$1',[pawel,`Paweł Nowak-Kowalski ${tag}`]);
  for(let n=0;n<40;n++)await query('INSERT INTO inventory_items(name,slug,sku,product_code,category,unit,location_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
   [`${['Kabel żeński HDMI','Toner czarny','Zasilacz łączący'][n%3]} ${tag} ${n}`,`equivalence-${tag.toLowerCase()}-${n}`,n%3===0?null:`SKU-${tag}-${n}`,n%4===0?`PC-${tag}-${n}`:null,
    ['Kable i przewody','Akcesoria'][n%2],'szt.',[room,building,other,null][n%4]]);

  async function assetPages(q:string,useCursor:boolean){
   const ids:string[]=[];let page=1,after:string|null|undefined,total=0;
   while(true){
    const params=new URLSearchParams({q,page:String(page),pageSize:'7'});if(useCursor&&after)params.set('after',after);
    const result=await call('GET','assets?'+params);total=result.total;ids.push(...result.items.map((a:any)=>a.id));
    if(page*7>=total)break;after=result.nextCursor;if(useCursor)assert.ok(after,'cursor for a full page');page++;
   }
   return {ids,total};
  }

  await t.test('asset list search matches the former predicate, with offset and cursor paging',async()=>{
   const terms=['dell',`Latitude 5440`,`5442 Lenovo`,'Żółć',`Nowak-Kowalski`,`Kowalski ${tag} RFID${tag}`,`Nowak ${tag}`,`ST/${tag}`,`FV/${tag}`,'02:00:00:00:0',
    `10.9.1`,`Gość ${tag} 1`,`ROB-${tag}-4`,'%','_',`${tag} 1`,'brak-takiego-tekstu'];
   for(const term of terms){
    const expected=(await query<{id:string}>(`SELECT a.id FROM assets a LEFT JOIN invoices i ON i.id=a.invoice_id LEFT JOIN employees emp ON emp.id=a.employee_id WHERE ${formerAssetPredicate} ORDER BY a.created_at DESC,a.id`,['%'+escapeLike(term)+'%'])).rows.map(r=>r.id);
    if(expected.length>400)continue;
    const offset=await assetPages(term,false),cursor=await assetPages(term,true);
    assert.equal(offset.total,expected.length,`count for "${term}"`);assert.deepEqual(offset.ids,expected,`offset pages for "${term}"`);assert.deepEqual(cursor.ids,expected,`cursor pages for "${term}"`);
   }
   const drift=(await query<{id:string}>(`SELECT a.id FROM assets a LEFT JOIN invoices i ON i.id=a.invoice_id LEFT JOIN employees emp ON emp.id=a.employee_id WHERE ${formerAssetPredicate}`,['%'+escapeLike(`Kowalski ${tag} RFID${tag}`)+'%'])).rowCount;
   assert.ok(drift,'the renamed-employee case is exercised');
  });

  await t.test('cursor paging of the default order equals offset paging across equal timestamps',async()=>{
   let after:string|null=null;
   for(const scope of ['',`&q=${tag}`])for(let page=1;page<=8;page++){
    if(page===1)after=null;
    const byOffset=await call('GET',`assets?page=${page}&pageSize=10${scope}`);
    const byCursor=await call('GET',`assets?page=${page}&pageSize=10${scope}${after?'&after='+encodeURIComponent(after):''}`);
    assert.deepEqual(byCursor.items.map((a:any)=>a.id),byOffset.items.map((a:any)=>a.id),`page ${page}`);assert.equal(byCursor.total,byOffset.total);
    after=byCursor.nextCursor;if(!after)break;
   }
   await assert.rejects(call('GET','assets?after=not-a-cursor'),/kursor/);
  });

  await t.test('warehouse search matches the former per-row expression including location paths',async()=>{
   const terms=['kabel','Kabel żeński','zenski hdmi','ŻEŃSKI',`lodz ${tag}`,'pokoj 12 toner',`budynek z ${tag}`,'SKU-','PC-',`gdansk ${tag} zasilacz`,'akcesoria','%','brak'];
   for(const q of terms){
    const words=[...new Set(normalized(q).split(/\s+/).filter(Boolean))];
    const predicate=words.map((_,i)=>`translate(n.name||' '||coalesce(n.sku,'')||' '||coalesce(n.product_code,'')||' '||n.slug||' '||n.category||' '||coalesce(l.path,''),'${PL}','${PLAIN}') ILIKE $${i+1}`).join(' AND ')||'TRUE';
    const expected=(await query<{id:string}>(`${recursivePaths} SELECT n.id FROM inventory_items n LEFT JOIN tree l ON l.id=n.location_id WHERE ${predicate} ORDER BY n.name ASC NULLS LAST,n.name,n.id`,words.map(w=>'%'+escapeLike(w)+'%'))).rows.map(r=>r.id);
    if(expected.length>400)continue;
    const ids:string[]=[];let total=0;
    for(let page=1;;page++){const result=await call('GET',`inventory?q=${encodeURIComponent(q)}&page=${page}&pageSize=100`);total=result.total;ids.push(...result.items.map((n:any)=>n.id));if(page*100>=total)break;}
    assert.equal(total,expected.length,`count for "${q}"`);assert.deepEqual(ids,expected,`rows for "${q}"`);
   }
  });

  await t.test('stored location paths and branch counts follow renames and moves',async()=>{
   const check=async()=>{
    assert.equal((await query(`${recursivePaths} SELECT l.id FROM locations l LEFT JOIN tree t ON t.id=l.id WHERE t.path IS DISTINCT FROM l.path`)).rowCount,0);
    const former=`WITH RECURSIVE branches AS (SELECT id AS ancestor,id AS child FROM locations UNION ALL SELECT b.ancestor,l.id FROM branches b JOIN locations l ON l.parent_id=b.child),
     counts AS (SELECT b.ancestor,count(a.id)::integer AS asset_count FROM branches b LEFT JOIN assets a ON a.location_id=b.child GROUP BY b.ancestor)
     SELECT l.id,COALESCE(c.asset_count,0) AS asset_count FROM locations l LEFT JOIN counts c ON c.ancestor=l.id ORDER BY l.id`;
    assert.deepEqual((await query('SELECT id,asset_count FROM location_summary ORDER BY id')).rows,(await query(former)).rows);
   };
   await check();
   const locations=await call('GET','lookups');const find=(id:string)=>locations.locations.find((l:any)=>l.id===id);
   await call('PATCH','admin/locations/'+root,{name:`Łódź Bałuty ${tag}`,kind:'SITE',parentId:null,version:find(root).version});await check();
   await call('PATCH','admin/locations/'+building,{name:'Budynek Ż',kind:'BUILDING',parentId:other,version:find(building).version});await check();
   const moved=(await query<{path:string}>('SELECT path FROM locations WHERE id=$1',[room])).rows[0].path;assert.equal(moved,`Gdańsk ${tag} / Budynek Ż / Pokój 12`);
   const listed=await call('GET',`assets?locationId=${room}&pageSize=1`);if(listed.items[0])assert.equal(listed.items[0].locationName,moved);
  });
 }finally{await closePools();}
});
