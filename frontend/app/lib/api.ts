import { auth } from "@/app/lib/firebase";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:8001";

type ApiOptions = RequestInit & {
  requireAuth?: boolean;
};

async function getFirebaseToken(): Promise<string | null> {
  const currentUser = auth.currentUser;

  if (!currentUser) {
    return null;
  }

  return currentUser.getIdToken();
}

async function apiRequest<T>(
  endpoint: string,
  options: ApiOptions = {}
): Promise<T> {
  const {
    requireAuth = true,
    headers,
    ...requestOptions
  } = options;

  const token = requireAuth
    ? await getFirebaseToken()
    : null;

  if (requireAuth && !token) {
    throw new Error(
      "You must be signed in to perform this action."
    );
  }

  const requestHeaders = new Headers(headers);

  if (token) {
    requestHeaders.set(
      "Authorization",
      `Bearer ${token}`
    );
  }

  const isFormData =
    requestOptions.body instanceof FormData;

  if (
    requestOptions.body &&
    !isFormData &&
    !requestHeaders.has("Content-Type")
  ) {
    requestHeaders.set(
      "Content-Type",
      "application/json"
    );
  }

  const response = await fetch(
    `${API_BASE_URL}${endpoint}`,
    {
      ...requestOptions,
      headers: requestHeaders,
    }
  );

  let responseData: unknown = null;

  const contentType =
    response.headers.get("content-type");

  if (
    contentType?.includes("application/json")
  ) {
    responseData = await response.json();
  } else {
    responseData = await response.text();
  }

  if (!response.ok) {
    let errorMessage =
      `Request failed with status ${response.status}.`;

    if (
      responseData &&
      typeof responseData === "object" &&
      "detail" in responseData
    ) {
      const detail = (responseData as { detail: unknown }).detail;
      errorMessage = Array.isArray(detail)
        ? detail.map((e: any) => `${e.loc?.join('.') || 'Error'}: ${e.msg}`).join(', ')
        : String(detail || 'Request failed');
    } else if (
      responseData &&
      typeof responseData === "object" &&
      "error" in responseData
    ) {
      errorMessage = String(
        (responseData as { error: unknown }).error
      );
    } else if (
      typeof responseData === "string" &&
      responseData
    ) {
      errorMessage = responseData;
    }

    if (response.status === 401) {
      errorMessage =
        errorMessage ||
        "Your session has expired. Please sign in again.";
    }

    if (response.status === 403) {
      errorMessage =
        errorMessage ||
        "You do not have permission to access this resource.";
    }

    throw new Error(errorMessage);
  }

  return responseData as T;
}

export async function apiGet<T>(
  endpoint: string,
  requireAuth = true
): Promise<T> {
  return apiRequest<T>(endpoint, {
    method: "GET",
    requireAuth,
    cache: "no-store",
  });
}

export async function apiPost<T>(
  endpoint: string,
  data?: unknown,
  requireAuth = true
): Promise<T> {
  return apiRequest<T>(endpoint, {
    method: "POST",
    requireAuth,
    body:
      data === undefined
        ? undefined
        : JSON.stringify(data),
  });
}

export async function apiPostFormData<T>(
  endpoint: string,
  formData: FormData,
  requireAuth = true
): Promise<T> {
  return apiRequest<T>(endpoint, {
    method: "POST",
    requireAuth,
    body: formData,
  });
}

export async function apiPut<T>(
  endpoint: string,
  data?: unknown,
  requireAuth = true
): Promise<T> {
  return apiRequest<T>(endpoint, {
    method: "PUT",
    requireAuth,
    body:
      data === undefined
        ? undefined
        : JSON.stringify(data),
  });
}

export async function apiDelete<T>(
  endpoint: string,
  requireAuth = true
): Promise<T> {
  return apiRequest<T>(endpoint, {
    method: "DELETE",
    requireAuth,
  });
}