import { NextResponse } from "next/server";
import { safeSearchReturn } from "@/lib/auth/search-return";

export function GET(request: Request) {
  const url = new URL(request.url);
  return NextResponse.redirect(safeSearchReturn(url.searchParams.get("return")), 303);
}
