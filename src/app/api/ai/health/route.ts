import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getInferenceTelemetry } from "@/lib/ai/providers";
import {
  forceModelCatalogRefresh,
  getFreeModelCatalog,
} from "@/lib/ai/model-registry";

export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const expected = process.env.AI_HEALTH_TOKEN;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || !supplied) return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length
    && timingSafeEqual(expectedBytes, suppliedBytes);
}

export async function GET(request: Request) {
  if (!process.env.AI_HEALTH_TOKEN) {
    return new NextResponse(null, { status: 404 });
  }
  if (!authorized(request)) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const refresh = new URL(request.url).searchParams.get("refresh") === "1";
  const catalog = refresh
    ? await forceModelCatalogRefresh()
    : await getFreeModelCatalog();
  const telemetry = getInferenceTelemetry();
  const status = catalog.providers.some((provider) => provider.configured && provider.eligibleModels > 0)
    ? "operational"
    : "unavailable";

  return NextResponse.json({
    status,
    catalog: {
      refreshedAt: catalog.refreshedAt,
      eligibleModels: catalog.models.length,
      providers: catalog.providers,
    },
    telemetry,
  }, {
    status: status === "operational" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
