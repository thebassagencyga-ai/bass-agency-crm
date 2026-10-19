import type { Metadata } from "next";
import { PasswordForm } from "./password-form";

export const metadata: Metadata = { title: "Change password · ZeroLapse CRM" };

export default function ResetPasswordPage() {
  return <PasswordForm />;
}
