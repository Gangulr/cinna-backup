from pathlib import Path
from typing import Any, Dict

import os

import firebase_admin

from fastapi import (
    Depends,
    Header,
    HTTPException,
    status,
)

from firebase_admin import (
    auth,
    credentials,
    firestore,
)


# =========================================================
# PATH AND ENVIRONMENT CONFIGURATION
# =========================================================

BASE_DIR = Path(__file__).resolve().parent

FIREBASE_KEY_PATH = Path(
    os.getenv(
        "FIREBASE_KEY_PATH",
        str(BASE_DIR / "firebase-key.json"),
    )
)

FIREBASE_DATABASE_URL = os.getenv(
    "FIREBASE_DATABASE_URL",
    (
        "https://cinnamon-system-default-rtdb."
        "asia-southeast1.firebasedatabase.app"
    ),
)


# =========================================================
# FIREBASE INITIALIZATION
# =========================================================

def initialize_firebase() -> None:
    """
    Initialize Firebase Admin SDK only once.

    By default, the service account file must be located at:

        backend/firebase-key.json

    A different location can be configured using:

        FIREBASE_KEY_PATH

    The Firebase Realtime Database URL can be configured using:

        FIREBASE_DATABASE_URL
    """

    if firebase_admin._apps:
        return

    if not FIREBASE_KEY_PATH.exists():
        raise FileNotFoundError(
            "Firebase service account file was not found at: "
            f"{FIREBASE_KEY_PATH}"
        )

    try:
        firebase_credential = credentials.Certificate(
            str(FIREBASE_KEY_PATH)
        )

        firebase_admin.initialize_app(
            firebase_credential,
            {
                "databaseURL": FIREBASE_DATABASE_URL,
            },
        )

        print(
            "Firebase Admin SDK initialized successfully."
        )

    except Exception as error:
        print(
            "Firebase Admin SDK initialization failed:",
            error,
        )

        raise RuntimeError(
            "Unable to initialize Firebase Admin SDK."
        ) from error


initialize_firebase()

db = firestore.client()


# =========================================================
# TOKEN HELPERS
# =========================================================

def extract_bearer_token(
    authorization: str | None,
) -> str:
    """
    Extract a Firebase ID token from an authorization header.

    Expected format:

        Authorization: Bearer <firebase-id-token>
    """

    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header is missing.",
            headers={
                "WWW-Authenticate": "Bearer",
            },
        )

    scheme, separator, token = authorization.partition(
        " "
    )

    if (
        not separator
        or scheme.strip().lower() != "bearer"
        or not token.strip()
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=(
                "Invalid authorization header. "
                "Use: Bearer <firebase-token>"
            ),
            headers={
                "WWW-Authenticate": "Bearer",
            },
        )

    return token.strip()


def normalize_role(
    value: Any,
) -> str:
    """
    Normalize the Firestore role value.

    Only the admin role receives administrator privileges.
    All other values are treated as normal users.
    """

    normalized_role = str(
        value or "user"
    ).strip().lower()

    if normalized_role == "admin":
        return "admin"

    return "user"


def normalize_account_status(
    value: Any,
) -> str:
    """
    Normalize the Firestore account status value.
    """

    normalized_status = str(
        value or "active"
    ).strip().lower()

    if normalized_status in {
        "disabled",
        "inactive",
        "blocked",
        "suspended",
    }:
        return normalized_status

    return "active"


# =========================================================
# CURRENT USER AUTHENTICATION
# =========================================================

