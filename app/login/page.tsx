import { Suspense } from "react";
import LoginForm from "./form";

export const metadata = { title: "Sign In | GridVision AI" };

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
