"use client";

import {
  FormEvent,
  useEffect,
  useState,
} from "react";

import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  updatePassword,
} from "firebase/auth";

import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

import {
  AlertCircle,
  Bell,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Leaf,
  Loader2,
  LockKeyhole,
  Mail,
  Save,
  ShieldCheck,
  Smartphone,
} from "lucide-react";

import ProtectedRoute from "@/app/components/ProtectedRoute";
import { useAuth } from "@/app/context/AuthContext";
import {
  auth,
  db,
} from "@/app/lib/firebase";

type NotificationSettings = {
  emailNotifications: boolean;
  diseaseAlerts: boolean;
  growthUpdates: boolean;
  harvestAlerts: boolean;
  sensorAlerts: boolean;
};

const defaultNotificationSettings: NotificationSettings =
  {
    emailNotifications: true,
    diseaseAlerts: true,
    growthUpdates: true,
    harvestAlerts: true,
    sensorAlerts: true,
  };

function getFirebaseErrorMessage(
  error: unknown
) {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error
      ? String(error.code)
      : "";

  switch (code) {
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Your current password is incorrect.";

    case "auth/weak-password":
      return "Your new password must contain at least 6 characters.";

    case "auth/requires-recent-login":
      return "For security, please sign in again before changing your password.";

    case "auth/too-many-requests":
      return "Too many unsuccessful attempts. Please wait and try again later.";

    case "auth/network-request-failed":
      return "Network error. Please check your internet connection.";

    case "auth/user-disabled":
      return "This account has been disabled. Please contact the administrator.";

    case "auth/user-not-found":
      return "The authenticated account could not be found.";

    default:
      return error instanceof Error
        ? error.message.replace(
            "Firebase: ",
            ""
          )
        : "Something went wrong. Please try again.";
  }
}

