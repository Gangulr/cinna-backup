"use client";

import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";

import {
  User,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from "firebase/auth";

import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

import { auth, db } from "@/app/lib/firebase";

export type UserRole = "admin" | "user";

export type UserStatus = "active" | "disabled";

export type AppUser = {
  uid: string;
  fullName: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  username?: string;
  phone?: string;
  location?: string;
  beneficiaryType?: string;
  researchInterests?: string;
  bio?: string;
  joinedDate?: unknown;
  createdAt?: unknown;
  notificationSettings?: {
    emailNotifications?: boolean;
    diseaseAlerts?: boolean;
    growthUpdates?: boolean;
    harvestAlerts?: boolean;
    sensorAlerts?: boolean;
  };
};

type RegisterInput = {
  fullName: string;
  email: string;
  password: string;
};

type AuthContextType = {
  firebaseUser: User | null;
  userData: AppUser | null;
  loading: boolean;

  register: (
    input: RegisterInput
  ) => Promise<void>;

  login: (
    email: string,
    password: string
  ) => Promise<void>;

  logout: () => Promise<void>;

  refreshUserData: () => Promise<void>;

  getIdToken: () => Promise<string | null>;
};

const AuthContext =
  createContext<AuthContextType | null>(null);

function createUsername(
  fullName: string,
  uid: string
): string {
  const baseName = fullName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 15);

  return `${baseName || "user"}${uid.slice(0, 5)}`;
}

export function AuthProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [firebaseUser, setFirebaseUser] =
    useState<User | null>(null);

  const [userData, setUserData] =
    useState<AppUser | null>(null);

  const [loading, setLoading] =
    useState(true);

  async function loadUserData(
    user: User
  ): Promise<void> {
    const userReference = doc(
      db,
      "users",
      user.uid
    );

    const userSnapshot = await getDoc(
      userReference
    );

    /*
     * Create a Firestore profile automatically
     * when an existing Firebase Authentication
     * user does not have a users/{uid} document.
     */
    if (!userSnapshot.exists()) {
      const fallbackUser: AppUser = {
        uid: user.uid,
        fullName:
          user.displayName || "User",
        email:
          user.email || "",
        role: "user",
        status: "active",
      };

      await setDoc(
        userReference,
        {
          ...fallbackUser,

          username: createUsername(
            fallbackUser.fullName,
            user.uid
          ),

          phone: "",
          beneficiaryType: "User",
          bio: "",
          location: "",
          researchInterests: "",

          joinedDate:
            new Date().toISOString(),

          createdAt:
            serverTimestamp(),

          updatedAt:
            serverTimestamp(),
        },
        {
          merge: true,
        }
      );

      setUserData(fallbackUser);

      return;
    }

    const data =
      userSnapshot.data();

    const loadedUser: AppUser = {
      uid: user.uid,

      fullName:
        typeof data.fullName === "string" &&
        data.fullName.trim()
          ? data.fullName
          : user.displayName || "User",

      email:
        typeof data.email === "string" &&
        data.email.trim()
          ? data.email
          : user.email || "",

      role:
        data.role === "admin"
          ? "admin"
          : "user",

      status:
        data.status === "disabled"
          ? "disabled"
          : "active",
    };

    /*
     * Disabled users are immediately logged out.
     */
    if (
      loadedUser.status ===
      "disabled"
    ) {
      await signOut(auth);

      setFirebaseUser(null);
      setUserData(null);

      throw new Error(
        "Your account has been disabled by the administrator."
      );
    }

    setUserData(loadedUser);
  }

  useEffect(() => {
    const unsubscribe =
      onAuthStateChanged(
        auth,
        async (user) => {
          try {
            setLoading(true);
            setFirebaseUser(user);

            if (user) {
              await loadUserData(user);
            } else {
              setUserData(null);
            }
          } catch (error) {
            console.error(
              "Authentication state error:",
              error
            );

            setFirebaseUser(null);
            setUserData(null);
          } finally {
            setLoading(false);
          }
        }
      );

    return () => {
      unsubscribe();
    };
  }, []);

  async function register({
    fullName,
    email,
    password,
  }: RegisterInput): Promise<void> {
    const cleanedName =
      fullName.trim();

    const cleanedEmail =
      email.trim().toLowerCase();

    if (!cleanedName) {
      throw new Error(
        "Full name is required."
      );
    }

    if (!cleanedEmail) {
      throw new Error(
        "Email address is required."
      );
    }

    if (!password) {
      throw new Error(
        "Password is required."
      );
    }

    const credential =
      await createUserWithEmailAndPassword(
        auth,
        cleanedEmail,
        password
      );

    await updateProfile(
      credential.user,
      {
        displayName: cleanedName,
      }
    );

    const newUser: AppUser = {
      uid:
        credential.user.uid,

      fullName:
        cleanedName,

      email:
        cleanedEmail,

      role:
        "user",

      status:
        "active",
    };

    await setDoc(
      doc(
        db,
        "users",
        credential.user.uid
      ),
      {
        ...newUser,

        username: createUsername(
          cleanedName,
          credential.user.uid
        ),

        phone: "",
        beneficiaryType: "User",
        bio: "",
        location: "",
        researchInterests: "",

        joinedDate:
          new Date().toISOString(),

        createdAt:
          serverTimestamp(),

        updatedAt:
          serverTimestamp(),
      },
      {
        merge: true,
      }
    );

    setFirebaseUser(
      credential.user
    );

    setUserData(
      newUser
    );
  }

  async function login(
    email: string,
    password: string
  ): Promise<void> {
    const cleanedEmail =
      email.trim().toLowerCase();

    if (!cleanedEmail) {
      throw new Error(
        "Email address is required."
      );
    }

    if (!password) {
      throw new Error(
        "Password is required."
      );
    }

    const credential =
      await signInWithEmailAndPassword(
        auth,
        cleanedEmail,
        password
      );

    await loadUserData(
      credential.user
    );

    setFirebaseUser(
      credential.user
    );
  }

  async function logout(): Promise<void> {
    await signOut(auth);

    setFirebaseUser(null);
    setUserData(null);
  }

  async function refreshUserData(): Promise<void> {
    const currentUser =
      auth.currentUser;

    if (!currentUser) {
      setFirebaseUser(null);
      setUserData(null);

      return;
    }

    await loadUserData(
      currentUser
    );
  }

  async function getIdToken(): Promise<
    string | null
  > {
    const currentUser =
      auth.currentUser;

    if (!currentUser) {
      return null;
    }

    return currentUser.getIdToken();
  }

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        userData,
        loading,
        register,
        login,
        logout,
        refreshUserData,
        getIdToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context =
    useContext(AuthContext);

  if (!context) {
    throw new Error(
      "useAuth must be used inside AuthProvider."
    );
  }

  return context;
}
