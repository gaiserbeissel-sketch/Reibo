/**
 * 浏览器里请求的 API 根地址。
 * - Vite 开发（npm run dev）或预览（npm run preview，默认 4173）：返回空字符串 → 请求走当前页「同源」，
 *   由 vite.config 里 proxy 转到本机 127.0.0.1:8000。这样用 http://192.168.x.x:5173 从别的电脑打开时，
 *   无需把 uvicorn 改成监听 0.0.0.0，也避免浏览器直连 192.168.x.x:8000 被拒绝。
 * - 构建后由静态服务器直出（非 Vite）：与页面同 host、端口 8000。
 * - 覆盖：frontend/.env 设置 VITE_API_BASE（如生产网关）。
 */
export function resolveApiBase(): string {
  const fromEnv = (import.meta.env.VITE_API_BASE as string | undefined)?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (typeof window !== "undefined" && window.location?.hostname) {
    const port = window.location.port || "";
    const isViteDev = import.meta.env.DEV;
    const isVitePreview =
      !import.meta.env.DEV && (port === "4173" || port === "4174");
    if (isViteDev || isVitePreview) {
      return "";
    }
    const proto = window.location.protocol === "https:" ? "https:" : "http:";
    return `${proto}//${window.location.hostname}:8000`;
  }
  return "http://127.0.0.1:8000";
}

/** 页眉展示用：空基址表示走同源代理 */
export function formatApiBaseLabel(base: string): string {
  return base === "" ? "（同源，Vite → :8000）" : base;
}

/**
 * 将后端返回的静态资源路径（如 /static-data/audio/xxx.wav）转为浏览器可打开、可复制的绝对 URL。
 * apiBase 为空时使用当前页 origin（与 Vite 代理一致）。
 */
export function publicAssetAbsoluteUrl(apiBase: string, relativePath: string): string {
  const p = (relativePath || "").trim();
  if (!p) return "";
  const path = p.startsWith("/") ? p : `/${p}`;
  const base = (apiBase || "").replace(/\/$/, "");
  if (base) return `${base}${path}`;
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}${path}`;
  }
  return path;
}
