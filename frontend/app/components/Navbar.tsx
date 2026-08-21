"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  LayoutDashboard,
  Leaf,
  Radio,
  Microscope,
  TrendingUp,
  CalendarCheck,
  Bot,
  History,
  Menu,
  X,
  ChevronDown,
  User,
  Settings,
  LogOut,
  LogIn,
  Users,
  Loader2,
} from "lucide-react";

import { useAuth } from "@/app/context/AuthContext";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{
    className?: string;
  }>;
};

const primaryNav: NavItem[] = [
  {
    href: "/",
    label: "Home",
    icon: Leaf,
  },
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
  },
  {
    href: "/iot-monitoring",
    label: "IoT",
    icon: Radio,
  },
  {
    href: "/diseaseprediction",
    label: "Disease",
    icon: Microscope,
  },
  {
    href: "/growthprediction",
    label: "Growth",
    icon: TrendingUp,
  },
  {
    href: "/harvest-readiness",
    label: "Harvest",
    icon: CalendarCheck,
  },
  {
    href: "/robotic-harvesting",
    label: "Robotic",
    icon: Bot,
  },
  {
    href: "/history",
    label: "History",
    icon: History,
  },
];

const hiddenNavbarRoutes = [
  "/sign-in",
  "/register",
  "/forgot-password",
  "/reset-password",
];

function isActivePath(
  pathname: string,
  href: string
) {
  if (href === "/") {
    return pathname === "/";
  }

  return (
    pathname === href ||
    pathname.startsWith(`${href}/`)
  );
}

function getInitial(name?: string | null) {
  const cleanedName = name?.trim();

  if (!cleanedName) {
    return "U";
  }

  return cleanedName.charAt(0).toUpperCase();
}

