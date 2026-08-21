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
  signInWithEmailAndPassword,
} from "firebase/auth";
import { FirebaseError } from "firebase/app";
import {
  Eye,
  EyeOff,
  Leaf,
  Loader2,
  LockKeyhole,
  Mail,
  ShieldCheck,
} from "lucide-react";

import { auth } from "@/app/lib/firebase";
import { useAuth } from "@/app/context/AuthContext";

function getFirebaseErrorMessage(
  error: unknown
) {
  if (!(error instanceof FirebaseError)) {
    return "Unable to sign in. Please try again.";
  }

  switch (error.code) {
    case "auth/invalid-email":
      return "Please enter a valid email address.";

    case "auth/user-disabled":
      return "This account has been disabled. Please contact the administrator.";

    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "The email address or password is incorrect.";

    case "auth/too-many-requests":
      return "Too many unsuccessful attempts. Please try again later.";

    case "auth/network-request-failed":
      return "Network error. Please check your internet connection.";

    case "auth/operation-not-allowed":
      return "Email and password sign-in is not enabled.";

    default:
      return error.message
        ? error.message.replace("Firebase: ", "")
        : "Unable to sign in. Please try again.";
  }
}

function getSafeRedirectPath(
  value: string | null
) {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//")
  ) {
    return "/dashboard";
  }

  const blockedRoutes = [
    "/sign-in",
    "/register",
    "/forgot-password",
    "/reset-password",
  ];

  const isBlockedRoute =
    blockedRoutes.some((route) =>
      value.startsWith(route)
    );

  return isBlockedRoute
    ? "/dashboard"
    : value;
}

function SignInContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const {
    firebaseUser,
    userData,
    loading: authLoading,
  } = useAuth();

  const [email, setEmail] =
    useState("");
  const [password, setPassword] =
    useState("");
  const [showPassword, setShowPassword] =
    useState(false);
  const [rememberMe, setRememberMe] =
    useState(false);
  const [submitting, setSubmitting] =
    useState(false);
  const [error, setError] =
    useState("");

  const redirectPath =
    getSafeRedirectPath(
      searchParams.get("redirect")
    );

  useEffect(() => {
    if (
      !authLoading &&
      firebaseUser
    ) {
      const destination =
        userData?.role === "admin" &&
        redirectPath === "/dashboard"
          ? "/admin"
          : redirectPath;

      router.replace(destination);
    }
  }, [
    authLoading,
    firebaseUser,
    redirectPath,
    router,
    userData?.role,
  ]);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    const cleanedEmail =
      email.trim().toLowerCase();

    if (!cleanedEmail) {
      setError(
        "Please enter your email address."
      );
      return;
    }

    if (!password) {
      setError(
        "Please enter your password."
      );
      return;
    }

    try {
      setSubmitting(true);
      setError("");

      await signInWithEmailAndPassword(
        auth,
        cleanedEmail,
        password
      );

      router.replace(redirectPath);
      router.refresh();
    } catch (signInError) {
      console.error(
        "Sign-in failed:",
        signInError
      );

      setError(
        getFirebaseErrorMessage(
          signInError
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
      <div className="grid min-h-screen place-items-center bg-slate-50 px-4">
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <Loader2 className="h-5 w-5 animate-spin text-emerald-700" />

          <p className="text-sm font-medium text-slate-600">
            Loading your account...
          </p>
        </div>
      </div>
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

                AI and IoT-powered agriculture
              </span>

              <h1 className="mt-6 text-4xl font-bold leading-tight tracking-tight text-white xl:text-5xl">
                Monitor cinnamon growth and make better farming decisions.
              </h1>

              <p className="mt-5 max-w-lg text-base leading-7 text-emerald-100">
                Access sensor monitoring,
                disease detection, growth
                prediction and harvest
                readiness from one secure
                platform.
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
              <div>
                <p className="text-sm font-semibold text-emerald-700">
                  Welcome back
                </p>

                <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
                  Sign in to your account
                </h2>

                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Enter your registered email
                  address and password to
                  continue.
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

                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <label
                      htmlFor="password"
                      className="block text-sm font-semibold text-slate-700"
                    >
                      Password
                    </label>

                    <Link
                      href="/forgot-password"
                      className="text-sm font-semibold text-emerald-700 transition hover:text-emerald-800"
                    >
                      Forgot password?
                    </Link>
                  </div>

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
                      autoComplete="current-password"
                      value={password}
                      onChange={(event) => {
                        setPassword(
                          event.target.value
                        );

                        if (error) {
                          setError("");
                        }
                      }}
                      placeholder="Enter your password"
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

                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(event) =>
                      setRememberMe(
                        event.target.checked
                      )
                    }
                    disabled={submitting}
                    className="h-4 w-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-500"
                  />

                  <span className="text-sm font-medium text-slate-600">
                    Keep me signed in
                  </span>
                </label>

                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Signing in...
                    </>
                  ) : (
                    "Sign in"
                  )}
                </button>
              </form>

              <div className="mt-6 border-t border-slate-100 pt-6 text-center">
                <p className="text-sm text-slate-600">
                  Do not have an account?{" "}
                  <Link
                    href="/register"
                    className="font-semibold text-emerald-700 transition hover:text-emerald-800"
                  >
                    Create an account
                  </Link>
                </p>
              </div>
            </div>

            <p className="mt-6 text-center text-xs leading-5 text-slate-500">
              By signing in, you agree to
              securely access the CinnaAI
              monitoring platform.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

function SignInLoading() {
  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 px-4">
      <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <Loader2 className="h-5 w-5 animate-spin text-emerald-700" />
        <p className="text-sm font-medium text-slate-600">
          Loading sign in...
        </p>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<SignInLoading />}>
      <SignInContent />
    </Suspense>
  );
}
