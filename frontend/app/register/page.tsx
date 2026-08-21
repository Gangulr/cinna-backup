"use client";

import {
  FormEvent,
  useEffect,
  useState,
} from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  Eye,
  EyeOff,
  Leaf,
  Loader2,
  Lock,
  Mail,
  User,
} from "lucide-react";

import { useAuth } from "@/app/context/AuthContext";

function getRegisterError(error: unknown) {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error
      ? String(error.code)
      : "";

  switch (code) {
    case "auth/email-already-in-use":
      return "An account already exists with this email.";

    case "auth/invalid-email":
      return "Please enter a valid email address.";

    case "auth/weak-password":
      return "Password must contain at least 6 characters.";

    case "auth/network-request-failed":
      return "Network error. Please check your internet connection.";

    default:
      return error instanceof Error
        ? error.message
        : "Registration failed. Please try again.";
  }
}

export default function RegisterPage() {
  const router = useRouter();

  const {
    register,
    firebaseUser,
    userData,
    loading: authLoading,
  } = useAuth();

  const [form, setForm] = useState({
    fullName: "",
    email: "",
    password: "",
    confirmPassword: "",
  });

  const [showPassword, setShowPassword] =
    useState(false);

  const [
    showConfirmPassword,
    setShowConfirmPassword,
  ] = useState(false);

  const [submitting, setSubmitting] =
    useState(false);

  const [error, setError] = useState("");

  useEffect(() => {
    if (
      !authLoading &&
      firebaseUser &&
      userData
    ) {
      router.replace(
        userData.role === "admin"
          ? "/admin"
          : "/dashboard"
      );
    }
  }, [
    authLoading,
    firebaseUser,
    userData,
    router,
  ]);

  function updateField(
    field: keyof typeof form,
    value: string
  ) {
    setForm((previous) => ({
      ...previous,
      [field]: value,
    }));

    setError("");
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();
    setError("");

    if (!form.fullName.trim()) {
      setError("Please enter your full name.");
      return;
    }

    if (!form.email.trim()) {
      setError("Please enter your email address.");
      return;
    }

    if (form.password.length < 6) {
      setError(
        "Password must contain at least 6 characters."
      );
      return;
    }

    if (
      form.password !== form.confirmPassword
    ) {
      setError("Passwords do not match.");
      return;
    }

    try {
      setSubmitting(true);

      await register({
        fullName: form.fullName,
        email: form.email,
        password: form.password,
      });

      router.replace("/dashboard");
    } catch (registrationError) {
      setError(
        getRegisterError(registrationError)
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (authLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#07110c]">
        <Loader2 className="h-9 w-9 animate-spin text-emerald-400" />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#07110c] px-4 py-8 text-white">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-6xl items-center justify-center">
        <div className="grid w-full overflow-hidden rounded-3xl border border-white/10 bg-[#0d1b14] shadow-2xl lg:grid-cols-2">
          <section className="hidden min-h-[680px] bg-gradient-to-br from-emerald-600 to-green-950 p-12 lg:flex lg:flex-col lg:justify-between">
            <div>
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15">
                <Leaf className="h-8 w-8" />
              </div>

              <h1 className="mt-10 text-4xl font-bold leading-tight">
                Smart Cinnamon
                <br />
                Monitoring System
              </h1>

              <p className="mt-6 max-w-md leading-7 text-emerald-50/80">
                Monitor growth, detect diseases,
                analyse harvest readiness and access
                your own cinnamon plant records.
              </p>
            </div>

            <p className="text-sm text-emerald-100/70">
              CinnaAI Research Platform
            </p>
          </section>

          <section className="p-6 sm:p-10 lg:p-12">
            <div className="mx-auto max-w-md">
              <div className="flex items-center gap-3 lg:hidden">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/15">
                  <Leaf className="h-6 w-6 text-emerald-400" />
                </div>

                <span className="text-xl font-bold">
                  CinnaAI
                </span>
              </div>

              <h2 className="mt-8 text-3xl font-bold lg:mt-0">
                Create your account
              </h2>

              <p className="mt-2 text-sm text-slate-400">
                Register to access the monitoring system.
              </p>

              {error && (
                <div className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                  {error}
                </div>
              )}

              <form
                onSubmit={handleSubmit}
                className="mt-8 space-y-5"
              >
                <div>
                  <label
                    htmlFor="fullName"
                    className="mb-2 block text-sm font-medium"
                  >
                    Full name
                  </label>

                  <div className="relative">
                    <User className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />

                    <input
                      id="fullName"
                      type="text"
                      autoComplete="name"
                      value={form.fullName}
                      onChange={(event) =>
                        updateField(
                          "fullName",
                          event.target.value
                        )
                      }
                      placeholder="Enter your full name"
                      className="h-12 w-full rounded-xl border border-white/10 bg-black/20 pl-11 pr-4 text-sm outline-none transition placeholder:text-slate-600 focus:border-emerald-500"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="email"
                    className="mb-2 block text-sm font-medium"
                  >
                    Email address
                  </label>

                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />

                    <input
                      id="email"
                      type="email"
                      autoComplete="email"
                      value={form.email}
                      onChange={(event) =>
                        updateField(
                          "email",
                          event.target.value
                        )
                      }
                      placeholder="name@example.com"
                      className="h-12 w-full rounded-xl border border-white/10 bg-black/20 pl-11 pr-4 text-sm outline-none transition placeholder:text-slate-600 focus:border-emerald-500"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="password"
                    className="mb-2 block text-sm font-medium"
                  >
                    Password
                  </label>

                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />

                    <input
                      id="password"
                      type={
                        showPassword
                          ? "text"
                          : "password"
                      }
                      autoComplete="new-password"
                      value={form.password}
                      onChange={(event) =>
                        updateField(
                          "password",
                          event.target.value
                        )
                      }
                      placeholder="Minimum 6 characters"
                      className="h-12 w-full rounded-xl border border-white/10 bg-black/20 pl-11 pr-12 text-sm outline-none transition placeholder:text-slate-600 focus:border-emerald-500"
                    />

                    <button
                      type="button"
                      onClick={() =>
                        setShowPassword(
                          (previous) => !previous
                        )
                      }
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                    >
                      {showPassword ? (
                        <EyeOff className="h-5 w-5" />
                      ) : (
                        <Eye className="h-5 w-5" />
                      )}
                    </button>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="confirmPassword"
                    className="mb-2 block text-sm font-medium"
                  >
                    Confirm password
                  </label>

                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />

                    <input
                      id="confirmPassword"
                      type={
                        showConfirmPassword
                          ? "text"
                          : "password"
                      }
                      autoComplete="new-password"
                      value={form.confirmPassword}
                      onChange={(event) =>
                        updateField(
                          "confirmPassword",
                          event.target.value
                        )
                      }
                      placeholder="Re-enter your password"
                      className="h-12 w-full rounded-xl border border-white/10 bg-black/20 pl-11 pr-12 text-sm outline-none transition placeholder:text-slate-600 focus:border-emerald-500"
                    />

                    <button
                      type="button"
                      onClick={() =>
                        setShowConfirmPassword(
                          (previous) => !previous
                        )
                      }
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                    >
                      {showConfirmPassword ? (
                        <EyeOff className="h-5 w-5" />
                      ) : (
                        <Eye className="h-5 w-5" />
                      )}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="flex h-12 w-full items-center justify-center rounded-xl bg-emerald-500 font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Creating account...
                    </>
                  ) : (
                    "Create account"
                  )}
                </button>
              </form>

              <p className="mt-7 text-center text-sm text-slate-400">
                Already have an account?{" "}
                <Link
                  href="/sign-in"
                  className="font-semibold text-emerald-400 hover:text-emerald-300"
                >
                  Sign in
                </Link>
              </p>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}