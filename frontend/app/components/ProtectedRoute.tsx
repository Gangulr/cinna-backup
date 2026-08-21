"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { useAuth } from "@/app/context/AuthContext";

type ProtectedRouteProps = {
  children: ReactNode;
  adminOnly?: boolean;
};

export default function ProtectedRoute({
  children,
  adminOnly = false,
}: ProtectedRouteProps) {
  const router = useRouter();
  const pathname = usePathname();

  const {
    firebaseUser,
    userData,
    loading,
  } = useAuth();

  useEffect(() => {
    if (loading) {
      return;
    }

    if (!firebaseUser) {
      const redirectPath = encodeURIComponent(
        pathname || "/dashboard"
      );

      router.replace(
        `/sign-in?redirect=${redirectPath}`
      );

      return;
    }

    if (!userData) {
      return;
    }

    if (userData.status === "disabled") {
      router.replace("/sign-in");
      return;
    }

    if (
      adminOnly &&
      userData.role !== "admin"
    ) {
      router.replace("/dashboard");
    }
  }, [
    loading,
    firebaseUser,
    userData,
    adminOnly,
    pathname,
    router,
  ]);

  const isLoadingUserData =
    !loading &&
    Boolean(firebaseUser) &&
    !userData;

  if (loading || isLoadingUserData) {
    return (
      <div className="flex min-h-[calc(100vh-80px)] items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />

          <p className="text-sm font-medium text-slate-500">
            Loading your account...
          </p>
        </div>
      </div>
    );
  }

  if (!firebaseUser || !userData) {
    return null;
  }

  if (userData.status === "disabled") {
    return null;
  }

  if (
    adminOnly &&
    userData.role !== "admin"
  ) {
    return null;
  }

  return <>{children}</>;
}