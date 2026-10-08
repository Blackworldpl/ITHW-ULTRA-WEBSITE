import { Suspense } from "react";
import { AppClient } from "@/components/app-client";
import RouteLoading from "../loading";
export default async function ScreenPage({
  params,
}: {
  params: Promise<{ screen: string[] }>;
}) {
  const { screen } = await params;
  return (
    <Suspense fallback={<RouteLoading/>}>
      <AppClient segments={screen} />
    </Suspense>
  );
}
