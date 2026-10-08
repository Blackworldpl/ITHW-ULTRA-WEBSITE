import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { z } from 'zod';
import * as auth from '@/server/auth';
import * as service from '@/server/services';
import { success, errorResponse, readJson, readBytes } from '@/server/http';
import { AppError } from '@/server/errors';
import { query } from '@/server/db';
import { previewImport, commitImport } from '@/server/inventory-import';
import { getReports, exportShortages } from '@/server/reports';
import { getInvoiceDocument, listInvoiceDocuments, maxInvoicePdfBytes, uploadInvoiceDocument } from '@/server/invoice-documents';
import {createEmployeeAccount,getEmployee,listEmployees,saveEmployee} from '@/server/directory';
import {generateLabelZpl} from '@/server/labels';
import {createEquipmentDocument,createWorkstation,getEquipmentDocument,getWorkstation,listEquipmentDocuments,listWorkstations} from '@/server/equipment-documents';
import {equipmentDocumentHtml} from '@/shared/equipment-document';
import {equipmentEmail} from '@/server/equipment-email';
import * as access from '@/server/permissions';
import * as library from '@/server/library';
import * as stocktakes from '@/server/stocktakes';
import * as product from '@/server/product-operations';
import {searchHardware} from '@/server/search';
import {observeIdentifier} from '@/server/scans';
import * as devices from '@/server/devices';
import {beginTvPairing,tvPairingStatus,approveTvPairing} from '@/server/tv-pairing';
import {getDashboardPreference,saveDashboardPreference} from '@/server/dashboard-layout';
import {inventoryCategories} from '@/server/inventory-list';
import {getInventoryDictionaries,saveInventoryDictionary,deleteInventoryDictionary} from '@/server/inventory-dictionaries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = {params: Promise<{path:string[]}>};
const advanced = ['IT_ADVANCED','ADMIN'] as const;
const operators = ['IT_USER','IT_ADVANCED','ADMIN'] as const;

