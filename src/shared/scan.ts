/** Accept only identifiers and application routes; never navigate to arbitrary QR URLs. */
export function scanTarget(raw:string, origin:string):string|null {
  const value=raw.trim();
  if(/^ITHW-\d{8}$/.test(value))return `/asset/${value}`;
  if(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(value))return `/inventory/${value}`;
  let url:URL;try{url=new URL(value,origin);}catch{return null;}
  if(url.origin!==origin || url.username || url.password || url.hash)return null;
  if(/^\/asset\/ITHW-\d{8}$/.test(url.pathname) && !url.search)return url.pathname;
  if(/^\/inventory\/[a-z0-9]+(-[a-z0-9]+)*$/.test(url.pathname) && !url.search)return url.pathname;
  if(/^\/workstations\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(url.pathname)&&!url.search)return url.pathname;
  if(url.pathname==='/assets' && Array.from(url.searchParams.keys()).length===1 && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(url.searchParams.get('locationId')||''))return url.pathname+url.search;
  if(url.pathname==='/locations' && Array.from(url.searchParams.keys()).length===1 && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(url.searchParams.get('selected')||''))return url.pathname+url.search;
  return null;
}
