import {
  findRuntimeApiContract,
  findRuntimeNonJsonApiContract,
  runtimeApiErrorSchema,
  runtimeBootstrapResponseSchema,
  runtimePathParamsFromUrl,
  runtimeQueryFromUrl,
  type RuntimeApiContract,
  type RuntimeNonJsonApiContract,
  type RuntimeBootstrapData
} from "@symtype/shared";

let csrfToken = "";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function checkedResponse(
  path: string,
  init?: RequestInit,
  csrfProtectedRead = false
): Promise<Response> {
  const method = init?.method ?? "GET";
  const headers = new Headers(init?.headers);
  if (init?.body != null && !headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");
  if ((csrfProtectedRead || !["GET", "HEAD"].includes(method.toUpperCase())) && csrfToken) {
    headers.set("X-SymType-CSRF", csrfToken);
  }
  const response = await fetch(path, { ...init, headers, credentials: "same-origin" });
  if (!response.ok) {
    let message = `本地服务返回 ${response.status}`;
    let code = "REQUEST_FAILED";
    try {
      const body = runtimeApiErrorSchema.safeParse(await response.json());
      if (body.success) {
        message = body.data.error.message;
        code = body.data.error.code;
      }
    } catch {
      // Preserve the readable HTTP fallback.
    }
    throw new ApiError(response.status, code, message);
  }
  return response;
}

function assertRequestLocation(
  contract: RuntimeApiContract | RuntimeNonJsonApiContract,
  path: string
): void {
  if (contract.params) {
    const parsed = contract.params.safeParse(runtimePathParamsFromUrl(contract, path));
    if (!parsed.success) {
      throw new ApiError(400, "CLIENT_CONTRACT_MISMATCH", "请求路径参数不符合本地 API 契约。");
    }
  }
  if (contract.query) {
    const parsed = contract.query.safeParse(runtimeQueryFromUrl(path));
    if (!parsed.success) {
      throw new ApiError(400, "CLIENT_CONTRACT_MISMATCH", "请求查询参数不符合本地 API 契约。");
    }
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const contract = findRuntimeApiContract(method, path);
  if (contract) assertRequestLocation(contract, path);
  let checkedInit = init;
  if (contract?.requestBody === "binary") {
    const contentType = new Headers(init?.headers).get("Content-Type")?.split(";", 1)[0]?.trim();
    if (
      init?.body == null ||
      typeof init.body === "string" ||
      !contentType ||
      !contract.requestContentTypes?.includes(contentType)
    ) {
      throw new ApiError(
        400,
        "CLIENT_CONTRACT_MISMATCH",
        "二进制请求内容或 Content-Type 不符合本地 API 契约。"
      );
    }
  } else if (contract?.request) {
    let candidate: unknown;
    try {
      candidate = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
    } catch {
      throw new ApiError(400, "CLIENT_CONTRACT_MISMATCH", "请求内容不是有效的 JSON。");
    }
    const parsed = contract.request.safeParse(candidate);
    if (!parsed.success) {
      throw new ApiError(400, "CLIENT_CONTRACT_MISMATCH", "请求内容不符合本地 API 契约。");
    }
    checkedInit = { ...init, body: JSON.stringify(parsed.data) };
  }
  const response = await checkedResponse(path, checkedInit);
  if (response.status === 204) return undefined as T;
  const data: unknown = await response.json();
  if (!contract) return data as T;
  const parsed = contract.response.safeParse(data);
  if (!parsed.success) {
    throw new ApiError(
      502,
      "SERVER_CONTRACT_MISMATCH",
      "本地服务返回了不兼容的数据；请重启 SymType 后重试。"
    );
  }
  return parsed.data as T;
}

function downloadFilename(response: Response): string | undefined {
  const disposition = response.headers.get("Content-Disposition");
  if (!disposition) return undefined;
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/iu)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded.replace(/^"|"$/gu, ""));
    } catch {
      // Fall through to the ASCII filename when a server supplied a malformed value.
    }
  }
  return disposition.match(/filename="?([^";]+)"?/iu)?.[1];
}

export const api = {
  async bootstrap(): Promise<RuntimeBootstrapData> {
    const data = await request<RuntimeBootstrapData>("/api/v1/bootstrap");
    // Keep an explicit assertion here so bootstrap remains protected even if a
    // future route-registry refactor accidentally omits its descriptor.
    const bootstrap = runtimeBootstrapResponseSchema.parse(data);
    csrfToken = bootstrap.csrfToken;
    return bootstrap;
  },
  get<T>(path: string): Promise<T> {
    return request<T>(path);
  },
  post<T>(path: string, body?: unknown): Promise<T> {
    const init: RequestInit = { method: "POST" };
    if (body !== undefined) init.body = JSON.stringify(body);
    return request<T>(path, init);
  },
  postRaw<T>(path: string, body: BodyInit, contentType: string): Promise<T> {
    return request<T>(path, {
      method: "POST",
      body,
      headers: { "Content-Type": contentType }
    });
  },
  put<T>(path: string, body: unknown): Promise<T> {
    return request<T>(path, { method: "PUT", body: JSON.stringify(body) });
  },
  patch<T>(path: string, body: unknown): Promise<T> {
    return request<T>(path, { method: "PATCH", body: JSON.stringify(body) });
  },
  async download(path: string): Promise<{ blob: Blob; filename?: string }> {
    const contract = findRuntimeNonJsonApiContract("GET", path);
    if (!contract) {
      throw new ApiError(400, "CLIENT_CONTRACT_MISMATCH", "下载地址未在本地 API 契约中注册。");
    }
    assertRequestLocation(contract, path);
    const response = await checkedResponse(
      path,
      { method: "GET" },
      contract.csrfProtectedRead === true
    );
    const contentType = response.headers.get("Content-Type")?.split(";", 1)[0]?.trim() ?? "";
    if (!contract.responseContentTypes.includes(contentType)) {
      throw new ApiError(
        502,
        "SERVER_CONTRACT_MISMATCH",
        "下载响应的 Content-Type 与本地 API 契约不一致。"
      );
    }
    const filename = downloadFilename(response);
    return {
      blob: await response.blob(),
      ...(filename ? { filename } : {})
    };
  },
  getCsrfToken(): string {
    return csrfToken;
  }
};
