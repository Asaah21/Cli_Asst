import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { clean } from "@/lib/clinical/shared";

// Personal "My protocol" notes.
//
// These are entirely clinician-authored — never AI-generated, never shown
// to any other clinician, and never treated as a guideline-endorsed
// recommendation by the rest of the app. They exist purely so a clinician
// can keep their own off-guideline practice notes attached to a condition
// for their own future reference.

export async function GET(req: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const url = new URL(req.url);
    const condition = clean(url.searchParams.get("condition"));

    if (!condition) {
      return NextResponse.json({ error: "A condition is required." }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("protocol_notes")
      .select("id, condition, note, created_at, updated_at")
      .eq("clinician_id", user.id)
      .ilike("condition", condition)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ note: data ?? null });
  } catch (error) {
    console.error("Protocol note GET error:", error);

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load protocol note" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = (await req.json()) as { id?: string; condition?: string; note?: string };

    const condition = clean(body.condition);
    const note = clean(body.note);

    if (!condition || !note) {
      return NextResponse.json({ error: "A condition and note are required." }, { status: 400 });
    }

    const record = {
      clinician_id: user.id,
      condition,
      note,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = body.id
      ? await supabase
          .from("protocol_notes")
          .update(record)
          .eq("id", body.id)
          .eq("clinician_id", user.id)
          .select("id, condition, note, created_at, updated_at")
          .single()
      : await supabase
          .from("protocol_notes")
          .insert(record)
          .select("id, condition, note, created_at, updated_at")
          .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ note: data });
  } catch (error) {
    console.error("Protocol note POST error:", error);

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save protocol note" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const url = new URL(req.url);
    const id = url.searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "An id is required." }, { status: 400 });
    }

    const { error } = await supabase
      .from("protocol_notes")
      .delete()
      .eq("id", id)
      .eq("clinician_id", user.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Protocol note DELETE error:", error);

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete protocol note" },
      { status: 500 }
    );
  }
}
