import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AssessmentForm from "@/components/AssessmentForm";
import TreatmentLookup from "@/components/TreatmentLookup";
import DrugLookup from "@/components/DrugLookup";
import PlanReview from "@/components/PlanReview";

export const dynamic = "force-dynamic";

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <main>
      <header className="top">
        <div>
          <h1>Clinical Reference AI</h1>
          <p>Ghana STG + EML</p>
        </div>
        <form action="/auth/signout" method="post">
          <button className="ghost">Sign out</button>
        </form>
      </header>
      <div className="lookupRow">
        <TreatmentLookup />
        <DrugLookup />
      </div>
      <AssessmentForm />
      <PlanReview />
    </main>
  );
}
