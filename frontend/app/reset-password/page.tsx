"use client";

import {
  FormEvent,
  Suspense,
  useEffect,
  useState,
} from "react";

import Link from "next/link";
import {
  useRouter,
  useSearchParams,
} from "next/navigation";

import {
  confirmPasswordReset,
  verifyPasswordResetCode,
} from "firebase/auth";

import { FirebaseError } from "firebase/app";

import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  Leaf,
  Loader2,
  LockKeyhole,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";

import { auth } from "@/app/lib/firebase";

function getResetErrorMessage(
  error: unknown
) {
  if (!(error instanceof FirebaseError)) {
    return "Unable to reset your password. Please try again.";
  }

  switch (error.code) {
    case "auth/expired-action-code":
      return "This password reset link has expired. Please request a new link.";

    case "auth/invalid-action-code":
      return "This password reset link is invalid or has already been used.";

    case "auth/user-disabled":
      return "This account has been disabled. Please contact the administrator.";

    case "auth/user-not-found":
      return "The account associated with this reset link could not be found.";

    case "auth/weak-password":
      return "Your new password must contain at least 6 characters.";

    case "auth/network-request-failed":
      return "Network error. Please check your internet connection.";

    case "auth/too-many-requests":
      return "Too many requests. Please wait and try again later.";

    default:
      return error.message
        ? error.message.replace(
            "Firebase: ",
            ""
          )
        : "Unable to reset your password. Please try again.";
  }
}

function ResetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const oobCode =
    searchParams.get("oobCode") ?? "";

  const mode =
    searchParams.get("mode") ?? "";

  const [email, setEmail] =
    useState("");

  const [password, setPassword] =
    useState("");

  const [
    confirmPassword,
    setConfirmPassword,
  ] = useState("");

  const [showPassword, setShowPassword] =
    useState(false);

  const [
    showConfirmPassword,
    setShowConfirmPassword,
  ] = useState(false);

  const [checkingLink, setCheckingLink] =
    useState(true);

  const [submitting, setSubmitting] =
    useState(false);

  const [linkValid, setLinkValid] =
    useState(false);

  const [success, setSuccess] =
    useState(false);

  const [error, setError] =
    useState("");

  useEffect(() => {
    let mounted = true;

    async function validateResetLink() {
      if (
        !oobCode ||
        (mode && mode !== "resetPassword")
      ) {
        if (mounted) {
          setError(
            "This password reset link is invalid. Please request a new link."
          );
          setLinkValid(false);
          setCheckingLink(false);
        }

        return;
      }

      try {
        const accountEmail =
          await verifyPasswordResetCode(
            auth,
            oobCode
          );

        if (mounted) {
          setEmail(accountEmail);
          setLinkValid(true);
          setError("");
        }
      } catch (verificationError) {
        console.error(
          "Password reset link verification failed:",
          verificationError
        );

        if (mounted) {
          setError(
            getResetErrorMessage(
              verificationError
            )
          );
          setLinkValid(false);
        }
      } finally {
        if (mounted) {
          setCheckingLink(false);
        }
      }
    }

    validateResetLink();

    return () => {
      mounted = false;
    };
  }, [mode, oobCode]);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setError("");

    if (!linkValid || !oobCode) {
      setError(
        "This password reset link is invalid. Please request a new link."
      );
      return;
    }

    if (!password) {
      setError(
        "Please enter your new password."
      );
      return;
    }

    if (password.length < 6) {
      setError(
        "Your new password must contain at least 6 characters."
      );
      return;
    }

    if (!confirmPassword) {
      setError(
        "Please confirm your new password."
      );
      return;
    }

    if (password !== confirmPassword) {
      setError(
        "The passwords do not match."
      );
      return;
    }

    try {
      setSubmitting(true);

      await confirmPasswordReset(
        auth,
        oobCode,
        password
      );

      setSuccess(true);
      setPassword("");
      setConfirmPassword("");
    } catch (resetError) {
      console.error(
        "Password reset failed:",
        resetError
      );

      setError(
        getResetErrorMessage(resetError)
      );
    } finally {
      setSubmitting(false);
    }
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

                Secure password update
              </span>

              <h1 className="mt-6 text-4xl font-bold leading-tight tracking-tight text-white xl:text-5xl">
                Create a secure new password for your account.
              </h1>

              <p className="mt-5 max-w-lg text-base leading-7 text-emerald-100">
                Choose a strong password to
                protect your CinnaAI account
                and continue accessing your
                monitoring dashboard.
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
              {checkingLink ? (
                <div className="py-8 text-center">
                  <Loader2 className="mx-auto h-9 w-9 animate-spin text-emerald-700" />

                  <h2 className="mt-5 text-xl font-bold text-slate-900">
                    Verifying reset link
                  </h2>

                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    Please wait while we verify
                    your password reset request.
                  </p>
                </div>
              ) : success ? (
                <div className="text-center">
                  <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-100 text-emerald-700">
                    <CheckCircle2 className="h-8 w-8" />
                  </span>

                  <p className="mt-6 text-sm font-semibold text-emerald-700">
                    Password updated
                  </p>

                  <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
                    Your password has been reset
                  </h2>

                  <p className="mt-3 text-sm leading-6 text-slate-500">
                    Your new password was saved
                    successfully. You can now
                    sign in to your CinnaAI
                    account.
                  </p>

                  <button
                    type="button"
                    onClick={() =>
                      router.replace("/sign-in")
                    }
                    className="mt-7 inline-flex h-12 w-full items-center justify-center rounded-xl bg-emerald-700 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-500/20"
                  >
                    Continue to sign in
                  </button>
                </div>
              ) : !linkValid ? (
                <div className="text-center">
                  <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-rose-100 text-rose-700">
                    <TriangleAlert className="h-8 w-8" />
                  </span>

                  <p className="mt-6 text-sm font-semibold text-rose-700">
                    Reset link unavailable
                  </p>

                  <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
                    The reset link is invalid
                  </h2>

                  <p className="mt-3 text-sm leading-6 text-slate-500">
                    {error ||
                      "This password reset link is invalid or has expired."}
                  </p>

                  <Link
                    href="/forgot-password"
                    className="mt-7 inline-flex h-12 w-full items-center justify-center rounded-xl bg-emerald-700 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-500/20"
                  >
                    Request a new reset link
                  </Link>
                </div>
              ) : (
                <>
                  <div>
                    <p className="text-sm font-semibold text-emerald-700">
                      Password recovery
                    </p>

                    <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
                      Set a new password
                    </h2>

                    <p className="mt-2 text-sm leading-6 text-slate-500">
                      Enter a new password for{" "}
                      <span className="font-semibold text-slate-700">
                        {email}
                      </span>
                      .
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
                        htmlFor="password"
                        className="mb-2 block text-sm font-semibold text-slate-700"
                      >
                        New password
                      </label>

                      <div className="relative">
                        <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />

                        <input
                          id="password"
                          name="password"
                          type={
                            showPassword
                              ? "text"
                              : "password"
                          }
                          autoComplete="new-password"
                          value={password}
                          onChange={(event) => {
                            setPassword(
                              event.target.value
                            );

                            if (error) {
                              setError("");
                            }
                          }}
                          placeholder="Minimum 6 characters"
                          disabled={submitting}
                          className="h-12 w-full rounded-xl border border-slate-300 bg-white pl-10 pr-12 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:ring-4 focus:ring-emerald-500/10 disabled:cursor-not-allowed disabled:bg-slate-100"
                        />

                        <button
                          type="button"
                          onClick={() =>
                            setShowPassword(
                              (value) => !value
                            )
                          }
                          disabled={submitting}
                          className="absolute right-3 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 disabled:cursor-not-allowed"
                          aria-label={
                            showPassword
                              ? "Hide password"
                              : "Show password"
                          }
                        >
                          {showPassword ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="confirmPassword"
                        className="mb-2 block text-sm font-semibold text-slate-700"
                      >
                        Confirm new password
                      </label>

                      <div className="relative">
                        <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />

                        <input
                          id="confirmPassword"
                          name="confirmPassword"
                          type={
                            showConfirmPassword
                              ? "text"
                              : "password"
                          }
                          autoComplete="new-password"
                          value={confirmPassword}
                          onChange={(event) => {
                            setConfirmPassword(
                              event.target.value
                            );

                            if (error) {
                              setError("");
                            }
                          }}
                          placeholder="Re-enter your new password"
                          disabled={submitting}
                          className="h-12 w-full rounded-xl border border-slate-300 bg-white pl-10 pr-12 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:ring-4 focus:ring-emerald-500/10 disabled:cursor-not-allowed disabled:bg-slate-100"
                        />

                        <button
                          type="button"
                          onClick={() =>
                            setShowConfirmPassword(
                              (value) => !value
                            )
                          }
                          disabled={submitting}
                          className="absolute right-3 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 disabled:cursor-not-allowed"
                          aria-label={
                            showConfirmPassword
                              ? "Hide confirmed password"
                              : "Show confirmed password"
                          }
                        >
                          {showConfirmPassword ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-xs font-semibold text-slate-700">
                        Password requirements
                      </p>

                      <p className="mt-1 text-xs leading-5 text-slate-500">
                        Your password must contain
                        at least 6 characters.
                      </p>
                    </div>

                    <button
                      type="submit"
                      disabled={submitting}
                      className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {submitting ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />

                          Updating password...
                        </>
                      ) : (
                        "Reset password"
                      )}
                    </button>
                  </form>
                </>
              )}

              {!success && (
                <div className="mt-6 border-t border-slate-100 pt-6">
                  <Link
                    href="/sign-in"
                    className="inline-flex w-full items-center justify-center gap-2 text-sm font-semibold text-emerald-700 transition hover:text-emerald-800"
                  >
                    <ArrowLeft className="h-4 w-4" />

                    Back to sign in
                  </Link>
                </div>
              )}
            </div>

            <p className="mt-6 text-center text-xs leading-5 text-slate-500">
              Password reset links are
              single-use and may expire after a
              limited period.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

function ResetPasswordLoading() {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-4">
      <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <Loader2 className="h-5 w-5 animate-spin text-emerald-700" />

        <p className="text-sm font-medium text-slate-600">
          Loading password reset...
        </p>
      </div>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={<ResetPasswordLoading />}
    >
      <ResetPasswordContent />
    </Suspense>
  );
}