async function handle(request: NextRequest, context: Context) {
  try {
    const {path} = await context.params;
    const key = path.join('/');
    const method = request.method;
    const params = request.nextUrl.searchParams;
    const write = method!=='GET';
    if(write) auth.requireOrigin(request);
    if(key==='setup' && method==='GET') return success(await auth.setupAvailable());
    if(key==='setup' && method==='POST') {
      const user = await auth.bootstrap(await readJson(request));
      const response = success(null,201);
      const sessionUser = await auth.issueSession(response,user);
      return new NextResponse(JSON.stringify({data:sessionUser}),{status:201,headers:response.headers});
    }
    if(key==='auth/login' && method==='POST') {
      const user = await auth.authenticate(await readJson(request));
      const response = success(null);
      const sessionUser = await auth.issueSession(response,user);
      return new NextResponse(JSON.stringify({data:sessionUser}),{headers:response.headers});
    }
    if(key==='invite'&&method==='GET')return success(await access.getInvitation(params.get('token')??''));
    if(key==='invite'&&method==='POST'){const invited=await access.acceptInvitation(await readJson(request));const response=success(null,201);const session=await auth.issueSession(response,invited);return new NextResponse(JSON.stringify({data:session}),{status:201,headers:response.headers});}
    if(path[0]==='device'){
      if(path.length===3&&path[2]==='setup'&&method==='GET')return success(await devices.deviceSetup(path[1]));
      if(path.length===3&&path[2]==='pairing'&&(method==='GET'||method==='POST')){const response=success(null);const result=method==='POST'?await beginTvPairing(path[1],request,response):await tvPairingStatus(path[1],request,response);return new NextResponse(JSON.stringify({data:result}),{headers:response.headers});}
      if(path.length===2&&method==='GET')return success(await devices.deviceScreen(path[1],request));
      if(path.length===3&&path[2]==='pair'&&method==='POST'){const response=success({paired:true});await devices.pairDevice(path[1],await readJson(request),response);return response;}
      if(path.length===3&&path[2]==='scan'&&method==='POST')return success(await devices.deviceScan(path[1],request,await readJson(request)));
      throw new AppError(404,'Nie znaleziono operacji urządzenia.');
    }
    const user = await auth.getSession(request,true);
    if(write) auth.checkCsrf(request,user);
    if(key==='auth/me' && method==='GET') return success(user);
    if(key==='auth/logout' && method==='POST') { const response=success({loggedOut:true}); await auth.revokeSession(request,response); return response; }
    if(key==='auth/change-password'&&method==='POST'){const response=success({changed:true});await auth.changeOwnPassword(request,await readJson(request),user);await auth.revokeSession(request,response);return response;}
    auth.requirePasswordReady(user);
    access.guardEndpoint(user,key,method);
    if(key==='inventory/dictionaries'&&method==='GET')return success(await getInventoryDictionaries());
    if(path[0]==='admin'&&path[1]==='inventory-dictionaries'){
      auth.requireRole(user,['ADMIN']);
      if(path.length===2&&method==='GET')return success(await getInventoryDictionaries());
      if(path.length===2&&method==='POST')return success(await saveInventoryDictionary(null,await readJson(request),user),201);
      if(path.length===3&&method==='PATCH')return success(await saveInventoryDictionary(path[2],await readJson(request),user));
      if(path.length===3&&method==='DELETE')return success(await deleteInventoryDictionary(path[2],await readJson(request),user));
    }
    if(key==='dashboard/layout'&&method==='GET')return success(await getDashboardPreference(user));
    if(key==='dashboard/layout'&&method==='PATCH')return success(await saveDashboardPreference(await readJson(request),user));
    if(key==='devices'&&method==='GET')return success(await devices.listDevices(user));
    if(key==='devices'&&method==='POST')return success(await devices.saveDevice(null,await readJson(request),user),201);
    if(path[0]==='devices'&&path.length===2&&method==='PATCH')return success(await devices.saveDevice(path[1],await readJson(request),user));
    if(path[0]==='devices'&&path.length===2&&method==='DELETE')return success(await devices.deleteDevice(path[1],await readJson(request),user));
    if(path[0]==='devices'&&path.length===3&&method==='POST'){
      if(path[2]==='pairing')return success(await devices.newPairing(path[1],await readJson(request),user));
      if(path[2]==='approve')return success(await approveTvPairing(path[1],await readJson(request),user));
      if(path[2]==='access')return success(await devices.setDeviceEnabled(path[1],await readJson(request),user));
    }
    if(key==='scan/observe'&&method==='POST')return success(await observeIdentifier(await readJson(request),user));
    const download=(content:string|Uint8Array,name:string,type:string)=>new NextResponse(typeof content==='string'?content:new Uint8Array(content),{headers:{'Content-Type':type,'Content-Disposition':`attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(name).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16))}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'"}});
    if(key==='operations'&&method==='GET')return success(await product.operationsSummary(user));
    if(key==='portal'&&method==='GET')return success(await product.getSystemSettings());
    if(key==='configs'&&method==='GET')return success(await library.listConfigurations(params.get('q')??'',params.get('assetId')??undefined));
    if(key==='configs'&&method==='POST')return success(await library.saveConfiguration(null,await readJson(request,400000),user),201);
    if(path[0]==='configs'&&path.length===2){if(method==='GET')return success(await library.getConfiguration(path[1],params.get('versionId')??undefined));if(method==='PATCH')return success(await library.saveConfiguration(path[1],await readJson(request,400000),user));}
    if(path[0]==='configs'&&path.length===3&&path[2]==='download'&&method==='GET'){const config=await library.getConfiguration(path[1],params.get('versionId')??undefined);return download(config.content,`${config.name.replace(/[^\p{L}\p{N} ._-]/gu,'_')}.txt`,'text/plain; charset=utf-8');}
    if(path[0]==='configs'&&path.length===3&&path[2]==='apply'&&method==='POST')return success(await library.applyConfiguration(path[1],await readJson(request),user));
    if(key==='documents'&&method==='GET')return success(await library.listDocuments(user,params.get('q')??'',params.get('assetId')??undefined));
    if(key==='documents'&&method==='POST'){let name:string;try{name=decodeURIComponent(request.headers.get('x-file-name')??'');}catch{throw new AppError(400,'Nieprawidłowa nazwa pliku.');}return success(await library.uploadDocument(name,await readBytes(request,10485760),params.get('assetId'),params.get('requestId')??'',user),201);}
    if(path[0]==='documents'&&path.length===2&&method==='GET'){const doc=await library.getDocument(path[1]);return download(new Uint8Array(doc.content),doc.name,doc.mimeType);}
    if(key==='stocktakes'&&method==='GET')return success(await stocktakes.listStocktakes());
    if(key==='stocktakes'&&method==='POST')return success(await stocktakes.startStocktake(await readJson(request),user),201);
    if(path[0]==='stocktakes'&&path.length===2&&method==='GET')return success(await stocktakes.getStocktake(path[1]));
    if(path[0]==='stocktakes'&&path.length===3){if(path[2]==='scan'&&method==='POST')return success(await stocktakes.scanStocktake(path[1],await readJson(request),user));if(path[2]==='finish'&&method==='POST')return success(await stocktakes.finishStocktake(path[1],await readJson(request),user));if(path[2]==='export'&&method==='GET')return download(await stocktakes.exportStocktake(path[1]),'inwentaryzacja.csv','text/csv; charset=utf-8');}
    if(key==='incidents'&&method==='GET')return success(await product.listIncidents(params));
    if(key==='incidents'&&method==='POST')return success(await product.saveIncident(null,await readJson(request),user),201);
    if(key==='incidents/operators'&&method==='GET'){access.requirePermission(user,'incident.edit');return success(await product.incidentOperators());}
    if(path[0]==='incidents'&&path.length===2){if(method==='GET')return success(await product.getIncident(path[1]));if(method==='PATCH')return success(await product.saveIncident(path[1],await readJson(request),user));}
    if(path[0]==='locations'&&path.length===2&&method==='GET')return success(await product.locationDetail(path[1],user));
    if(key==='assets/bulk'&&method==='POST')return success(await product.bulkAssets(await readJson(request),user));
    if(path[0]==='assets'&&path.length===3&&path[2]==='configurations'&&method==='GET'){access.requirePermission(user,'config.view');return success(await library.assetConfigurations(path[1]));}
    if(key==='assets/selection.csv'&&method==='GET'){access.requirePermission(user,'asset.export');return download(await product.exportSelectedAssets((params.get('ids')??'').split(',').filter(Boolean),user),'wybrane-urzadzenia.csv','text/csv; charset=utf-8');}
    if(key==='admin/permissions'&&method==='GET')return success(await access.listPermissionRoles());
    if(key==='admin/permissions'&&method==='POST')return success(await access.savePermissionRole(null,await readJson(request),user),201);
    if(path[0]==='admin'&&path[1]==='permissions'&&path.length===3&&method==='PATCH')return success(await access.savePermissionRole(path[2],await readJson(request),user));
    if(path[0]==='admin'&&path[1]==='users'&&path[3]==='access'&&path.length===4&&method==='PATCH')return success(await access.assignPermissionRole(path[2],await readJson(request),user));
    if(key==='admin/users/invite'&&method==='POST')return success(await access.inviteUser(await readJson(request),user),201);
    if(key==='admin/settings'&&method==='GET')return success(await product.getSystemSettings());
    if(key==='admin/settings'&&method==='PATCH')return success(await product.saveSystemSettings(await readJson(request),user));
    if(key==='lookups' && method==='GET') return success(await service.getLookups(user));
    if(key==='workstations'&&method==='GET')return success(await listWorkstations());
    if(key==='workstations'&&method==='POST')return success(await createWorkstation(await readJson(request),user),201);
    if(path[0]==='workstations'&&path.length===2&&method==='GET')return success(await getWorkstation(path[1]));
    if(['employees','workstations'].includes(path[0])&&path.length===3&&path[2]==='equipment-documents'){
      const target=path[0]==='employees'?'employee':'workstation';
      if(method==='GET')return success(await listEquipmentDocuments(target,path[1]));
      if(method==='POST')return success(await createEquipmentDocument(target,path[1],await readJson(request),user),201);
    }
    if(path[0]==='equipment-documents'&&method==='GET'){
      if(path.length===2)return success(await getEquipmentDocument(path[1]));
      if(path.length===3&&['html','email'].includes(path[2])){
        const doc=await getEquipmentDocument(path[1]),email=path[2]==='email';
        return new NextResponse(email?equipmentEmail(doc):equipmentDocumentHtml(doc),{headers:{'Content-Type':email?'message/rfc822':'text/html; charset=utf-8','Content-Disposition':`attachment; filename="${doc.reference.replace(/[^a-zA-Z0-9-]/g,'-')}.${email?'eml':'html'}"`,'Cache-Control':'private, no-store','Content-Security-Policy':"sandbox; default-src 'none'; style-src 'unsafe-inline'",'X-Content-Type-Options':'nosniff'}});
      }
    }
    if(key==='employees'&&method==='GET')return success(await listEmployees(user));
    if(key==='employees'&&method==='POST')return success(await saveEmployee(null,await readJson(request),user),201);
    if(key==='my-equipment'&&method==='GET')return success(await service.getMyEquipment(user));
    if(path[0]==='employees'&&path.length===2){if(method==='GET')return success(await getEmployee(path[1],user));if(method==='PATCH')return success(await saveEmployee(path[1],await readJson(request),user));}
    if(path[0]==='employees'&&path.length===3&&path[2]==='equipment'&&method==='GET')return success(await service.getEmployeeEquipment(path[1]));
    if(path[0]==='employees'&&path.length===3&&path[2]==='account'&&method==='POST')return success(await createEmployeeAccount(path[1],await readJson(request),user),201);
    if(key==='imports/preview' && method==='POST') { auth.requireRole(user,advanced); return success(await previewImport(await readJson(request,2*1024*1024),user)); }
    if(key==='imports/commit' && method==='POST') { auth.requireRole(user,advanced); return success(await commitImport(await readJson(request,2*1024*1024),user),201); }
    if(key==='dashboard' && method==='GET') return success(await service.getDashboard(user));
    if(key==='search' && method==='GET') return success(await searchHardware(params.get('q') || '',user,request.signal));
    if(key==='scan/resolve' && method==='GET') {const resolved=await service.resolveScan(params.get('code')||'');access.requirePermission(user,resolved.href.startsWith('/asset/')?'asset.view':resolved.href.startsWith('/inventory/')?'inventory.view':'location.view');return success(resolved);}
    if(key==='reports' && method==='GET') return success(await getReports(user));
    if(key==='reports/shortages.csv' && method==='GET') { auth.requireRole(user,advanced); access.requirePermission(user,'inventory.view'); return new NextResponse(await exportShortages(user),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="braki-magazynowe.csv"','Cache-Control':'no-store'}}); }
    if(key==='assets/export' && method==='GET') return new NextResponse(await service.exportAssets(params,user),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="ewidencja-sprzetu.csv"','Cache-Control':'no-store'}});
    if(key==='assets' && method==='GET') return success(await service.listAssets(params));
    if(key==='assets' && method==='POST') { auth.requireRole(user,advanced); return success(await service.createAsset(await readJson(request),user),201); }
    if(path[0]==='assets' && path.length===2) {
      if(method==='GET') return success(await service.getAsset(path[1]));
      if(method==='PATCH') { auth.requireRole(user,advanced); return success(await service.updateAsset(path[1],await readJson(request),user)); }
    }
    if(path[0]==='assets' && path.length===3 && path[2]==='history' && method==='GET') return success(await service.getAssetHistory(path[1]));
    if(path[0]==='assets'&&path.length===4&&path[2]==='history'&&path[3]==='export'&&method==='GET')return new NextResponse(await service.exportAssetHistory(path[1]),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="historia-${path[1]}.csv"`,'Cache-Control':'no-store'}});
    if(path[0]==='assets' && path.length===3 && path[2]==='actions' && method==='POST'){const body=await readJson(request) as {action?:keyof typeof access.actionPermission};if(!body.action||!access.actionPermission[body.action])throw new AppError(400,'Nieprawidłowa akcja.');access.requirePermission(user,access.actionPermission[body.action]);return success(await service.performAssetAction(path[1],body,user));}
    if(key==='inventory' && method==='GET') return success(await service.listInventory(params));
    if(key==='inventory/facets/categories'&&method==='GET')return success(await inventoryCategories(params));
    if(key==='inventory' && method==='POST') { auth.requireRole(user,advanced); return success(await service.createInventory(await readJson(request),user),201); }
    if(path[0]==='inventory' && path.length===2 && method==='GET') return success(await service.getInventory(path[1]));
    if(path[0]==='inventory' && path.length===2 && method==='PATCH') return success(await service.updateInventory(path[1],await readJson(request),user));
    if(path[0]==='inventory' && path.length===3 && path[2]==='correction' && method==='POST') return success(await service.correctStock(path[1],await readJson(request),user));
    if(path[0]==='inventory' && path.length===3 && path[2]==='history' && method==='GET') return success(await service.getInventoryHistory(path[1]));
    if(path[0]==='inventory'&&path.length===4&&path[2]==='history'&&path[3]==='export'&&method==='GET')return new NextResponse(await service.exportInventoryHistory(path[1]),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="historia-${path[1]}.csv"`,'Cache-Control':'no-store'}});
    if(path[0]==='inventory' && path.length===3 && path[2]==='movements' && method==='POST') { auth.requireRole(user,operators); return success(await service.moveInventory(path[1],await readJson(request),user)); }
    if(key==='invoices' && method==='GET') return success(await service.listInvoices(params));
    if(key==='invoices' && method==='POST') return success(await service.createInvoice(await readJson(request),user),201);
    if(key==='invoices/serial-preview'&&method==='POST')return success(await service.previewInvoiceSerials(await readJson(request),user));
    if(path[0]==='invoices'&&path[2]==='items'&&path[4]==='serials'&&path.length===5&&method==='POST')return success(await service.completeInvoiceLine(path[1],path[3],await readJson(request),user));
    if(path[0]==='invoices'&&path[2]==='items'&&path[4]==='receive'&&path.length===5&&method==='POST')return success(await service.receiveInvoiceStock(path[1],path[3],await readJson(request),user));
    if(path[0]==='invoices' && path.length===2 && method==='GET') return success(await service.getInvoice(path[1]));
    if(path[0]==='invoices' && path.length===2 && method==='PATCH') return success(await service.updateInvoice(path[1],await readJson(request),user));
    if(path[0]==='invoices' && path[2]==='documents' && path.length===3) {
      if(method==='GET') return success(await listInvoiceDocuments(path[1]));
      if(method==='POST') {
        auth.requireRole(user,advanced);
        if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/pdf') throw new AppError(415,'Wymagany plik PDF.');
        let name:string;
        try { name=decodeURIComponent(request.headers.get('x-file-name')||''); } catch { throw new AppError(400,'Nieprawidłowa nazwa pliku.'); }
        return success(await uploadInvoiceDocument(path[1],name,await readBytes(request,maxInvoicePdfBytes),user),201);
      }
    }
    if(path[0]==='invoices' && path[2]==='documents' && path.length===4 && method==='GET') {
      const document=await getInvoiceDocument(path[1],path[3]);
      const name=encodeURIComponent(document.name).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
      return new NextResponse(new Uint8Array(document.content),{headers:{'Content-Type':'application/pdf','Content-Length':String(document.content.length),'Content-Disposition':`attachment; filename="faktura.pdf"; filename*=UTF-8''${name}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'"}});
    }
    if(key==='deliveries' && method==='GET') return success(await service.listDeliveries(params));
    if(key==='deliveries' && method==='POST') { auth.requireRole(user,advanced); return success(await service.receiveDelivery(await readJson(request),user),201); }
    if(key==='qr' && method==='GET') {
      const type = z.enum(['asset','inventory','location']).parse(params.get('type'));
      const id = z.string().min(1).max(150).parse(params.get('id'));
      let target: string;
      if(type==='asset') { const asset=await service.getAsset(id); target=`/asset/${encodeURIComponent(asset.assetId)}`; }
      else if(type==='inventory') { const item=await service.getInventory(id); target=`/inventory/${encodeURIComponent(item.slug)}`; }
      else { z.uuid().parse(id); const location=await query<{kind:string}>('SELECT id,kind FROM locations WHERE id=$1',[id]); if(!location.rowCount) throw new AppError(404,'Nie znaleziono lokalizacji.'); target=location.rows[0].kind==='DESK'?`/workstations/${id}`:`/assets?locationId=${encodeURIComponent(id)}`; }
      if(!process.env.APP_URL) throw new AppError(503,'Ustaw APP_URL, aby wygenerować QR.');
      const url = new URL(target,process.env.APP_URL).toString();
      if(params.get('format')==='png') {
        const png=await QRCode.toBuffer(url,{type:'png',margin:4,errorCorrectionLevel:'M',width:480});
        return new NextResponse(new Uint8Array(png),{headers:{'Content-Type':'image/png','Cache-Control':'private, no-store','Content-Disposition':'attachment; filename="kod-qr.png"'}});
      }
      const svg = await QRCode.toString(url,{type:'svg',margin:4,errorCorrectionLevel:'M',width:240});
      return new NextResponse(svg,{headers:{'Content-Type':'image/svg+xml','Cache-Control':'private, no-store','Content-Disposition':'inline'}});
    }
    if(key==='labels/zpl'&&method==='GET'){return new NextResponse(await generateLabelZpl(params),{headers:{'Content-Type':'text/plain; charset=utf-8','Content-Disposition':'attachment; filename="etykieta-zebra.zpl"','Cache-Control':'no-store'}});}
    if(path[0]==='admin') {
      auth.requireRole(user,['ADMIN']);
      if(key==='admin/users' && method==='GET') return success(await auth.listUsers());
      if(key==='admin/users' && method==='POST') return success(await auth.createUser(await readJson(request),user),201);
      if(path[1]==='users' && path.length===3 && method==='PATCH') return success(await auth.updateUser(path[2],await readJson(request),user));
      if(path[1]==='users' && path.length===3 && method==='DELETE') return success(await auth.deleteUser(path[2],user));
      if(path.length===3 && (path[1]==='locations'||path[1]==='categories'||path[1]==='suppliers')) {
        if(method==='PATCH') return success(path[1]==='locations'?await service.updateLocation(path[2],await readJson(request),user):await service.updateDictionary(path[1],path[2],await readJson(request),user));
        if(method==='DELETE') return success(await service.deleteAdminEntry(path[1],path[2],user));
      }
      if(key==='admin/categories' && method==='POST') return success(await service.createCategory(await readJson(request),user),201);
      if(key==='admin/locations' && method==='POST') return success(await service.createLocation(await readJson(request),user),201);
      if(key==='admin/suppliers' && method==='POST') return success(await service.createSupplier(await readJson(request),user),201);
      if(key==='admin/audit' && method==='GET') return success(await service.listAudit());
      if(key==='admin/inventory-export' && method==='GET') return new NextResponse(await service.exportInventoryHistory(),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="inventory-history.csv"','Cache-Control':'no-store'}});
    }
    throw new AppError(404,'Nie znaleziono endpointu API.');
  } catch(error) { return errorResponse(error); }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
