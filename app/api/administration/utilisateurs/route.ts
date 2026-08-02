import { type NextRequest } from "next/server";
import { requireAreaAccessForRequest } from "@/lib/auth/server.ts";
import { listDepartments, listUsers, createUser as createUserRecord } from "@/lib/users/repository.ts";
import { parseUserPayload } from "@/lib/users/validation.ts";
import { buildUsersApiError, buildUsersApiSuccess, mapUsersApiError } from "@/lib/users/http.ts";

export async function GET(request: NextRequest) {
  const { deniedResponse } = await requireAreaAccessForRequest(request, "administration");
  if (deniedResponse) {
    return deniedResponse;
  }

  try {
    const url = new URL(request.url);
    const [users, departments] = await Promise.all([
      listUsers({
        search: url.searchParams.get("search") ?? undefined,
        role: (url.searchParams.get("role") as "all") ?? "all",
        department: (url.searchParams.get("department") as "all") ?? "all",
        status: (url.searchParams.get("status") as "all") ?? "all"
      }),
      listDepartments()
    ]);

    return buildUsersApiSuccess({ users, departments });
  } catch (error) {
    return mapUsersApiError(error, "USERS_LIST_FAILED", "Impossible de charger les utilisateurs.");
  }
}

export async function POST(request: NextRequest) {
  const { deniedResponse } = await requireAreaAccessForRequest(request, "administration");
  if (deniedResponse) {
    return deniedResponse;
  }

  try {
    const body = await request.json();
    const payload = parseUserPayload(body);
    const user = await createUserRecord(payload);

    if (!user) {
      return buildUsersApiError(
        "USER_CREATE_FAILED",
        "La creation utilisateur a echoue.",
        500
      );
    }

    return buildUsersApiSuccess({ user }, 201);
  } catch (error) {
    return mapUsersApiError(error, "USER_CREATE_FAILED", "La creation utilisateur a echoue.");
  }
}
