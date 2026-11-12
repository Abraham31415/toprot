import { RegisterForm } from "./register-form";
import { AuthLayout } from "@/components/auth/auth-layout";

export default function RegisterPage() {
  return (
    <AuthLayout title="Create your account" subtitle={"Plan. Run. Prove."}>
      <RegisterForm />
    </AuthLayout>
  );
}