export default function SettingsPage() {
  const {
    firebaseUser,
    userData,
    loading: authLoading,
  } = useAuth();

  const [
    notificationSettings,
    setNotificationSettings,
  ] =
    useState<NotificationSettings>(
      defaultNotificationSettings
    );

  const [
    settingsLoading,
    setSettingsLoading,
  ] = useState(true);

  const [
    savingSettings,
    setSavingSettings,
  ] = useState(false);

  const [
    settingsError,
    setSettingsError,
  ] = useState("");

  const [
    settingsSuccess,
    setSettingsSuccess,
  ] = useState("");

  const [
    currentPassword,
    setCurrentPassword,
  ] = useState("");

  const [newPassword, setNewPassword] =
    useState("");

  const [
    confirmPassword,
    setConfirmPassword,
  ] = useState("");

  const [
    showCurrentPassword,
    setShowCurrentPassword,
  ] = useState(false);

  const [
    showNewPassword,
    setShowNewPassword,
  ] = useState(false);

  const [
    showConfirmPassword,
    setShowConfirmPassword,
  ] = useState(false);

  const [
    changingPassword,
    setChangingPassword,
  ] = useState(false);

  const [
    passwordError,
    setPasswordError,
  ] = useState("");

  const [
    passwordSuccess,
    setPasswordSuccess,
  ] = useState("");

  const [
    sendingResetEmail,
    setSendingResetEmail,
  ] = useState(false);

  const [
    resetEmailError,
    setResetEmailError,
  ] = useState("");

  const [
    resetEmailSuccess,
    setResetEmailSuccess,
  ] = useState("");

  const displayEmail =
    userData?.email ||
    firebaseUser?.email ||
    "";

  const displayName =
    userData?.fullName ||
    firebaseUser?.displayName ||
    "CinnaAI User";

  useEffect(() => {
    let mounted = true;

    async function loadSettings() {
      if (!firebaseUser) {
        if (mounted) {
          setSettingsLoading(false);
        }

        return;
      }

      try {
        setSettingsLoading(true);

        const userReference = doc(
          db,
          "users",
          firebaseUser.uid
        );

        const userSnapshot =
          await getDoc(userReference);

        if (
          mounted &&
          userSnapshot.exists()
        ) {
          const data =
            userSnapshot.data();

          const savedSettings =
            data.notificationSettings as
              | Partial<NotificationSettings>
              | undefined;

          setNotificationSettings({
            ...defaultNotificationSettings,
            ...savedSettings,
          });
        }
      } catch (error) {
        console.error(
          "Settings loading failed:",
          error
        );

        if (mounted) {
          setSettingsError(
            "Unable to load your settings. Default settings are currently shown."
          );
        }
      } finally {
        if (mounted) {
          setSettingsLoading(false);
        }
      }
    }

    loadSettings();

    return () => {
      mounted = false;
    };
  }, [firebaseUser]);

  function updateNotificationSetting(
    field: keyof NotificationSettings,
    value: boolean
  ) {
    setNotificationSettings(
      (previous) => ({
        ...previous,
        [field]: value,
      })
    );

    if (settingsError) {
      setSettingsError("");
    }

    if (settingsSuccess) {
      setSettingsSuccess("");
    }
  }

  async function handleSaveSettings(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setSettingsError("");
    setSettingsSuccess("");

    if (!firebaseUser) {
      setSettingsError(
        "You must be signed in to update your settings."
      );
      return;
    }

    try {
      setSavingSettings(true);

      const userReference = doc(
        db,
        "users",
        firebaseUser.uid
      );

      await setDoc(
        userReference,
        {
          notificationSettings,
          updatedAt: serverTimestamp(),
        },
        {
          merge: true,
        }
      );

      setSettingsSuccess(
        "Your notification settings were saved successfully."
      );
    } catch (error) {
      console.error(
        "Settings update failed:",
        error
      );

      setSettingsError(
        error instanceof Error
          ? error.message
          : "Unable to save your settings. Please try again."
      );
    } finally {
      setSavingSettings(false);
    }
  }

  async function handlePasswordChange(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setPasswordError("");
    setPasswordSuccess("");

    if (!firebaseUser) {
      setPasswordError(
        "You must be signed in to change your password."
      );
      return;
    }

    if (!firebaseUser.email) {
      setPasswordError(
        "No email address is associated with this account."
      );
      return;
    }

    if (!currentPassword) {
      setPasswordError(
        "Please enter your current password."
      );
      return;
    }

    if (!newPassword) {
      setPasswordError(
        "Please enter your new password."
      );
      return;
    }

    if (newPassword.length < 6) {
      setPasswordError(
        "Your new password must contain at least 6 characters."
      );
      return;
    }

    if (!confirmPassword) {
      setPasswordError(
        "Please confirm your new password."
      );
      return;
    }

    if (
      newPassword !== confirmPassword
    ) {
      setPasswordError(
        "The new passwords do not match."
      );
      return;
    }

    if (
      currentPassword === newPassword
    ) {
      setPasswordError(
        "Your new password must be different from your current password."
      );
      return;
    }

    try {
      setChangingPassword(true);

      const credential =
        EmailAuthProvider.credential(
          firebaseUser.email,
          currentPassword
        );

      await reauthenticateWithCredential(
        firebaseUser,
        credential
      );

      await updatePassword(
        firebaseUser,
        newPassword
      );

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");

      setPasswordSuccess(
        "Your password was changed successfully."
      );
    } catch (error) {
      console.error(
        "Password update failed:",
        error
      );

      setPasswordError(
        getFirebaseErrorMessage(error)
      );
    } finally {
      setChangingPassword(false);
    }
  }

  async function handleSendResetEmail() {
    setResetEmailError("");
    setResetEmailSuccess("");

    if (!firebaseUser?.email) {
      setResetEmailError(
        "No email address is associated with this account."
      );
      return;
    }

    try {
      setSendingResetEmail(true);

      await sendPasswordResetEmail(
        auth,
        firebaseUser.email
      );

      setResetEmailSuccess(
        `A password reset link was sent to ${firebaseUser.email}.`
      );
    } catch (error) {
      console.error(
        "Password reset email failed:",
        error
      );

      setResetEmailError(
        getFirebaseErrorMessage(error)
      );
    } finally {
      setSendingResetEmail(false);
    }
  }

  return (
    <ProtectedRoute>
      {authLoading ? (
        <main className="grid min-h-[calc(100vh-4rem)] place-items-center bg-slate-50 px-4">
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <Loader2 className="h-5 w-5 animate-spin text-emerald-700" />

            <p className="text-sm font-medium text-slate-600">
              Loading your settings...
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
                Settings
              </h1>

              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                Manage your CinnaAI
                notifications, password and
                account security settings.
              </p>
            </div>

            <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
              <aside className="space-y-6">
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-center gap-3">
                    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-700">
                      <Leaf className="h-6 w-6" />
                    </span>

                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-bold text-slate-900">
                        {displayName}
                      </h2>

                      <p className="mt-1 truncate text-xs text-slate-500">
                        {displayEmail}
                      </p>
                    </div>
                  </div>

                  <div className="mt-6 border-t border-slate-100 pt-6">
                    <div className="flex items-start gap-3">
                      <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />

                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          Account protected
                        </p>

                        <p className="mt-1 text-xs leading-5 text-slate-500">
                          Your account uses
                          Firebase Authentication
                          for secure access.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
                  <div className="flex gap-3">
                    <Bell className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />

                    <div>
                      <h3 className="text-sm font-semibold text-emerald-900">
                        Alert preferences
                      </h3>

                      <p className="mt-1 text-xs leading-5 text-emerald-700">
                        Choose which system
                        notifications should be
                        enabled for your account.
                      </p>
                    </div>
                  </div>
                </div>
              </aside>

              <div className="space-y-6">
                <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
                  <div className="flex items-start gap-3 border-b border-slate-100 pb-6">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-700">
                      <Bell className="h-5 w-5" />
                    </span>

                    <div>
                      <h2 className="text-xl font-bold text-slate-900">
                        Notification settings
                      </h2>

                      <p className="mt-1 text-sm leading-6 text-slate-500">
                        Manage alerts and
                        notifications related to
                        your cinnamon monitoring
                        activities.
                      </p>
                    </div>
                  </div>

                  {settingsError && (
                    <div
                      role="alert"
                      className="mt-6 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700"
                    >
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />

                      <p>{settingsError}</p>
                    </div>
                  )}

                  {settingsSuccess && (
                    <div
                      role="status"
                      className="mt-6 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700"
                    >
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />

                      <p>{settingsSuccess}</p>
                    </div>
                  )}

                  {settingsLoading ? (
                    <div className="flex items-center justify-center gap-3 py-12">
                      <Loader2 className="h-5 w-5 animate-spin text-emerald-700" />

                      <p className="text-sm font-medium text-slate-500">
                        Loading notification
                        settings...
                      </p>
                    </div>
                  ) : (
                    <form
                      onSubmit={
                        handleSaveSettings
                      }
                      className="mt-6"
                    >
                      <div className="divide-y divide-slate-100">
                        <SettingToggle
                          icon={Mail}
                          title="Email notifications"
                          description="Allow CinnaAI to send account and monitoring notifications to your registered email."
                          checked={
                            notificationSettings.emailNotifications
                          }
                          disabled={
                            savingSettings
                          }
                          onChange={(value) =>
                            updateNotificationSetting(
                              "emailNotifications",
                              value
                            )
                          }
                        />

                        <SettingToggle
                          icon={ShieldCheck}
                          title="Disease detection alerts"
                          description="Receive notifications when a possible cinnamon plant disease is detected."
                          checked={
                            notificationSettings.diseaseAlerts
                          }
                          disabled={
                            savingSettings
                          }
                          onChange={(value) =>
                            updateNotificationSetting(
                              "diseaseAlerts",
                              value
                            )
                          }
                        />

                        <SettingToggle
                          icon={Leaf}
                          title="Growth prediction updates"
                          description="Receive updates related to growth predictions and plant development."
                          checked={
                            notificationSettings.growthUpdates
                          }
                          disabled={
                            savingSettings
                          }
                          onChange={(value) =>
                            updateNotificationSetting(
                              "growthUpdates",
                              value
                            )
                          }
                        />

                        <SettingToggle
                          icon={Bell}
                          title="Harvest readiness alerts"
                          description="Receive alerts when a monitored cinnamon plant may be ready for harvesting."
                          checked={
                            notificationSettings.harvestAlerts
                          }
                          disabled={
                            savingSettings
                          }
                          onChange={(value) =>
                            updateNotificationSetting(
                              "harvestAlerts",
                              value
                            )
                          }
                        />

                        <SettingToggle
                          icon={Smartphone}
                          title="IoT sensor alerts"
                          description="Receive alerts for unusual temperature, humidity or soil moisture readings."
                          checked={
                            notificationSettings.sensorAlerts
                          }
                          disabled={
                            savingSettings
                          }
                          onChange={(value) =>
                            updateNotificationSetting(
                              "sensorAlerts",
                              value
                            )
                          }
                        />
                      </div>

                      <div className="mt-6 flex justify-end border-t border-slate-100 pt-6">
                        <button
                          type="submit"
                          disabled={
                            savingSettings
                          }
                          className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-6 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {savingSettings ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />

                              Saving settings...
                            </>
                          ) : (
                            <>
                              <Save className="h-4 w-4" />

                              Save settings
                            </>
                          )}
                        </button>
                      </div>
                    </form>
                  )}
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
                  <div className="flex items-start gap-3 border-b border-slate-100 pb-6">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-700">
                      <KeyRound className="h-5 w-5" />
                    </span>

                    <div>
                      <h2 className="text-xl font-bold text-slate-900">
                        Change password
                      </h2>

                      <p className="mt-1 text-sm leading-6 text-slate-500">
                        Enter your current
                        password before setting
                        a new password.
                      </p>
                    </div>
                  </div>

                  {passwordError && (
                    <div
                      role="alert"
                      className="mt-6 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700"
                    >
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />

                      <p>{passwordError}</p>
                    </div>
                  )}

                  {passwordSuccess && (
                    <div
                      role="status"
                      className="mt-6 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700"
                    >
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />

                      <p>{passwordSuccess}</p>
                    </div>
                  )}

                  <form
                    onSubmit={
                      handlePasswordChange
                    }
                    className="mt-6 space-y-5"
                  >
                    <PasswordInput
                      id="currentPassword"
                      label="Current password"
                      value={currentPassword}
                      showPassword={
                        showCurrentPassword
                      }
                      disabled={
                        changingPassword
                      }
                      autoComplete="current-password"
                      placeholder="Enter your current password"
                      onChange={(value) => {
                        setCurrentPassword(
                          value
                        );

                        setPasswordError("");
                        setPasswordSuccess("");
                      }}
                      onToggleVisibility={() =>
                        setShowCurrentPassword(
                          (previous) =>
                            !previous
                        )
                      }
                    />

                    <div className="grid gap-5 sm:grid-cols-2">
                      <PasswordInput
                        id="newPassword"
                        label="New password"
                        value={newPassword}
                        showPassword={
                          showNewPassword
                        }
                        disabled={
                          changingPassword
                        }
                        autoComplete="new-password"
                        placeholder="Minimum 6 characters"
                        onChange={(value) => {
                          setNewPassword(
                            value
                          );

                          setPasswordError("");
                          setPasswordSuccess("");
                        }}
                        onToggleVisibility={() =>
                          setShowNewPassword(
                            (previous) =>
                              !previous
                          )
                        }
                      />

                      <PasswordInput
                        id="confirmPassword"
                        label="Confirm new password"
                        value={confirmPassword}
                        showPassword={
                          showConfirmPassword
                        }
                        disabled={
                          changingPassword
                        }
                        autoComplete="new-password"
                        placeholder="Re-enter new password"
                        onChange={(value) => {
                          setConfirmPassword(
                            value
                          );

                          setPasswordError("");
                          setPasswordSuccess("");
                        }}
                        onToggleVisibility={() =>
                          setShowConfirmPassword(
                            (previous) =>
                              !previous
                          )
                        }
                      />
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-xs font-semibold text-slate-700">
                        Password requirements
                      </p>

                      <p className="mt-1 text-xs leading-5 text-slate-500">
                        Use at least 6
                        characters. For better
                        security, use a
                        combination of letters,
                        numbers and symbols.
                      </p>
                    </div>

                    <div className="flex justify-end border-t border-slate-100 pt-6">
                      <button
                        type="submit"
                        disabled={
                          changingPassword
                        }
                        className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-6 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {changingPassword ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />

                            Updating password...
                          </>
                        ) : (
                          <>
                            <LockKeyhole className="h-4 w-4" />

                            Change password
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                </section>

              </div>
            </div>
          </div>
        </main>
      )}
    </ProtectedRoute>
  );
}

