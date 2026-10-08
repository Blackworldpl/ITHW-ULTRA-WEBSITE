"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

export function AnimatedNumber({ value }: { value: number }) {
  const [display, setDisplay] = useState(value);
  const previous = useRef(value);
  useEffect(() => {
    const from = previous.current;
    previous.current = value;
    if (from === value || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(value);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / 280);
      setDisplay(Math.round(from + (value - from) * (1 - (1 - progress) ** 3)));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <span aria-label={new Intl.NumberFormat("pl-PL").format(value)}><span aria-hidden="true">{new Intl.NumberFormat("pl-PL").format(display)}</span></span>;
}

export function CopyValue({ value, label = "identyfikator" }: { value: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const timeout = window.setTimeout(() => setState("idle"), 2000);
    return () => window.clearTimeout(timeout);
  }, [state]);
  return <span className="copy-value"><span className="mono">{value}</span><button type="button" className="icon-button" aria-label={`Kopiuj ${label}`} title={`Kopiuj ${label}`} onClick={async () => {
    try { await navigator.clipboard.writeText(value); setState("copied"); } catch { setState("error"); }
  }}>{state === "copied" ? <Check size={14}/> : <Copy size={14}/>}</button><span className="sr-only" role="status">{state === "copied" ? "Skopiowano" : state === "error" ? "Nie udało się skopiować. Zaznacz i skopiuj tekst ręcznie." : ""}</span>{state === "error" && <small className="text-red">Zaznacz tekst i skopiuj ręcznie.</small>}</span>;
}
