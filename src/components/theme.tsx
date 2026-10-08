'use client';
import {createContext,useContext,useEffect,useState} from 'react';
import {Moon,Sun} from 'lucide-react';
export type Theme='light'|'dark'|'system';
const ThemeContext=createContext<{theme:Theme;resolved:'light'|'dark';setTheme:(theme:Theme)=>void}|null>(null);
export function ThemeProvider({children}:{children:React.ReactNode}){
 const [theme,setTheme]=useState<Theme>('dark'),[system,setSystem]=useState<'light'|'dark'>('dark'),[ready,setReady]=useState(false);
 useEffect(()=>{const media=window.matchMedia('(prefers-color-scheme: light)'),sync=()=>setSystem(media.matches?'light':'dark');sync();media.addEventListener('change',sync);try{const value=localStorage.getItem('ith-theme');if(value==='light'||value==='dark'||value==='system')setTheme(value);}catch{}setReady(true);const storage=(e:StorageEvent)=>{if(e.key==='ith-theme'&&(e.newValue==='light'||e.newValue==='dark'||e.newValue==='system'))setTheme(e.newValue);};window.addEventListener('storage',storage);return()=>{media.removeEventListener('change',sync);window.removeEventListener('storage',storage);};},[]);
 const resolved=theme==='system'?system:theme;
 useEffect(()=>{if(!ready)return;document.documentElement.dataset.theme=resolved;document.documentElement.style.colorScheme=resolved;document.querySelector('meta[name="theme-color"]')?.setAttribute('content',resolved==='light'?'#f4f6f8':'#090d12');try{localStorage.setItem('ith-theme',theme);}catch{}},[ready,resolved,theme]);
 return <ThemeContext.Provider value={{theme,resolved,setTheme}}>{children}</ThemeContext.Provider>;
}
export function ThemeToggle(){const context=useContext(ThemeContext);if(!context)return null;const light=context.resolved==='light';return <button type="button" className="icon-button theme-toggle" aria-label={light?'Włącz ciemny motyw':'Włącz jasny motyw'} title={light?'Ciemny motyw':'Jasny motyw'} onClick={()=>context.setTheme(light?'dark':'light')}>{light?<Moon size={18}/>:<Sun size={18}/>}</button>;}
export function ThemeSettings(){const context=useContext(ThemeContext);if(!context)return null;return <section className="settings-form theme-settings"><h2>Wygląd aplikacji</h2><p>Zapamiętywany w tej przeglądarce, także po ponownym uruchomieniu.</p><label className="field"><span>Motyw</span><select aria-label="Motyw aplikacji" value={context.theme} onChange={e=>context.setTheme(e.target.value as Theme)}><option value="light">Jasny</option><option value="dark">Ciemny</option><option value="system">Zgodny z systemem</option></select></label></section>;}
