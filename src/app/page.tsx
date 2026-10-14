import { redirect } from "next/navigation";

// The middleware sends signed-out visitors to /login; everyone else starts at the dashboard.
export default function HomePage() {
  redirect("/dashboard");
}
