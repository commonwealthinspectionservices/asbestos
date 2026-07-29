import { redirect } from "next/navigation";

// No public-facing booking flow for now — this is an internal tool.
// /admin itself redirects to /admin/dashboard or /admin/login based on session.
export default function HomePage() {
  redirect("/admin");
}
