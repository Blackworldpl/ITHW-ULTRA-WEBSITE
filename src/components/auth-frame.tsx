'use client';
import Link from 'next/link';
import {Brand} from './brand';
import {ThemeToggle} from './theme';
export function AuthFrame({children}:{children:React.ReactNode}){return <main className="auth-layout industrial-auth"><div className="auth-theme-toggle"><ThemeToggle/></div><header className="auth-identity"><Link href="/login" aria-label="IT Hardware Robakowo"><Brand/></Link><span>IT OPERATIONS / ROBAKOWO</span></header><section className="auth-form-area">{children}</section><footer className="auth-footer"><span>ITH // ASSET MANAGEMENT</span><span>WEWNĘTRZNY SYSTEM IT</span></footer></main>;}
