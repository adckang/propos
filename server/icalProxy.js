import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const FETCH_TIMEOUT_MS = 20000;

function validateIcalUrl(rawUrl) {
  if (!rawUrl) {
    throw new Error("url is required");
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http/https URLs are allowed");
  }

  return parsed.toString();
}

async function parseTextSafe(response) {
  return response.text().catch(() => "");
}

function isNetworkFetchError(error) {
  const message = String(error?.message || "");
  const causeCode = error?.cause?.code;
  return (
    causeCode === "ECONNRESET" ||
    causeCode === "ECONNREFUSED" ||
    causeCode === "ENOTFOUND" ||
    causeCode === "ETIMEDOUT" ||
    causeCode === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
    causeCode === "SELF_SIGNED_CERT_IN_CHAIN" ||
    message.includes("unable to verify the first certificate") ||
    message.includes("fetch failed") ||
    message.includes("network timeout")
  );
}

async function fetchIcalTextWithCurl(url) {
  const { stdout } = await execFileAsync("curl", [
    "--fail",
    "--silent",
    "--show-error",
    "--location",
    "--max-time",
    "20",
    "-H",
    "Accept: text/calendar,text/plain;q=0.9,*/*;q=0.8",
    url,
  ]);

  if (!stdout || !stdout.includes("BEGIN:VCALENDAR")) {
    throw new Error("Invalid iCal response");
  }

  return stdout;
}

export async function fetchIcalText(rawUrl) {
  const url = validateIcalUrl(rawUrl);
  let response;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error("network timeout")), FETCH_TIMEOUT_MS);
  try {
    response = await fetch(url, {
      headers: {
        Accept: "text/calendar,text/plain;q=0.9,*/*;q=0.8",
        "User-Agent": "PROPOS Calendar Sync/1.0",
        "Cache-Control": "no-store",
      },
      redirect: "follow",
      signal: controller.signal,
    });
  } catch (error) {
    if (isNetworkFetchError(error)) {
      return await fetchIcalTextWithCurl(url);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const text = await parseTextSafe(response);
    throw new Error(`iCal upstream ${response.status}${text ? `: ${text.slice(0, 160)}` : ""}`);
  }

  const text = await response.text();
  if (!text || !text.includes("BEGIN:VCALENDAR")) {
    throw new Error("Invalid iCal response");
  }

  return text;
}
