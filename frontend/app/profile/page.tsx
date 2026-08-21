"use client";

import {
  FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  doc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  FileText,
  FlaskConical,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Save,
  ShieldCheck,
  User,
  Users,
} from "lucide-react";

import ProtectedRoute from "@/app/components/ProtectedRoute";
import { useAuth } from "@/app/context/AuthContext";
import { db } from "@/app/lib/firebase";

type ProfileForm = {
  fullName: string;
  username: string;
  phone: string;
  location: string;
  beneficiaryType: string;
  researchInterests: string;
  bio: string;
};

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

    const parsedDate = new Date(
      value as string | number | Date
    );

    if (
      Number.isNaN(parsedDate.getTime())
    ) {
      return "Not available";
    }

    return parsedDate.toLocaleDateString(
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

function createUsername(
  fullName: string,
  email: string
) {
  const nameUsername = fullName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");

  if (nameUsername) {
    return nameUsername;
  }

  return (
    email
      .split("@")[0]
      ?.toLowerCase()
      .replace(/[^a-z0-9._-]/g, "") ||
    "user"
  );
}

export default function ProfilePage() {
  const {
    firebaseUser,
    userData,
    loading: authLoading,
  } = useAuth();

  const [form, setForm] =
    useState<ProfileForm>({
      fullName: "",
      username: "",
      phone: "",
      location: "",
      beneficiaryType: "",
      researchInterests: "",
      bio: "",
    });

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState("");

  const [success, setSuccess] =
    useState("");

  useEffect(() => {
    if (!firebaseUser || !userData) {
      return;
    }

    const fullName =
      userData.fullName ||
      firebaseUser.displayName ||
      "";

    const email =
      userData.email ||
      firebaseUser.email ||
      "";

    setForm({
      fullName,
      username:
        userData.username ||
        createUsername(fullName, email),
      phone: userData.phone || "",
      location: userData.location || "",
      beneficiaryType:
        userData.beneficiaryType || "",
      researchInterests:
        userData.researchInterests || "",
      bio: userData.bio || "",
    });
  }, [firebaseUser, userData]);

  const displayEmail =
    userData?.email ||
    firebaseUser?.email ||
    "";

  const displayRole =
    userData?.role || "user";

  const joinedDate = useMemo(
    () =>
      formatJoinedDate(
        userData?.joinedDate ||
          userData?.createdAt ||
          firebaseUser?.metadata
            .creationTime
      ),
    [
      userData?.joinedDate,
      userData?.createdAt,
      firebaseUser?.metadata
        .creationTime,
    ]
  );

  const initial =
    form.fullName
      .trim()
      .charAt(0)
      .toUpperCase() || "U";

  function updateField(
    field: keyof ProfileForm,
    value: string
  ) {
    setForm((previous) => ({
      ...previous,
      [field]: value,
    }));

    if (error) {
      setError("");
    }

    if (success) {
      setSuccess("");
    }
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setError("");
    setSuccess("");

    if (!firebaseUser) {
      setError(
        "You must be signed in to update your profile."
      );
      return;
    }

    const cleanedFullName =
      form.fullName.trim();

    const cleanedUsername =
      form.username
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ".");

    if (!cleanedFullName) {
      setError(
        "Please enter your full name."
      );
      return;
    }

    if (!cleanedUsername) {
      setError(
        "Please enter a username."
      );
      return;
    }

    if (
      cleanedUsername.length < 3
    ) {
      setError(
        "Username must contain at least 3 characters."
      );
      return;
    }

    if (
      !/^[a-z0-9._-]+$/.test(
        cleanedUsername
      )
    ) {
      setError(
        "Username may only contain lowercase letters, numbers, dots, underscores and hyphens."
      );
      return;
    }

    try {
      setSaving(true);

      const userReference = doc(
        db,
        "users",
        firebaseUser.uid
      );

      await updateDoc(userReference, {
        fullName: cleanedFullName,
        username: cleanedUsername,
        phone: form.phone.trim(),
        location:
          form.location.trim(),
        beneficiaryType:
          form.beneficiaryType,
        researchInterests:
          form.researchInterests.trim(),
        bio: form.bio.trim(),
        updatedAt: serverTimestamp(),
      });

      setForm((previous) => ({
        ...previous,
        fullName: cleanedFullName,
        username: cleanedUsername,
        phone: previous.phone.trim(),
        location:
          previous.location.trim(),
        researchInterests:
          previous.researchInterests.trim(),
        bio: previous.bio.trim(),
      }));

      setSuccess(
        "Your profile was updated successfully."
      );
    } catch (updateError) {
      console.error(
        "Profile update failed:",
        updateError
      );

      setError(
        updateError instanceof Error
          ? updateError.message
          : "Unable to update your profile. Please try again."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <ProtectedRoute>
      {authLoading ? (
        <main className="grid min-h-[calc(100vh-4rem)] place-items-center bg-slate-50 px-4">
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <Loader2 className="h-5 w-5 animate-spin text-emerald-700" />

            <p className="text-sm font-medium text-slate-600">
              Loading your profile...
            </p>
          </div>
        </main>
      ) : (
        <main className="min-h-[calc(100vh-4rem)] bg-slate-50 py-8">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="mb-8">
              <p className="text-sm font-semibold text-emerald-700">
                Account management
              </p>

              <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
                My Profile
              </h1>

              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                View and update your
                personal information,
                beneficiary details and
                research interests.
              </p>
            </div>

            <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
              <aside className="space-y-6">
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex flex-col items-center text-center">
                    <span className="grid h-24 w-24 place-items-center rounded-full bg-emerald-700 text-3xl font-bold text-white shadow-sm">
                      {initial}
                    </span>

                    <h2 className="mt-5 text-xl font-bold text-slate-900">
                      {form.fullName ||
                        "CinnaAI User"}
                    </h2>

                    <p className="mt-1 text-sm text-slate-500">
                      {displayEmail}
                    </p>

                    <span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold capitalize text-emerald-700">
                      <ShieldCheck className="h-3.5 w-3.5" />

                      {displayRole}
                    </span>
                  </div>

                  <div className="mt-6 space-y-4 border-t border-slate-100 pt-6">
                    <div className="flex items-start gap-3">
                      <Mail className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />

                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                          Email
                        </p>

                        <p className="mt-1 break-all text-sm font-medium text-slate-700">
                          {displayEmail ||
                            "Not available"}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-3">
                      <Users className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />

                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                          Beneficiary
                        </p>

                        <p className="mt-1 text-sm font-medium capitalize text-slate-700">
                          {form.beneficiaryType ||
                            "Not selected"}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-3">
                      <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />

                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                          Joined
                        </p>

                        <p className="mt-1 text-sm font-medium text-slate-700">
                          {joinedDate}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
                  <div className="flex gap-3">
                    <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />

                    <div>
                      <h3 className="text-sm font-semibold text-emerald-900">
                        Secure profile
                      </h3>

                      <p className="mt-1 text-xs leading-5 text-emerald-700">
                        Your profile is linked
                        to your authenticated
                        Firebase account.
                      </p>
                    </div>
                  </div>
                </div>
              </aside>

              <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
                <div className="border-b border-slate-100 pb-6">
                  <h2 className="text-xl font-bold text-slate-900">
                    Personal information
                  </h2>

                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    Update the information used
                    across your CinnaAI account.
                  </p>
                </div>

                {error && (
                  <div
                    role="alert"
                    className="mt-6 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700"
                  >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />

                    <p>{error}</p>
                  </div>
                )}

                {success && (
                  <div
                    role="status"
                    className="mt-6 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700"
                  >
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />

                    <p>{success}</p>
                  </div>
                )}

                <form
                  onSubmit={handleSubmit}
                  className="mt-6"
                >
                  <div className="grid gap-5 sm:grid-cols-2">
                    <div>
                      <label
                        htmlFor="fullName"
                        className="mb-2 block text-sm font-semibold text-slate-700"
                      >
                        Full name
                      </label>

                      <div className="relative">
                        <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />

                        <input
                          id="fullName"
                          type="text"
                          autoComplete="name"
                          value={
                            form.fullName
                          }
                          onChange={(event) =>
                            updateField(
                              "fullName",
                              event.target.value
                            )
                          }
                          disabled={saving}
                          placeholder="Enter your full name"
                          className="h-12 w-full rounded-xl border border-slate-300 bg-white pl-10 pr-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:ring-4 focus:ring-emerald-500/10 disabled:cursor-not-allowed disabled:bg-slate-100"
                        />
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="username"
                        className="mb-2 block text-sm font-semibold text-slate-700"
                      >
                        Username
                      </label>

                      <div className="relative">
                        <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />

                        <input
                          id="username"
                          type="text"
                          autoComplete="username"
                          value={
                            form.username
                          }
                          onChange={(event) =>
                            updateField(
                              "username",
                              event.target.value
                            )
                          }
                          disabled={saving}
                          placeholder="Enter your username"
                          className="h-12 w-full rounded-xl border border-slate-300 bg-white pl-10 pr-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:ring-4 focus:ring-emerald-500/10 disabled:cursor-not-allowed disabled:bg-slate-100"
                        />
                      </div>
                    </div>

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
                          type="email"
                          value={displayEmail}
                          readOnly
                          className="h-12 w-full cursor-not-allowed rounded-xl border border-slate-200 bg-slate-100 pl-10 pr-4 text-sm text-slate-500 outline-none"
                        />
                      </div>

                      <p className="mt-1.5 text-xs text-slate-400">
                        Email cannot be changed
                        from the profile page.
                      </p>
                    </div>

                    <div>
                      <label
                        htmlFor="phone"
                        className="mb-2 block text-sm font-semibold text-slate-700"
                      >
                        Phone number
                      </label>

                      <div className="relative">
                        <Phone className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />

                        <input
                          id="phone"
                          type="tel"
                          autoComplete="tel"
                          value={form.phone}
                          onChange={(event) =>
                            updateField(
                              "phone",
                              event.target.value
                            )
                          }
                          disabled={saving}
                          placeholder="Enter your phone number"
                          className="h-12 w-full rounded-xl border border-slate-300 bg-white pl-10 pr-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:ring-4 focus:ring-emerald-500/10 disabled:cursor-not-allowed disabled:bg-slate-100"
                        />
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="role"
                        className="mb-2 block text-sm font-semibold text-slate-700"
                      >
                        Account role
                      </label>

                      <div className="relative">
                        <ShieldCheck className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />

                        <input
                          id="role"
                          type="text"
                          value={displayRole}
                          readOnly
                          className="h-12 w-full cursor-not-allowed rounded-xl border border-slate-200 bg-slate-100 pl-10 pr-4 text-sm capitalize text-slate-500 outline-none"
                        />
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="beneficiaryType"
                        className="mb-2 block text-sm font-semibold text-slate-700"
                      >
                        Beneficiary type
                      </label>

                      <div className="relative">
                        <Users className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />

                        <select
                          id="beneficiaryType"
                          value={
                            form.beneficiaryType
                          }
                          onChange={(event) =>
                            updateField(
                              "beneficiaryType",
                              event.target.value
                            )
                          }
                          disabled={saving}
                          className="h-12 w-full appearance-none rounded-xl border border-slate-300 bg-white pl-10 pr-4 text-sm text-slate-900 outline-none transition focus:border-emerald-600 focus:ring-4 focus:ring-emerald-500/10 disabled:cursor-not-allowed disabled:bg-slate-100"
                        >
                          <option value="">
                            Select beneficiary type
                          </option>

                          <option value="farmer">
                            Farmer
                          </option>

                          <option value="researcher">
                            Researcher
                          </option>

                          <option value="plantation-manager">
                            Plantation Manager
                          </option>

                          <option value="export-company">
                            Cinnamon Export Company
                          </option>

                          <option value="agritech-company">
                            Agricultural Technology Company
                          </option>

                          <option value="government-sector">
                            Government Agriculture Sector
                          </option>
                        </select>
                      </div>
                    </div>

                    <div className="sm:col-span-2">
                      <label
                        htmlFor="location"
                        className="mb-2 block text-sm font-semibold text-slate-700"
                      >
                        Location
                      </label>

                      <div className="relative">
                        <MapPin className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />

                        <input
                          id="location"
                          type="text"
                          autoComplete="address-level2"
                          value={
                            form.location
                          }
                          onChange={(event) =>
                            updateField(
                              "location",
                              event.target.value
                            )
                          }
                          disabled={saving}
                          placeholder="Enter your city or district"
                          className="h-12 w-full rounded-xl border border-slate-300 bg-white pl-10 pr-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:ring-4 focus:ring-emerald-500/10 disabled:cursor-not-allowed disabled:bg-slate-100"
                        />
                      </div>
                    </div>

                    <div className="sm:col-span-2">
                      <label
                        htmlFor="researchInterests"
                        className="mb-2 block text-sm font-semibold text-slate-700"
                      >
                        Research interests
                      </label>

                      <div className="relative">
                        <FlaskConical className="pointer-events-none absolute left-3.5 top-4 h-4 w-4 text-slate-400" />

                        <textarea
                          id="researchInterests"
                          rows={4}
                          value={
                            form.researchInterests
                          }
                          onChange={(event) =>
                            updateField(
                              "researchInterests",
                              event.target.value
                            )
                          }
                          disabled={saving}
                          placeholder="Describe your cinnamon, agriculture, AI or IoT research interests"
                          className="w-full resize-none rounded-xl border border-slate-300 bg-white py-3 pl-10 pr-4 text-sm leading-6 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:ring-4 focus:ring-emerald-500/10 disabled:cursor-not-allowed disabled:bg-slate-100"
                        />
                      </div>
                    </div>

                    <div className="sm:col-span-2">
                      <label
                        htmlFor="bio"
                        className="mb-2 block text-sm font-semibold text-slate-700"
                      >
                        Bio
                      </label>

                      <div className="relative">
                        <FileText className="pointer-events-none absolute left-3.5 top-4 h-4 w-4 text-slate-400" />

                        <textarea
                          id="bio"
                          rows={5}
                          maxLength={500}
                          value={form.bio}
                          onChange={(event) =>
                            updateField(
                              "bio",
                              event.target.value
                            )
                          }
                          disabled={saving}
                          placeholder="Write a short description about yourself"
                          className="w-full resize-none rounded-xl border border-slate-300 bg-white py-3 pl-10 pr-4 text-sm leading-6 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:ring-4 focus:ring-emerald-500/10 disabled:cursor-not-allowed disabled:bg-slate-100"
                        />
                      </div>

                      <p className="mt-1.5 text-right text-xs text-slate-400">
                        {form.bio.length}/500
                      </p>
                    </div>
                  </div>

                  <div className="mt-8 flex justify-end border-t border-slate-100 pt-6">
                    <button
                      type="submit"
                      disabled={saving}
                      className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-6 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {saving ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />

                          Saving profile...
                        </>
                      ) : (
                        <>
                          <Save className="h-4 w-4" />

                          Save changes
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </section>
            </div>
          </div>
        </main>
      )}
    </ProtectedRoute>
  );
}