async def get_current_user(
    authorization: str | None = Header(
        default=None,
        alias="Authorization",
    ),
) -> Dict[str, Any]:
    """
    Verify the Firebase ID token and load the related
    profile from the Firestore users collection.

    Returned user structure:

        {
            "uid": "...",
            "email": "...",
            "fullName": "...",
            "username": "...",
            "role": "user" | "admin",
            "status": "active",
            "emailVerified": True | False
        }
    """

    token = extract_bearer_token(
        authorization
    )

    try:
        decoded_token = auth.verify_id_token(
            token,
            check_revoked=True,
        )

        uid = decoded_token.get("uid")

        if not uid:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=(
                    "Firebase token does not contain "
                    "a valid user ID."
                ),
                headers={
                    "WWW-Authenticate": "Bearer",
                },
            )

        user_document = (
            db.collection("users")
            .document(str(uid))
            .get()
        )

        if not user_document.exists:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "The user profile was not found in "
                    "the Firestore users collection."
                ),
            )

        user_data = (
            user_document.to_dict()
            or {}
        )

        account_status = (
            normalize_account_status(
                user_data.get("status")
            )
        )

        if account_status != "active":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "This user account is not active. "
                    "Please contact the administrator."
                ),
            )

        role = normalize_role(
            user_data.get("role")
        )

        email = str(
            user_data.get("email")
            or decoded_token.get("email")
            or ""
        ).strip()

        full_name = str(
            user_data.get("fullName")
            or decoded_token.get("name")
            or "User"
        ).strip()

        username = str(
            user_data.get("username")
            or ""
        ).strip()

        email_verified = bool(
            decoded_token.get(
                "email_verified",
                False,
            )
        )

        return {
            "uid": str(uid),
            "email": email,
            "fullName": full_name,
            "username": username,
            "role": role,
            "status": account_status,
            "emailVerified": email_verified,
        }

    except HTTPException:
        raise

    except auth.ExpiredIdTokenError as error:
        print(
            "Expired Firebase token:",
            error,
        )

        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=(
                "Firebase authentication token has expired. "
                "Please sign in again."
            ),
            headers={
                "WWW-Authenticate": "Bearer",
            },
        ) from error

    except auth.RevokedIdTokenError as error:
        print(
            "Revoked Firebase token:",
            error,
        )

        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=(
                "Firebase authentication token has been "
                "revoked. Please sign in again."
            ),
            headers={
                "WWW-Authenticate": "Bearer",
            },
        ) from error

    except auth.InvalidIdTokenError as error:
        print(
            "Invalid Firebase token:",
            error,
        )

        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=(
                "Invalid Firebase authentication token."
            ),
            headers={
                "WWW-Authenticate": "Bearer",
            },
        ) from error

    except auth.UserDisabledError as error:
        print(
            "Disabled Firebase user:",
            error,
        )

        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "This Firebase Authentication account "
                "has been disabled."
            ),
        ) from error

    except auth.CertificateFetchError as error:
        print(
            "Firebase certificate error:",
            error,
        )

        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Firebase authentication service is "
                "temporarily unavailable."
            ),
        ) from error

    except Exception as error:
        print(
            "Firebase authentication error:",
            error,
        )

        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication failed.",
            headers={
                "WWW-Authenticate": "Bearer",
            },
        ) from error


# =========================================================
# ADMIN AUTHORIZATION
# =========================================================

async def require_admin(
    current_user: Dict[str, Any] = Depends(
        get_current_user
    ),
) -> Dict[str, Any]:
    """
    Allow access only to active users with the admin role.
    """

    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Administrator access is required "
                "for this operation."
            ),
        )

    return current_user


# =========================================================
# OPTIONAL USER HELPERS
# =========================================================

def is_admin(
    current_user: Dict[str, Any],
) -> bool:
    """
    Return True when the authenticated user is an admin.
    """

    return (
        current_user.get("role")
        == "admin"
    )


def get_user_uid(
    current_user: Dict[str, Any],
) -> str:
    """
    Return the authenticated Firebase user UID.
    """

    uid = current_user.get("uid")

    if not uid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=(
                "Authenticated user ID is missing."
            ),
        )

    return str(uid)


def get_user_email(
    current_user: Dict[str, Any],
) -> str:
    """
    Return the authenticated user's email address.
    """

    email = current_user.get("email")

    if not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "The authenticated user does not have "
                "an email address."
            ),
        )

    return str(email)


def require_verified_email(
    current_user: Dict[str, Any] = Depends(
        get_current_user
    ),
) -> Dict[str, Any]:
    """
    Optional dependency for endpoints that require
    a verified Firebase email address.
    """

    if not current_user.get(
        "emailVerified",
        False,
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "A verified email address is required "
                "for this operation."
            ),
        )

    return current_user