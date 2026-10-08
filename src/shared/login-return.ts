const localOrigin = 'https://ithardware.invalid';

// Accept application pages only; login links must never become external redirects.
export function safeReturnPath(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(value)) return '/';
  try {
    const url = new URL(value, localOrigin);
    if (url.origin !== localOrigin || !/^\/(?:asset\/ITHW-\d{8}|inventory\/[a-z0-9]+(?:-[a-z0-9]+)*|invoice\/[0-9a-f-]{36}|employees(?:\/[0-9a-f-]{36})?|my-equipment|assets|inventory|invoices|deliveries|reports|scan|import|configs|admin(?:\/[a-z-]+)?)?$/.test(url.pathname)) return '/';
    return url.pathname + url.search + url.hash;
  } catch { return '/'; }
}

export function loginUrl(returnPath: string): string {
  return `/login?next=${encodeURIComponent(safeReturnPath(returnPath))}`;
}

export function passwordChangeUrl(returnPath:string):string{
  return `/change-password?next=${encodeURIComponent(safeReturnPath(returnPath))}`;
}
