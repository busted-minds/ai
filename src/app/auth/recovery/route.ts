import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.redirect("https://accounts.bustedminds.org/auth?mode=forgot&source=bmai");
}
