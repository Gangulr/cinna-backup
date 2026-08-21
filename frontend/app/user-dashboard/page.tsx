"use client";

import {
  useMemo,
} from "react";

import Link from "next/link";

import {
  Activity,
  ArrowRight,
  BarChart3,
  Bell,
  CalendarDays,
  Camera,
  CheckCircle2,
  CircleUserRound,
  Clock3,
  Database,
  FlaskConical,
  Gauge,
  History,
  Leaf,
  Loader2,
  MapPin,
  Microscope,
  Settings,
  ShieldCheck,
  Sprout,
  Thermometer,
  User,
  Users,
} from "lucide-react";

import ProtectedRoute from "@/app/components/ProtectedRoute";
import { useAuth } from "@/app/context/AuthContext";

type UserProfileData = {
  fullName?: string;
  username?: string;
  email?: string;
  phone?: string;
  role?: string;
  beneficiaryType?: string;
  location?: string;
  researchInterests?: string;
  bio?: string;
  joinedDate?: unknown;
  createdAt?: unknown;
  status?: string;
  notificationSettings?: {
    emailNotifications?: boolean;
    diseaseAlerts?: boolean;
    growthUpdates?: boolean;
    harvestAlerts?: boolean;
    sensorAlerts?: boolean;
  };
};

type QuickAction = {
  title: string;
  description: string;
  href: string;
  icon: React.ComponentType<{
    className?: string;
  }>;
};

type MonitoringModule = {
  title: string;
  description: string;
  href: string;
  icon: React.ComponentType<{
    className?: string;
  }>;
  label: string;
};

const quickActions: QuickAction[] = [
  {
    title: "IoT Monitoring",
    description:
      "View the latest temperature, humidity and soil moisture readings.",
    href: "/iot-monitoring",
    icon: Thermometer,
  },
  {
    title: "Growth Prediction",
    description:
      "Predict cinnamon plant growth using environmental and plant data.",
    href: "/growthprediction",
    icon: Sprout,
  },
  {
    title: "Disease Prediction",
    description:
      "Upload cinnamon plant images and identify possible diseases.",
    href: "/diseaseprediction",
    icon: Microscope,
  },
  {
    title: "Harvest Readiness",
    description:
      "Evaluate whether a cinnamon plant may be ready for harvesting.",
    href: "/harvest-readiness",
    icon: CheckCircle2,
  },
];

const monitoringModules: MonitoringModule[] = [
  {
    title: "Main Dashboard",
    description:
      "View the complete CinnaAI system overview and monitoring statistics.",
    href: "/dashboard",
    icon: Gauge,
    label: "Overview",
  },
  {
    title: "IoT Monitoring",
    description:
      "Monitor live temperature, humidity and soil moisture sensor data.",
    href: "/iot-monitoring",
    icon: Activity,
    label: "Sensors",
  },
  {
    title: "Growth Prediction",
    description:
      "Use machine learning to estimate cinnamon plant growth performance.",
    href: "/growthprediction",
    icon: BarChart3,
    label: "AI Prediction",
  },
  {
    title: "Disease Detection",
    description:
      "Analyze plant images and detect possible cinnamon diseases.",
    href: "/diseaseprediction",
    icon: FlaskConical,
    label: "Computer Vision",
  },
  {
    title: "Harvest Readiness",
    description:
      "Check growth conditions and determine the expected harvest status.",
    href: "/harvest-readiness",
    icon: Leaf,
    label: "Harvest",
  },
  {
    title: "Vision",
    description:
      "Access the image-based AI vision and plant analysis module.",
    href: "/vision",
    icon: Camera,
    label: "Image Analysis",
  },
  {
    title: "History",
    description:
      "Review previous growth predictions and disease detection records.",
    href: "/history",
    icon: History,
    label: "Records",
  },
  {
    title: "Settings",
    description:
      "Manage notification preferences, account security and password.",
    href: "/settings",
    icon: Settings,
    label: "Account",
  },
];

