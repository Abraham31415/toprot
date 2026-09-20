import { createClient } from "@/lib/supabase/server";

export type Profile = {
  id: string;
  role: "student" | "supervisor" | null;
  full_name: string;
  institution: string | null;
  created_at: string;
};

export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();

  return data as Profile | null;
}
