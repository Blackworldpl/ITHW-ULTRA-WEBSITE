"use client";

import { useEffect, useState } from "react";

/** The supplied wordmark stays typographic; the compact mark is for small surfaces. */
export function Brand({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  return compact ? (
    <span className={`brand-monogram ${className}`} role="img" aria-label="IT Hardware Robakowo">IT</span>
  ) : (
    <span className={`brand-wordmark ${className}`} role="img" aria-label="IT Hardware Robakowo">
      <span className="brand-name">IT HARDWARE</span>
      <span className="brand-place">ROBAKOWO</span>
    </span>
  );
}

/** Once per browser session, with no focus trap or delay to application requests. */
export function BrandIntro() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    try {
      if (sessionStorage.getItem("ith-brand-seen")) return;
      sessionStorage.setItem("ith-brand-seen", "1");
    } catch { return; }
    setVisible(true);
    const timeout = window.setTimeout(() => setVisible(false), 1100);
    return () => window.clearTimeout(timeout);
  }, []);
  return visible ? <div className="brand-intro" aria-hidden="true"><Brand/><span className="brand-intro-line"/></div> : null;
}