function formatJoinedDate(value: unknown) {
  if (!value) {
    return "Not available";
  }

  try {
    if (
      typeof value === "object" &&
      value !== null &&
      "toDate" in value &&
      typeof value.toDate === "function"
    ) {
      return value.toDate().toLocaleDateString(
        "en-US",
        {
          year: "numeric",
          month: "long",
          day: "numeric",
        }
      );
    }

    if (
      typeof value === "object" &&
      value !== null &&
      "seconds" in value &&
      typeof value.seconds === "number"
    ) {
      return new Date(
        value.seconds * 1000
      ).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    }

    const date = new Date(
      value as string | number | Date
    );

    if (Number.isNaN(date.getTime())) {
      return "Not available";
    }

    return date.toLocaleDateString(
      "en-US",
      {
        year: "numeric",
        month: "long",
        day: "numeric",
      }
    );
  } catch {
    return "Not available";
  }
}

function formatBeneficiaryType(
  value?: string
) {
  if (!value) {
    return "Not selected";
  }

  return value
    .split("-")
    .map(
      (word) =>
        word.charAt(0).toUpperCase() +
        word.slice(1)
    )
    .join(" ");
}

function calculateProfileCompletion(
  user: UserProfileData,
  email: string
) {
  const values = [
    user.fullName,
    user.username,
    email,
    user.phone,
    user.beneficiaryType,
    user.location,
    user.researchInterests,
    user.bio,
  ];

  const completedFields =
    values.filter(
      (value) =>
        typeof value === "string" &&
        value.trim().length > 0
    ).length;

  return Math.round(
    (completedFields / values.length) *
      100
  );
}

