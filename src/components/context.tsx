"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import { useRouter,usePathname } from "next/navigation";
import type { Lookups, SessionUser } from "@/shared/types";
import { api, ApiFailure, Button, ErrorMessage, Loading,useResource } from "./ui";
import type {OperationsSummary} from '@/shared/product';
import Link from "next/link";
import { Brand } from "./brand";
import { loginUrl,passwordChangeUrl } from '@/shared/login-return';

interface AppState {
  user: SessionUser;
  lookups: Lookups | null;
  lookupError: string;
  refreshLookups: () => void;
  operations:{data:OperationsSummary|null;error:string;loading:boolean;reload:()=>void};
}
const AppContext = createContext<AppState | null>(null);
export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error("Brak kontekstu aplikacji");
  return value;
}
export function AppProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [error, setError] = useState("");
  const [lookupError, setLookupError] = useState("");
  const [revision, setRevision] = useState(0);
  const pathname=usePathname(),operations=useResource<OperationsSummary>(user?'/api/operations':null);
  useEffect(()=>{operations.reload();},[pathname,revision,operations.reload]);
  const refreshLookups = useCallback(
    () => setRevision((value) => value + 1),
    [],
  );
  useEffect(() => {
    let current = true;
    api<SessionUser>("/api/auth/me")
      .then((value) => {
        if(current){if(value.mustChangePassword){setUser(null);router.replace(passwordChangeUrl(window.location.pathname+window.location.search+window.location.hash));}else setUser(value);}
      })
      .catch((err) => {
        if (!current) return;
        if (err instanceof ApiFailure && err.status === 401)
          router.replace(loginUrl(window.location.pathname + window.location.search + window.location.hash));
        else setError(err.message);
      });
    return () => {
      current = false;
    };
  }, [router, revision]);
  useEffect(() => {
    if (!user) return;
    let current = true;
    api<Lookups>("/api/lookups")
      .then((value) => {
        if (current) {
          setLookups(value);
          setLookupError("");
        }
      })
      .catch((err) => {
        if (current) setLookupError(err.message);
      });
    return () => {
      current = false;
    };
  }, [user, revision]);
  if (!user)
    return (
      <main className="session-screen">
        <Brand/>
        {error ? (
          <>
            <ErrorMessage message={error} />
            <Button
              onClick={() => {
                setError("");
                refreshLookups();
              }}
            >
              Spróbuj ponownie
            </Button>
            <Link href="/setup">Konfiguracja pierwszego konta</Link>
          </>
        ) : (
          <Loading />
        )}
      </main>
    );
  return (
    <AppContext.Provider value={{ user, lookups, lookupError, refreshLookups,operations }}>
      {children}
    </AppContext.Provider>
  );
}
export function canEdit(role: string) {
  return role === "IT_ADVANCED" || role === "ADMIN";
}
export function canMove(role: string) {
  return role !== "VIEWER";
}
