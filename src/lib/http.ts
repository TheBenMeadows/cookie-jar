import { HTTP_TIMEOUT_MS } from "./config";

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * JSON fetch with a deadline. Every Cookie ecosystem API this app talks to is a third party on the
 * far side of a phone's network, so nothing may hang the page waiting for one.
 */
export async function fetchJson<T>(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = HTTP_TIMEOUT_MS, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...rest,
      signal: controller.signal,
      headers: {
        accept: "application/json",
        ...(rest.body ? { "content-type": "application/json" } : {}),
        ...rest.headers,
      },
    });
    const text = await response.text();
    if (!response.ok) {
      throw new HttpError(`HTTP ${response.status} from ${new URL(url).host}`, response.status);
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new HttpError(`${new URL(url).host} answered with something that is not JSON`, 0);
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new HttpError(`${new URL(url).host} did not answer within ${timeoutMs} ms`, 0);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