export default function UserDashboardPage() {
  const {
    firebaseUser,
    userData,
    loading: authLoading,
  } = useAuth();

  const profileData =
    (userData || {}) as UserProfileData;

  const displayName =
    profileData.fullName ||
    firebaseUser?.displayName ||
    "CinnaAI User";

  const displayEmail =
    profileData.email ||
    firebaseUser?.email ||
    "Email not available";

  const displayRole =
    profileData.role || "user";

  const displayBeneficiary =
    formatBeneficiaryType(
      profileData.beneficiaryType
    );

  const displayLocation =
    profileData.location ||
    "Location not added";

  const joinedDate = useMemo(
    () =>
      formatJoinedDate(
        profileData.joinedDate ||
          profileData.createdAt ||
          firebaseUser?.metadata
            .creationTime
      ),
    [
      profileData.joinedDate,
      profileData.createdAt,
      firebaseUser?.metadata
        .creationTime,
    ]
  );

  const profileCompletion = useMemo(
    () =>
      calculateProfileCompletion(
        profileData,
        displayEmail ===
          "Email not available"
          ? ""
          : displayEmail
      ),
    [profileData, displayEmail]
  );

  const enabledNotifications =
    useMemo(() => {
      const settings =
        profileData.notificationSettings;

      if (!settings) {
        return 5;
      }

      return Object.values(
        settings
      ).filter(Boolean).length;
    }, [
      profileData.notificationSettings,
    ]);

  const initial =
    displayName
      .trim()
      .charAt(0)
      .toUpperCase() || "U";

  return (
    <ProtectedRoute>
      {authLoading ? (
        <main className="grid min-h-[calc(100vh-4rem)] place-items-center bg-slate-50 px-4">
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <Loader2 className="h-5 w-5 animate-spin text-emerald-700" />

            <p className="text-sm font-medium text-slate-600">
              Loading your dashboard...
            </p>
          </div>
        </main>
      ) : (
        <main className="min-h-[calc(100vh-4rem)] bg-slate-50 py-8">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <section className="relative overflow-hidden rounded-3xl bg-emerald-800 px-6 py-8 shadow-sm sm:px-8 lg:px-10 lg:py-10">
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/5" />

                <div className="absolute -bottom-28 left-1/3 h-72 w-72 rounded-full bg-emerald-400/10 blur-3xl" />

                <div className="absolute bottom-0 right-12 hidden h-48 w-48 rounded-full border border-white/10 lg:block" />
              </div>

              <div className="relative z-10 flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
                <div className="max-w-2xl">
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold text-emerald-50">
                    <ShieldCheck className="h-3.5 w-3.5" />

                    Secure user workspace
                  </div>

                  <h1 className="mt-5 text-3xl font-bold tracking-tight text-white sm:text-4xl">
                    Welcome back,{" "}
                    {displayName}
                  </h1>

                  <p className="mt-3 max-w-xl text-sm leading-6 text-emerald-100 sm:text-base">
                    Monitor cinnamon plant
                    conditions, access AI
                    predictions and manage your
                    research activities from
                    one place.
                  </p>

                  <div className="mt-6 flex flex-wrap gap-3">
                    <Link
                      href="/dashboard"
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-white px-5 text-sm font-semibold text-emerald-800 shadow-sm transition hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/20"
                    >
                      Open main dashboard

                      <ArrowRight className="h-4 w-4" />
                    </Link>

                    <Link
                      href="/profile"
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 px-5 text-sm font-semibold text-white transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/20"
                    >
                      <User className="h-4 w-4" />

                      View profile
                    </Link>
                  </div>
                </div>

                <div className="w-full max-w-sm rounded-2xl border border-white/15 bg-white/10 p-5 backdrop-blur-sm">
                  <div className="flex items-center gap-4">
                    <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-white text-2xl font-bold text-emerald-800 shadow-sm">
                      {initial}
                    </span>

                    <div className="min-w-0">
                      <p className="truncate text-lg font-bold text-white">
                        {displayName}
                      </p>

                      <p className="mt-1 truncate text-sm text-emerald-100">
                        {displayEmail}
                      </p>

                      <span className="mt-2 inline-flex rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold capitalize text-white">
                        {displayRole}
                      </span>
                    </div>
                  </div>

                  <div className="mt-5 border-t border-white/10 pt-5">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-emerald-100">
                        Profile completion
                      </p>

                      <p className="text-xs font-bold text-white">
                        {profileCompletion}%
                      </p>
                    </div>

                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/15">
                      <div
                        className="h-full rounded-full bg-white transition-all duration-500"
                        style={{
                          width: `${profileCompletion}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryCard
                icon={CircleUserRound}
                label="Account status"
                value={
                  profileData.status
                    ? profileData.status
                    : "Active"
                }
                description="Authenticated account"
              />

              <SummaryCard
                icon={Users}
                label="Beneficiary type"
                value={displayBeneficiary}
                description="Registered user category"
              />

              <SummaryCard
                icon={Bell}
                label="Enabled alerts"
                value={`${enabledNotifications}/5`}
                description="Notification preferences"
              />

              <SummaryCard
                icon={CalendarDays}
                label="Member since"
                value={joinedDate}
                description="Account creation date"
              />
            </section>

            <section className="mt-8">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-emerald-700">
                    Quick access
                  </p>

                  <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
                    Start monitoring
                  </h2>

                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    Open the main AI and IoT
                    tools used for cinnamon
                    monitoring and analysis.
                  </p>
                </div>

                <Link
                  href="/history"
                  className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-700 transition hover:text-emerald-800"
                >
                  View prediction history

                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {quickActions.map(
                  (action) => {
                    const Icon =
                      action.icon;

                    return (
                      <Link
                        key={action.href}
                        href={action.href}
                        className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-md focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-500/10"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <span className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-100 text-emerald-700">
                            <Icon className="h-5 w-5" />
                          </span>

                          <ArrowRight className="h-4 w-4 text-slate-300 transition group-hover:translate-x-1 group-hover:text-emerald-700" />
                        </div>

                        <h3 className="mt-5 text-base font-bold text-slate-900">
                          {action.title}
                        </h3>

                        <p className="mt-2 text-sm leading-6 text-slate-500">
                          {action.description}
                        </p>
                      </Link>
                    );
                  }
                )}
              </div>
            </section>

            <section className="mt-8 grid gap-6 xl:grid-cols-[1fr_340px]">
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
                <div>
                  <p className="text-sm font-semibold text-emerald-700">
                    CinnaAI modules
                  </p>

                  <h2 className="mt-1 text-xl font-bold text-slate-900">
                    Monitoring and prediction
                    tools
                  </h2>

                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    Access all available
                    modules from your personal
                    workspace.
                  </p>
                </div>

                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  {monitoringModules.map(
                    (module) => {
                      const Icon =
                        module.icon;

                      return (
                        <Link
                          key={module.href}
                          href={module.href}
                          className="group flex items-start gap-4 rounded-xl border border-slate-200 p-4 transition hover:border-emerald-200 hover:bg-emerald-50/40 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-500/10"
                        >
                          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600 transition group-hover:bg-emerald-100 group-hover:text-emerald-700">
                            <Icon className="h-5 w-5" />
                          </span>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-3">
                              <h3 className="text-sm font-bold text-slate-900">
                                {module.title}
                              </h3>

                              <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-1 group-hover:text-emerald-700" />
                            </div>

                            <p className="mt-1.5 text-xs leading-5 text-slate-500">
                              {
                                module.description
                              }
                            </p>

                            <span className="mt-3 inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                              {module.label}
                            </span>
                          </div>
                        </Link>
                      );
                    }
                  )}
                </div>
              </div>

              <aside className="space-y-6">
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-emerald-700">
                        Profile overview
                      </p>

                      <h2 className="mt-1 text-lg font-bold text-slate-900">
                        Account information
                      </h2>
                    </div>

                    <CircleUserRound className="h-6 w-6 text-slate-400" />
                  </div>

                  <div className="mt-6 space-y-5">
                    <ProfileItem
                      icon={User}
                      label="Full name"
                      value={displayName}
                    />

                    <ProfileItem
                      icon={Users}
                      label="Beneficiary"
                      value={
                        displayBeneficiary
                      }
                    />

                    <ProfileItem
                      icon={MapPin}
                      label="Location"
                      value={displayLocation}
                    />

                    <ProfileItem
                      icon={Clock3}
                      label="Joined"
                      value={joinedDate}
                    />
                  </div>

                  <Link
                    href="/profile"
                    className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-500/10"
                  >
                    Update profile

                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>

                {profileCompletion < 100 ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
                    <div className="flex gap-3">
                      <CircleUserRound className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />

                      <div>
                        <h3 className="text-sm font-bold text-amber-900">
                          Complete your profile
                        </h3>

                        <p className="mt-1 text-xs leading-5 text-amber-700">
                          Your profile is{" "}
                          {profileCompletion}%
                          complete. Add the
                          remaining information
                          to improve your
                          account details.
                        </p>

                        <Link
                          href="/profile"
                          className="mt-4 inline-flex items-center gap-2 text-xs font-bold text-amber-800 transition hover:text-amber-900"
                        >
                          Complete profile

                          <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
                    <div className="flex gap-3">
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />

                      <div>
                        <h3 className="text-sm font-bold text-emerald-900">
                          Profile complete
                        </h3>

                        <p className="mt-1 text-xs leading-5 text-emerald-700">
                          Your account profile
                          information has been
                          completed successfully.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="rounded-2xl border border-slate-200 bg-slate-900 p-5 text-white">
                  <div className="flex gap-3">
                    <Database className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />

                    <div>
                      <h3 className="text-sm font-bold">
                        Your records
                      </h3>

                      <p className="mt-1 text-xs leading-5 text-slate-300">
                        Growth and disease
                        prediction records can
                        be reviewed from the
                        history page.
                      </p>

                      <Link
                        href="/history"
                        className="mt-4 inline-flex items-center gap-2 text-xs font-bold text-emerald-400 transition hover:text-emerald-300"
                      >
                        Open history

                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </div>
                  </div>
                </div>
              </aside>
            </section>
          </div>
        </main>
      )}
    </ProtectedRoute>
  );
}

type SummaryCardProps = {
  icon: React.ComponentType<{
    className?: string;
  }>;
  label: string;
  value: string;
  description: string;
};

function SummaryCard({
  icon: Icon,
  label,
  value,
  description,
}: SummaryCardProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-700">
          <Icon className="h-5 w-5" />
        </span>

        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            {label}
          </p>

          <p className="mt-1 truncate text-base font-bold capitalize text-slate-900">
            {value}
          </p>

          <p className="mt-1 text-xs text-slate-500">
            {description}
          </p>
        </div>
      </div>
    </div>
  );
}

type ProfileItemProps = {
  icon: React.ComponentType<{
    className?: string;
  }>;
  label: string;
  value: string;
};

function ProfileItem({
  icon: Icon,
  label,
  value,
}: ProfileItemProps) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500">
        <Icon className="h-4 w-4" />
      </span>

      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          {label}
        </p>

        <p className="mt-1 break-words text-sm font-medium text-slate-700">
          {value}
        </p>
      </div>
    </div>
  );
}