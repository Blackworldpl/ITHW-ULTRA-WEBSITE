import { Suspense } from "react";
import { AppClient } from "@/components/app-client";
import RouteLoading from "./loading";
export default function HomePage() {
  return (
    <Suspense fallback={<RouteLoading/>}>
      <AppClient />
    </Suspense>
  );
}