type SettingToggleProps = {
  icon: React.ComponentType<{
    className?: string;
  }>;
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
};

function SettingToggle({
  icon: Icon,
  title,
  description,
  checked,
  disabled = false,
  onChange,
}: SettingToggleProps) {
  return (
    <div className="flex items-start justify-between gap-4 py-5 first:pt-0 last:pb-0">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600">
          <Icon className="h-5 w-5" />
        </span>

        <div>
          <p className="text-sm font-semibold text-slate-900">
            {title}
          </p>

          <p className="mt-1 max-w-xl text-xs leading-5 text-slate-500">
            {description}
          </p>
        </div>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={title}
        disabled={disabled}
        onClick={() =>
          onChange(!checked)
        }
        className={[
          "relative mt-1 inline-flex h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60",
          checked
            ? "bg-emerald-700"
            : "bg-slate-300",
        ].join(" ")}
      >
        <span
          className={[
            "pointer-events-none inline-block h-5 w-5 translate-y-0.5 rounded-full bg-white shadow-sm transition-transform",
            checked
              ? "translate-x-[22px]"
              : "translate-x-0.5",
          ].join(" ")}
        />
      </button>
    </div>
  );
}

type PasswordInputProps = {
  id: string;
  label: string;
  value: string;
  showPassword: boolean;
  disabled?: boolean;
  autoComplete:
    | "current-password"
    | "new-password";
  placeholder: string;
  onChange: (value: string) => void;
  onToggleVisibility: () => void;
};

function PasswordInput({
  id,
  label,
  value,
  showPassword,
  disabled = false,
  autoComplete,
  placeholder,
  onChange,
  onToggleVisibility,
}: PasswordInputProps) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-2 block text-sm font-semibold text-slate-700"
      >
        {label}
      </label>

      <div className="relative">
        <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />

        <input
          id={id}
          name={id}
          type={
            showPassword
              ? "text"
              : "password"
          }
          autoComplete={autoComplete}
          value={value}
          onChange={(event) =>
            onChange(event.target.value)
          }
          placeholder={placeholder}
          disabled={disabled}
          className="h-12 w-full rounded-xl border border-slate-300 bg-white pl-10 pr-12 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:ring-4 focus:ring-emerald-500/10 disabled:cursor-not-allowed disabled:bg-slate-100"
        />

        <button
          type="button"
          onClick={onToggleVisibility}
          disabled={disabled}
          className="absolute right-3 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 disabled:cursor-not-allowed"
          aria-label={
            showPassword
              ? `Hide ${label.toLowerCase()}`
              : `Show ${label.toLowerCase()}`
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
  );
}
