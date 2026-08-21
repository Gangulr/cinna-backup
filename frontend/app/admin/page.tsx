"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

import {
  CheckCircle2,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  UserCheck,
  UserRound,
  UserX,
  Users,
} from "lucide-react";

import ProtectedRoute from "@/app/components/ProtectedRoute";
import { useAuth } from "@/app/context/AuthContext";
import { db } from "@/app/lib/firebase";

type UserRole = "admin" | "user";
type UserStatus = "active" | "disabled";

type SystemUser = {
  id: string;
  uid: string;
  fullName: string;
  email: string;
  username: string;
  phone: string;
  beneficiaryType: string;
  role: UserRole;
  status: UserStatus;
  joinedDate: string;
};

function formatDate(value: string) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(date);
}

export default function AdminPage() {
  const { firebaseUser } = useAuth();

  const [users, setUsers] = useState<SystemUser[]>([]);
  const [searchValue, setSearchValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadUsers = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      let snapshot;

      try {
        const usersQuery = query(
          collection(db, "users"),
          orderBy("createdAt", "desc")
        );

        snapshot = await getDocs(usersQuery);
      } catch {
        snapshot = await getDocs(collection(db, "users"));
      }

      const loadedUsers: SystemUser[] = snapshot.docs.map((userDocument) => {
        const data = userDocument.data();

        return {
          id: userDocument.id,
          uid:
            typeof data.uid === "string"
              ? data.uid
              : userDocument.id,
          fullName:
            typeof data.fullName === "string"
              ? data.fullName
              : "Unknown User",
          email:
            typeof data.email === "string"
              ? data.email
              : "",
          username:
            typeof data.username === "string"
              ? data.username
              : "",
          phone:
            typeof data.phone === "string"
              ? data.phone
              : "",
          beneficiaryType:
            typeof data.beneficiaryType === "string"
              ? data.beneficiaryType
              : "User",
          role:
            data.role === "admin"
              ? "admin"
              : "user",
          status:
            data.status === "disabled"
              ? "disabled"
              : "active",
          joinedDate:
            typeof data.joinedDate === "string"
              ? data.joinedDate
              : "",
        };
      });

      setUsers(loadedUsers);
    } catch (loadError) {
      console.error("Users loading error:", loadError);

      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load users."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    if (!success) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setSuccess("");
    }, 3000);

    return () => window.clearTimeout(timeout);
  }, [success]);

  async function updateUserRole(
    user: SystemUser,
    newRole: UserRole
  ) {
    if (user.uid === firebaseUser?.uid && newRole !== "admin") {
      setError("You cannot remove your own administrator access.");
      return;
    }

    try {
      setUpdatingUserId(user.id);
      setError("");
      setSuccess("");

      await updateDoc(doc(db, "users", user.id), {
        role: newRole,
        updatedAt: serverTimestamp(),
      });

      setUsers((currentUsers) =>
        currentUsers.map((currentUser) =>
          currentUser.id === user.id
            ? {
                ...currentUser,
                role: newRole,
              }
            : currentUser
        )
      );

      setSuccess(`${user.fullName}'s role was updated.`);
    } catch (updateError) {
      console.error("Role update error:", updateError);

      setError(
        updateError instanceof Error
          ? updateError.message
          : "Unable to update the user role."
      );
    } finally {
      setUpdatingUserId(null);
    }
  }

  async function updateUserStatus(
    user: SystemUser,
    newStatus: UserStatus
  ) {
    if (
      user.uid === firebaseUser?.uid &&
      newStatus === "disabled"
    ) {
      setError("You cannot disable your own administrator account.");
      return;
    }

    try {
      setUpdatingUserId(user.id);
      setError("");
      setSuccess("");

      await updateDoc(doc(db, "users", user.id), {
        status: newStatus,
        updatedAt: serverTimestamp(),
      });

      setUsers((currentUsers) =>
        currentUsers.map((currentUser) =>
          currentUser.id === user.id
            ? {
                ...currentUser,
                status: newStatus,
              }
            : currentUser
        )
      );

      setSuccess(`${user.fullName}'s account status was updated.`);
    } catch (updateError) {
      console.error("Status update error:", updateError);

      setError(
        updateError instanceof Error
          ? updateError.message
          : "Unable to update the account status."
      );
    } finally {
      setUpdatingUserId(null);
    }
  }

  const filteredUsers = useMemo(() => {
    const search = searchValue.trim().toLowerCase();

    if (!search) {
      return users;
    }

    return users.filter((user) => {
      return [
        user.fullName,
        user.email,
        user.username,
        user.phone,
        user.beneficiaryType,
        user.role,
        user.status,
      ].some((value) =>
        String(value).toLowerCase().includes(search)
      );
    });
  }, [users, searchValue]);

  const totalAdmins = users.filter(
    (user) => user.role === "admin"
  ).length;

  const totalActive = users.filter(
    (user) => user.status === "active"
  ).length;

  const totalDisabled = users.filter(
    (user) => user.status === "disabled"
  ).length;

  return (
    <ProtectedRoute adminOnly>
      <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                  <ShieldCheck className="h-5 w-5" />
                </span>

                <div>
                  <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">
                    Admin Dashboard
                  </h1>

                  <p className="mt-1 text-sm text-slate-500">
                    Manage CinnaAI user accounts, roles and access.
                  </p>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={loadUsers}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw
                className={`h-4 w-4 ${
                  loading ? "animate-spin" : ""
                }`}
              />

              Refresh
            </button>
          </div>

          {error && (
            <div className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
              {error}
            </div>
          )}

          {success && (
            <div className="mt-6 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
              {success}
            </div>
          )}

          <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between">
                <p className="text-sm font-semibold text-slate-500">
                  Total Users
                </p>

                <Users className="h-5 w-5 text-blue-600" />
              </div>

              <p className="mt-3 text-3xl font-bold text-slate-900">
                {users.length}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between">
                <p className="text-sm font-semibold text-slate-500">
                  Administrators
                </p>

                <ShieldCheck className="h-5 w-5 text-violet-600" />
              </div>

              <p className="mt-3 text-3xl font-bold text-slate-900">
                {totalAdmins}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between">
                <p className="text-sm font-semibold text-slate-500">
                  Active Accounts
                </p>

                <UserCheck className="h-5 w-5 text-emerald-600" />
              </div>

              <p className="mt-3 text-3xl font-bold text-slate-900">
                {totalActive}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between">
                <p className="text-sm font-semibold text-slate-500">
                  Disabled Accounts
                </p>

                <UserX className="h-5 w-5 text-rose-600" />
              </div>

              <p className="mt-3 text-3xl font-bold text-slate-900">
                {totalDisabled}
              </p>
            </div>
          </div>

          <section className="mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  User Management
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  Showing {filteredUsers.length} of {users.length} users.
                </p>
              </div>

              <div className="relative w-full sm:max-w-sm">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />

                <input
                  type="search"
                  value={searchValue}
                  onChange={(event) =>
                    setSearchValue(event.target.value)
                  }
                  placeholder="Search users..."
                  className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>
            </div>

            {loading ? (
              <div className="flex min-h-[350px] flex-col items-center justify-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />

                <p className="text-sm font-medium text-slate-500">
                  Loading users...
                </p>
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="flex min-h-[350px] flex-col items-center justify-center gap-3 text-center">
                <UserRound className="h-10 w-10 text-slate-300" />

                <p className="font-semibold text-slate-600">
                  No users found
                </p>

                <p className="text-sm text-slate-400">
                  Try another search value.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1050px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-5 py-4">User</th>
                      <th className="px-5 py-4">Username</th>
                      <th className="px-5 py-4">Beneficiary</th>
                      <th className="px-5 py-4">Joined</th>
                      <th className="px-5 py-4">Role</th>
                      <th className="px-5 py-4">Status</th>
                      <th className="px-5 py-4">Actions</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-100">
                    {filteredUsers.map((user) => {
                      const isCurrentUser =
                        user.uid === firebaseUser?.uid;

                      const isUpdating =
                        updatingUserId === user.id;

                      return (
                        <tr
                          key={user.id}
                          className="transition hover:bg-slate-50/70"
                        >
                          <td className="px-5 py-4">
                            <div className="flex items-center gap-3">
                              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-700">
                                {user.fullName
                                  .charAt(0)
                                  .toUpperCase()}
                              </span>

                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className="max-w-[190px] truncate font-semibold text-slate-900">
                                    {user.fullName}
                                  </p>

                                  {isCurrentUser && (
                                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold uppercase text-blue-600">
                                      You
                                    </span>
                                  )}
                                </div>

                                <p className="max-w-[220px] truncate text-xs text-slate-500">
                                  {user.email}
                                </p>
                              </div>
                            </div>
                          </td>

                          <td className="px-5 py-4 text-slate-600">
                            {user.username || "-"}
                          </td>

                          <td className="px-5 py-4 text-slate-600">
                            {user.beneficiaryType || "-"}
                          </td>

                          <td className="px-5 py-4 text-slate-500">
                            {formatDate(user.joinedDate)}
                          </td>

                          <td className="px-5 py-4">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${
                                user.role === "admin"
                                  ? "bg-violet-50 text-violet-700"
                                  : "bg-slate-100 text-slate-700"
                              }`}
                            >
                              {user.role}
                            </span>
                          </td>

                          <td className="px-5 py-4">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${
                                user.status === "active"
                                  ? "bg-emerald-50 text-emerald-700"
                                  : "bg-rose-50 text-rose-700"
                              }`}
                            >
                              {user.status}
                            </span>
                          </td>

                          <td className="px-5 py-4">
                            <div className="flex items-center gap-2">
                              <select
                                value={user.role}
                                disabled={isUpdating || isCurrentUser}
                                onChange={(event) =>
                                  updateUserRole(
                                    user,
                                    event.target.value as UserRole
                                  )
                                }
                                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 outline-none focus:border-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:opacity-60"
                              >
                                <option value="user">User</option>
                                <option value="admin">Admin</option>
                              </select>

                              <button
                                type="button"
                                disabled={isUpdating || isCurrentUser}
                                onClick={() =>
                                  updateUserStatus(
                                    user,
                                    user.status === "active"
                                      ? "disabled"
                                      : "active"
                                  )
                                }
                                className={`inline-flex min-w-[90px] items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                                  user.status === "active"
                                    ? "bg-rose-50 text-rose-700 hover:bg-rose-100"
                                    : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                                }`}
                              >
                                {isUpdating ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : user.status === "active" ? (
                                  <UserX className="h-3.5 w-3.5" />
                                ) : (
                                  <UserCheck className="h-3.5 w-3.5" />
                                )}

                                {user.status === "active"
                                  ? "Disable"
                                  : "Enable"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </main>
    </ProtectedRoute>
  );
}