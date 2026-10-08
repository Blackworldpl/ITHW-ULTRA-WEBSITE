"use client";

import Link from "next/link";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui";

export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <main className="session-screen error-screen"><Brand/><h1>Nie udało się otworzyć widoku.</h1><p className="muted">Spróbuj ponownie. Jeśli problem się powtarza, skontaktuj się z administratorem systemu.</p><Button onClick={() => retry()}>Spróbuj ponownie</Button><Link href="/">Wróć do przeglądu</Link>{error.digest && <small className="muted mono">ID błędu: {error.digest}</small>}</main>;
}
