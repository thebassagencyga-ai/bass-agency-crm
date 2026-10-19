import type { Metadata } from "next";
import { PasswordForm } from "./password-form";

export const metadata: Metadata = { title: "Change password · Producr CRM" };

export default function ResetPasswordPage() {
  return <PasswordForm />;
}
