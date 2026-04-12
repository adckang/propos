import publicConfig from "./propos.public.json";

export function getBrowserToken() {
  if (typeof window === "undefined") return "";
  return window.PROPOS_BROWSER_TOKEN || window.localStorage?.getItem("propos_browser_token") || "";
}

export default publicConfig;
