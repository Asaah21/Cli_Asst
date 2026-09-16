import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@/lib/supabase/server";
import { clean, generateJson, getModels, isQuotaError } from "@/lib/clinical/shared";

// Lazy deep-dive for an expanded diagnosis card. Kept out of /api/assess so the
// consultation response stays small — this is only fetched when the clinician
// actually taps "Learn more".

const explainSchema = {
  type: "object",
  additionalProperties: false,
  required: ["bullets"],
  properties: {
    bullets: { type: "array", items: { type: "string" } },
  },
};

export async function POST(req: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = (await req.json()) as { condition?: string };
    const condition = clean(body?.condition);

    if (!condition) {
      return NextResponse.json({ error: "A condition is required." }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY is missing." }, { status: 500 });
    }

    const { primaryModel, fallbackModel } = getModels();
    const ai = new GoogleGenAI({ apiKey });

    const prompt = `
Give 4 to 6 high-yield teaching bullets about ${condition} for a clinician who wants to understand it properly, not just prescribe for it.

Cover whichever matter most: the likely causative organisms or mechanism, why the standard regimen works against them, resistance or failure patterns worth knowing, what distinguishes it from its usual mimics, and the complication to watch for.

One or two sentences per bullet. No preamble, no repetition of the regimen itself.
`;

    let result: { bullets: string[] };

    try {
      result = await generateJson<{ bullets: string[] }>(ai, primaryModel, explainSchema, prompt);
    } catch (error) {
      if (isQuotaError(error)) {
        return NextResponse.json(
          { error: "The AI service is rate limited right now. Try again shortly." },
          { status: 503 }
        );
      }
      result = await generateJson<{ bullets: string[] }>(ai, fallbackModel, explainSchema, prompt);
    }

    const bullets = Array.isArray(result?.bullets)
      ? result.bullets.map((bullet) => clean(bullet)).filter(Boolean).slice(0, 6)
      : [];

    return NextResponse.json({ bullets });
  } catch (error) {
    console.error("Explain error:", error);

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load the deep dive" },
      { status: 500 }
    );
  }
}
