"use client";

import {
  FormEvent,
  useEffect,
  useState,
} from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  ArrowLeft,
  CheckCircle2,
  Leaf,
  Loader2,
  Mail,
  ShieldCheck,
} from "lucide-react";

import {
  sendPasswordResetEmail,
} from "firebase/auth";

import { FirebaseError } from "firebase/app";

import { auth } from "@/app/lib/firebase";
import { useAuth } from "@/app/context/AuthContext";

function getResetErrorMessage(
  error: unknown
) {
  if (!(error instanceof FirebaseError)) {
    return "Unable to send the password reset email. Please try again.";
  }

  switch (error.code) {
    case "auth/invalid-email":
      return "Please enter a valid email address.";

    case "auth/user-disabled":
      return "This account has been disabled. Please contact the administrator.";

    case "auth/user-not-found":
      return "No account was found with this email address.";

    case "auth/missing-email":
      return "Please enter your email address.";

    case "auth/too-many-requests":
      return "Too many requests. Please wait and try again later.";

    case "auth/network-request-failed":
      return "Network error. Please check your internet connection.";

    default:
      return error.message
        ? error.message.replace(
            "Firebase: ",
            ""
          )
        : "Unable to send the password reset email. Please try again.";
  }
}

export default function ForgotPasswordPage() {
  const router = useRouter();

  const {
    firebaseUser,
    userData,
    loading: authLoading,
  } = useAuth();

  const [email, setEmail] =
    useState("");

  const [submitting, setSubmitting] =
    useState(false);

  const [error, setError] =
    useState("");

  const [emailSent, setEmailSent] =
    useState(false);

  useEffect(() => {
    if (
      !authLoading &&
      firebaseUser
    ) {
      router.replace(
        userData?.role === "admin"
          ? "/admin"
          : "/dashboard"
      );
    }
  }, [
    authLoading,
    firebaseUser,
    userData?.role,
    router,
  ]);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    const cleanedEmail =
      email.trim().toLowerCase();

    setError("");
    setEmailSent(false);

    if (!cleanedEmail) {
      setError(
        "Please enter your email address."
      );
      return;
    }

    try {
      setSubmitting(true);

      await sendPasswordResetEmail(
        auth,
        cleanedEmail
      );

      setEmailSent(true);
    } catch (resetError) {
      console.error(
        "Password reset email failed:",
        resetError
      );

      setError(
        getResetErrorMessage(
          resetError
        )
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (
    authLoading ||
    firebaseUser
  ) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 px-4">
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <Loader2 className="h-5 w-5 animate-spin text-emerald-700" />

          <p className="text-sm font-medium text-slate-600">
            Loading your account...
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="grid min-h-screen lg:grid-cols-2">
        <section className="relative hidden overflow-hidden bg-emerald-800 lg:flex">
          <div className="absolute inset-0">
            <div className="absolute -left-24 -top-24 h-80 w-80 rounded-full bg-white/5" />

            <div className="absolute -bottom-32 -right-24 h-96 w-96 rounded-full bg-white/5" />

            <div className="absolute left-1/2 top-1/3 h-56 w-56 -translate-x-1/2 rounded-full bg-emerald-400/10 blur-3xl" />
          </div>

          <div className="relative z-10 flex w-full flex-col justify-between p-12 xl:p-16">
            <Link
              href="/"
              className="inline-flex w-fit items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
            >
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-white text-emerald-800 shadow-lg">
                <Leaf className="h-5 w-5" />
              </span>

              <div>
                <p className="text-lg font-bold text-white">
                  CinnaAI
                </p>

                <p className="text-xs font-medium text-emerald-100">
                  Smart Cinnamon Monitoring
                </p>
              </div>
            </Link>

            <div className="max-w-xl">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-emerald-50">
                <ShieldCheck className="h-4 w-4" />

                Secure account recovery
              </span>

              <h1 className="mt-6 text-4xl font-bold leading-tight tracking-tight text-white xl:text-5xl">
                Reset your password and regain access securely.
              </h1>

              <p className="mt-5 max-w-lg text-base leading-7 text-emerald-100">
                Enter the email address
                associated with your CinnaAI
                account. We will send you a
                secure password reset link.
              </p>
            </div>

            <p className="text-sm text-emerald-100/80">
              © {new Date().getFullYear()}{" "}
              CinnaAI. All rights reserved.
            </p>
          </div>
        </section>

        <section className="flex items-center justify-center px-4 py-10 sm:px-6 lg:px-10">
          <div className="w-full max-w-md">
            <div className="mb-8 lg:hidden">
              <Link
                href="/"
                className="inline-flex items-center gap-3"
              >
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-700 text-white shadow-sm">
                  <Leaf className="h-5 w-5" />
                </span>

                <div>
                  <p className="font-bold text-slate-900">
                    CinnaAI
                  </p>

                  <p className="text-xs text-slate-500">
                    Smart Monitoring
                  </p>
                </div>
              </Link>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              {!emailSent ? (
                <>
                  <div>
                    <p className="text-sm font-semibold text-emerald-700">
                      Account recovery
                    </p>

                    <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
                      Forgot your password?
                    </h2>

                    <p className="mt-2 text-sm leading-6 text-slate-500">
                      Enter your registered
                      email address and we will
                      send you a password reset
                      link.
                    </p>
                  </div>

                  {error && (
                    <div
                      role="alert"
                      className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium leading-6 text-rose-700"
                    >
                      {error}
                    </div>
                  )}

                  <form
                    onSubmit={handleSubmit}
                    className="mt-6 space-y-5"
                  >
                    <div>
                      <label
                        htmlFor="email"
                        className="mb-2 block text-sm font-semibold text-slate-700"
                      >
                        Email address
                      </label>

                      <div className="relative">
                        <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />

                        <input
                          id="email"
                          name="email"
                          type="email"
                          autoComplete="email"
                          value={email}
                          onChange={(event) => {
                            setEmail(
                              event.target.value
                            );

                            if (error) {
                              setError("");
                            }
                          }}
                          placeholder="you@example.com"
                          disabled={submitting}
                          className="h-12 w-full rounded-xl border border-slate-300 bg-white pl-10 pr-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:ring-4 focus:ring-emerald-500/10 disabled:cursor-not-allowed disabled:bg-slate-100"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={submitting}
                      className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {submitting ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />

                          Sending reset link...
                        </>
                      ) : (
                        "Send reset link"
                      )}
                    </button>
                  </form>
                </>
              ) : (
                <div className="text-center">
                  <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-100 text-emerald-700">
                    <CheckCircle2 className="h-8 w-8" />
                  </span>

                  <p className="mt-6 text-sm font-semibold text-emerald-700">
                    Email sent successfully
                  </p>

                  <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
                    Check your inbox
                  </h2>

                  <p className="mt-3 text-sm leading-6 text-slate-500">
                    We sent a password reset
                    link to{" "}
                    <span className="font-semibold text-slate-700">
                      {email.trim().toLowerCase()}
                    </span>
                    .
                  </p>

                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    Please check your inbox and
                    spam folder. Follow the link
                    in the email to create a new
                    password.
                  </p>

                  <button
                    type="button"
                    onClick={() => {
                      setEmailSent(false);
                      setError("");
                    }}
                    className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-500/10"
                  >
                    Use another email
                  </button>
                </div>
              )}

              <div className="mt-6 border-t border-slate-100 pt-6">
                <Link
                  href="/sign-in"
                  className="inline-flex w-full items-center justify-center gap-2 text-sm font-semibold text-emerald-700 transition hover:text-emerald-800"
                >
                  <ArrowLeft className="h-4 w-4" />

                  Back to sign in
                </Link>
              </div>
            </div>

            <p className="mt-6 text-center text-xs leading-5 text-slate-500">
              For security, password reset links
              may expire after a limited period.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}