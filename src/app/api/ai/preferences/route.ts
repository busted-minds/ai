import { NextResponse } from "next/server";
import {
  normalizeCustomInstructions,
} from "@/lib/chat-preferences";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type PreferencesRequest = {
  customInstructions?: unknown;
};

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null) as PreferencesRequest | null;
  if (typeof body?.customInstructions !== "string") {
    return NextResponse.json({ message: "Custom instructions must be text." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user && !authData.user.is_anonymous ? authData.user : null;
  if (!user) {
    return NextResponse.json({ message: "Sign in to save custom instructions online." }, { status: 401 });
  }

  const customInstructions = normalizeCustomInstructions(body.customInstructions);
  const { data, error } = await supabase
    .from("user_ai_preferences")
    .upsert(
      { user_id: user.id, custom_instructions: customInstructions },
      { onConflict: "user_id" },
    )
    .select("custom_instructions")
    .single();

  if (error) {
    return NextResponse.json({ message: "Custom instructions could not be saved." }, { status: 503 });
  }

  return NextResponse.json({
    customInstructions: normalizeCustomInstructions(data.custom_instructions),
  });
}
