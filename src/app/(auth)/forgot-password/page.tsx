import type { Metadata } from "next";
import { ForgotForm } from "./forgot-form";

export const metadata: Metadata = { title: "Reset password · ZeroLapse CRM" };

export default function ForgotPasswordPage() {
  return <ForgotForm />;
}