export default function Navbar() {
  const pathname = usePathname() ?? "/";
  const router = useRouter();

  const {
    firebaseUser,
    userData,
    loading,
    logout,
  } = useAuth();

  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] =
    useState(false);
  const [loggingOut, setLoggingOut] =
    useState(false);

  const profileRef =
    useRef<HTMLDivElement>(null);

  const items = useMemo(
    () =>
      primaryNav.map((item) => ({
        ...item,
        active: isActivePath(
          pathname,
          item.href
        ),
      })),
    [pathname]
  );

  const hideNavbar =
    hiddenNavbarRoutes.some((route) =>
      pathname.startsWith(route)
    );

  const displayName =
    userData?.fullName ||
    firebaseUser?.displayName ||
    "User";

  const displayEmail =
    userData?.email ||
    firebaseUser?.email ||
    "";

  const displayRole =
    userData?.role || "user";

  const initial = getInitial(displayName);

  useEffect(() => {
    const onClickOutside = (
      event: MouseEvent
    ) => {
      if (
        profileRef.current &&
        !profileRef.current.contains(
          event.target as Node
        )
      ) {
        setProfileOpen(false);
      }
    };

    document.addEventListener(
      "mousedown",
      onClickOutside
    );

    return () => {
      document.removeEventListener(
        "mousedown",
        onClickOutside
      );
    };
  }, []);

  useEffect(() => {
    setOpen(false);
    setProfileOpen(false);
  }, [pathname]);

  async function handleLogout() {
    try {
      setLoggingOut(true);
      setProfileOpen(false);
      setOpen(false);

      await logout();

      router.replace("/sign-in");
      router.refresh();
    } catch (error) {
      console.error(
        "Logout failed:",
        error
      );
    } finally {
      setLoggingOut(false);
    }
  }

  if (hideNavbar) {
    return null;
  }

  return (
    <header className="sticky top-0 z-50 h-16 w-full border-b border-slate-200 bg-white/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        {/* Brand */}
        <Link
          href="/"
          className="group inline-flex shrink-0 items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
          onClick={() => setOpen(false)}
        >
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-emerald-700 text-white shadow-sm">
            <Leaf
              className="h-[18px] w-[18px]"
              strokeWidth={2.25}
            />
          </span>

          <div className="leading-tight">
            <div className="text-sm font-bold tracking-tight text-slate-900">
              CinnaAI
            </div>

            <div className="hidden text-[11px] font-medium text-slate-500 sm:block">
              Smart Monitoring
            </div>
          </div>
        </Link>

        {/* Desktop primary nav */}
        <nav
          className="hidden items-center gap-0.5 xl:flex"
          aria-label="Primary navigation"
        >
          {items.map((item) => {
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40",
                  item.active
                    ? "bg-emerald-50 text-emerald-700"
                    : "text-slate-600 hover:bg-slate-100 hover:text-emerald-700",
                ].join(" ")}
              >
                <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />

                {item.label}
              </Link>
            );
          })}

          {userData?.role ===
            "admin" && (
            <Link
              href="/admin"
              className={[
                "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40",
                isActivePath(
                  pathname,
                  "/admin"
                )
                  ? "bg-emerald-50 text-emerald-700"
                  : "text-slate-600 hover:bg-slate-100 hover:text-emerald-700",
              ].join(" ")}
            >
              <Users className="h-3.5 w-3.5 shrink-0 opacity-70" />

              Admin
            </Link>
          )}
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-2">
          {loading && (
            <div className="hidden items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 md:flex">
              <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />

              <span className="text-xs font-medium text-slate-500">
                Loading
              </span>
            </div>
          )}

          {!loading &&
            !firebaseUser && (
              <Link
                href="/sign-in"
                className="hidden items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 md:inline-flex"
              >
                <LogIn className="h-4 w-4" />

                Sign in
              </Link>
            )}

          {!loading &&
            firebaseUser &&
            userData && (
              <div
                className="relative hidden md:block"
                ref={profileRef}
              >
                <button
                  type="button"
                  onClick={() =>
                    setProfileOpen(
                      (value) => !value
                    )
                  }
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
                  aria-expanded={
                    profileOpen
                  }
                  aria-haspopup="menu"
                >
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-emerald-700 text-xs font-semibold text-white">
                    {initial}
                  </span>

                  <span className="hidden max-w-[130px] truncate lg:inline">
                    {displayRole ===
                    "admin"
                      ? "Admin"
                      : displayName}
                  </span>

                  <ChevronDown
                    className={`h-3.5 w-3.5 text-slate-400 transition ${
                      profileOpen
                        ? "rotate-180"
                        : ""
                    }`}
                  />
                </button>

                {profileOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 mt-2 w-64 overflow-hidden rounded-xl border border-slate-200/60 bg-white py-1 shadow-lg"
                  >
                    <div className="border-b border-slate-100 px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-700">
                          {initial}
                        </span>

                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900">
                            {displayName}
                          </p>

                          <p className="truncate text-xs text-slate-500">
                            {displayEmail}
                          </p>
                        </div>
                      </div>

                      <span className="mt-3 inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold capitalize text-emerald-700">
                        {displayRole}
                      </span>
                    </div>

                    <div className="py-1">
                      <Link
                        href="/profile"
                        className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
                        role="menuitem"
                      >
                        <User className="h-4 w-4" />

                        Profile
                      </Link>

                      <Link
                        href="/settings"
                        className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
                        role="menuitem"
                      >
                        <Settings className="h-4 w-4" />

                        Settings
                      </Link>

                      {displayRole ===
                        "admin" && (
                        <Link
                          href="/admin"
                          className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
                          role="menuitem"
                        >
                          <Users className="h-4 w-4" />

                          Admin Dashboard
                        </Link>
                      )}
                    </div>

                    <div className="border-t border-slate-100 py-1">
                      <button
                        type="button"
                        onClick={
                          handleLogout
                        }
                        disabled={
                          loggingOut
                        }
                        className="flex w-full items-center gap-2 px-4 py-2.5 text-sm font-medium text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                        role="menuitem"
                      >
                        {loggingOut ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <LogOut className="h-4 w-4" />
                        )}

                        {loggingOut
                          ? "Signing out..."
                          : "Sign out"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

          {/* Mobile menu toggle */}
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white p-2 text-slate-700 shadow-sm transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 xl:hidden"
            aria-label={
              open
                ? "Close menu"
                : "Open menu"
            }
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() =>
              setOpen(
                (value) => !value
              )
            }
          >
            {open ? (
              <X className="h-5 w-5" />
            ) : (
              <Menu className="h-5 w-5" />
            )}
          </button>
        </div>
      </div>

      {/* Mobile navigation */}
      <div
        id="mobile-nav"
        className={[
          "border-t border-slate-200 bg-white/95 backdrop-blur-md xl:hidden",
          open
            ? "block"
            : "hidden",
        ].join(" ")}
      >
        <div className="mx-auto max-w-7xl space-y-1 px-4 py-3 sm:px-6">
          {items.map((item) => {
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() =>
                  setOpen(false)
                }
                className={[
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  item.active
                    ? "bg-emerald-50 text-emerald-700"
                    : "text-slate-700 hover:bg-slate-100 hover:text-emerald-700",
                ].join(" ")}
              >
                <Icon className="h-4 w-4 opacity-70" />

                {item.label}
              </Link>
            );
          })}

          {userData?.role ===
            "admin" && (
            <Link
              href="/admin"
              onClick={() =>
                setOpen(false)
              }
              className={[
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                isActivePath(
                  pathname,
                  "/admin"
                )
                  ? "bg-emerald-50 text-emerald-700"
                  : "text-slate-700 hover:bg-slate-100 hover:text-emerald-700",
              ].join(" ")}
            >
              <Users className="h-4 w-4 opacity-70" />

              Admin Dashboard
            </Link>
          )}

          <div className="mt-2 border-t border-slate-100 pt-2">
            {loading ? (
              <div className="flex items-center gap-3 rounded-lg px-3 py-3">
                <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />

                <p className="text-sm font-medium text-slate-500">
                  Loading account...
                </p>
              </div>
            ) : firebaseUser &&
              userData ? (
              <>
                <div className="flex items-center gap-3 rounded-lg px-3 py-2.5">
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-emerald-700 text-xs font-semibold text-white">
                    {initial}
                  </span>

                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {displayName}
                    </p>

                    <p className="truncate text-xs text-slate-500">
                      {displayEmail}
                    </p>
                  </div>
                </div>

                <Link
                  href="/profile"
                  onClick={() =>
                    setOpen(false)
                  }
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                >
                  <User className="h-4 w-4" />

                  Profile
                </Link>

                <Link
                  href="/settings"
                  onClick={() =>
                    setOpen(false)
                  }
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                >
                  <Settings className="h-4 w-4" />

                  Settings
                </Link>

                <button
                  type="button"
                  onClick={
                    handleLogout
                  }
                  disabled={
                    loggingOut
                  }
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loggingOut ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <LogOut className="h-4 w-4" />
                  )}

                  {loggingOut
                    ? "Signing out..."
                    : "Sign out"}
                </button>
              </>
            ) : (
              <Link
                href="/sign-in"
                onClick={() =>
                  setOpen(false)
                }
                className="flex items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800"
              >
                <LogIn className="h-4 w-4" />

                Sign in
              </Link>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}