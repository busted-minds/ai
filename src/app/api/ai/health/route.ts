import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  getInferenceAvailability,
  getInferenceTelemetry,
  syncInferenceTelemetry,
} from "@/lib/ai/providers";
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
  const sharedStateLoaded = await syncInferenceTelemetry();
  const telemetry = getInferenceTelemetry();
  const runtimeAvailability = getInferenceAvailability(catalog.models);
  const providers = catalog.providers.map((provider) => ({
    ...provider,
    ...(runtimeAvailability.find((runtime) => runtime.provider === provider.provider) ?? {
      routableModels: 0,
      verifiedModels: 0,
      blockedModels: 0,
      state: "unknown" as const,
    }),
  }));
  const routableModels = providers.reduce((total, provider) => total + provider.routableModels, 0);
  const verifiedModels = providers.reduce((total, provider) => total + provider.verifiedModels, 0);
  const status = providers.some((provider) => provider.configured && provider.routableModels > 0)
    ? "operational"
    : "unavailable";

  return NextResponse.json({
    status,
    catalog: {
      refreshedAt: catalog.refreshedAt,
      catalogCandidates: catalog.models.length,
      routableModels,
      verifiedModels,
      providers,
    },
    telemetry,
    sharedStateLoaded,
  }, {
    status: status === "operational" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
