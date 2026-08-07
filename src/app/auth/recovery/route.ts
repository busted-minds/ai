import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.redirect("https://accounts.bustedminds.us.kg/auth?mode=forgot&source=bmai");
}
