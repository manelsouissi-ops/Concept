import type {
  DepartmentRecord,
  DevelopmentUserState,
  ProfileUpdateInput,
  UserMutationInput,
  UserRecord,
  UserStatus
} from "./types.ts";

export type UsersApiErrorPayload = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

export type UserOwnershipImpact = {
  activeOwnedCount: number;
  ownedTenderCodes: string[];
  ownedTenders: Array<{
    code: string;
    title: string;
    updatedAt: string;
  }>;
};

type UsersApiSuccessResponse<TData> = {
  ok: true;
  data: TData;
};

type UsersApiErrorResponse = {
  ok: false;
  error: UsersApiErrorPayload;
};

export type UserListResponse = {
  users: UserRecord[];
  departments: DepartmentRecord[];
};

export type UserResponse = {
  user: UserRecord;
  departments?: DepartmentRecord[];
  ownershipImpact?: UserOwnershipImpact;
};

export class UsersClientError extends Error {
  code: string;
  status: number;
  details: Record<string, unknown>;

  constructor(status: number, payload: UsersApiErrorPayload) {
    super(payload.message);
    this.name = "UsersClientError";
    this.code = payload.code;
    this.status = status;
    this.details = payload.details ?? {};
  }
}

async function parseResponse<TData>(response: Response) {
  const payload = (await response.json()) as
    | UsersApiSuccessResponse<TData>
    | UsersApiErrorResponse;

  if (!response.ok || !payload.ok) {
    const errorPayload =
      "error" in payload
        ? payload.error
        : {
            code: "USERS_HTTP_ERROR",
            message: "Erreur utilisateur inattendue.",
            details: {}
          };
    throw new UsersClientError(response.status, errorPayload);
  }

  return payload.data;
}

export async function createUser(input: UserMutationInput) {
  const response = await fetch("/api/administration/utilisateurs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });

  return parseResponse<UserResponse>(response);
}

export async function updateUser(id: number, input: UserMutationInput) {
  const response = await fetch(`/api/administration/utilisateurs/${id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });

  return parseResponse<UserResponse>(response);
}

export async function getUserOwnershipImpact(id: number) {
  const response = await fetch(`/api/administration/utilisateurs/${id}`, {
    cache: "no-store"
  });

  const data = await parseResponse<UserResponse>(response);
  return data.ownershipImpact ?? {
    activeOwnedCount: 0,
    ownedTenderCodes: [],
    ownedTenders: []
  };
}

export async function updateProfile(input: ProfileUpdateInput) {
  const response = await fetch("/api/profile", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });

  return parseResponse<UserResponse>(response);
}

export async function setUserStatus(id: number, status: UserStatus) {
  const endpoint = status === "ACTIVE" ? "activate" : "deactivate";
  const response = await fetch(`/api/administration/utilisateurs/${id}/${endpoint}`, {
    method: "POST"
  });

  return parseResponse<UserResponse>(response);
}

export async function switchDevelopmentUser(userId: number) {
  const response = await fetch("/api/development/current-user", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ userId })
  });

  return parseResponse<DevelopmentUserState & { user: UserRecord }>(response);
}
