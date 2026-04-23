import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { formatApiBaseLabel, publicAssetAbsoluteUrl, resolveApiBase } from "./apiBase";

// 运行时解析：Vite 下默认同源 + 代理到 :8000；直出静态页时同 host:8000。可设 VITE_API_BASE 覆盖。
const API_BASE = resolveApiBase();

/** 步骤4 批量混剪并发：固定为 2（界面不可改，避免与 NVENC 等资源争抢） */
const STEP4_COMPOSE_CONCURRENCY = 2;

/** GET /api/avatar/system-templates/list 单条模板 */
type SystemAvatarTemplateRow = {
  filename: string;
  video_url: string;
  thumb_url?: string;
  label?: string;
};

/** 步骤3 / 全自动：系统分身模板缩略图选择（点击即选中，生成分身时使用当前选中项） */
function AvatarSystemTemplateStrip({
  templates,
  selectedVideoUrl,
  onSelectVideoUrl,
  disabled,
  apiBase,
}: {
  templates: SystemAvatarTemplateRow[];
  selectedVideoUrl: string | null;
  onSelectVideoUrl: (url: string) => void;
  disabled: boolean;
  apiBase: string;
}) {
  if (!templates.length) {
    return (
      <div className="mini" style={{ marginTop: 6 }}>
        暂无系统模板：将口播用 <span className="apiVal">.mp4</span> 等放入「本地模版/shuziren」（可与项目同级，或在{' '}
        <span className="apiVal">0401多了AI-主</span> 目录下）；未配置 <span className="apiVal">SYSTEM_AVATAR_TEMPLATES_DIR</span> 时后端会自动解析上述路径。可选同名{' '}
        <span className="apiVal">.jpg / .png / .webp</span> 作封面；放入后<strong>重启后端并刷新本页</strong>。亦可使用下方「上传口播模板视频」。
      </div>
    );
  }
  return (
    <div className="ap-avatar-template-strip" role="list">
      {templates.map((t) => {
        const selected = (selectedVideoUrl || "") === t.video_url;
        const thumbPath =
          (t.thumb_url || "").trim() ||
          `/api/avatar/system-templates/thumb/${encodeURIComponent(t.filename)}`;
        const thumbSrc = publicAssetAbsoluteUrl(apiBase, thumbPath);
        const cap = (t.label || t.filename).replace(/\.(mp4|mov|webm|mkv)$/i, "");
        return (
          <button
            key={t.video_url}
            type="button"
            role="listitem"
            className={`ap-avatar-template-tile${selected ? " ap-avatar-template-tile--selected" : ""}`}
            disabled={disabled}
            title={`${t.filename}（点击选用，再点「生成分身视频」）`}
            onClick={() => onSelectVideoUrl(t.video_url)}
          >
            <img
              src={thumbSrc}
              alt=""
              loading="lazy"
              decoding="async"
              className="ap-avatar-template-tile-img"
            />
            <span className="ap-avatar-template-tile-cap">{cap}</span>
          </button>
        );
      })}
    </div>
  );
}

/** 步骤1 关键词 → 发布话题预览（与后端 douyin_text.normalize_hashtags + # 拼接一致） */
function formatStep5HashtagPreview(keywords: string[]): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const raw of keywords) {
    const t = (raw || "").trim().replace(/^#+/, "");
    if (!t || seen.has(t)) continue;
    seen.add(t);
    parts.push(`#${t}`);
    if (parts.length >= 5) break;
  }
  return parts.join(" ");
}

/** 单行：最多 5 个 #话题（去重保序），# 与 # 之间用空格，便于与步骤4 横幅直接拼接。 */
function buildSingleHashtagLineFromKeywords(keywords: string[]): string {
  const cleaned = keywords.map((k) => (k || "").trim().replace(/^#+/, "")).filter(Boolean);
  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const t of cleaned) {
    if (seen.has(t)) continue;
    seen.add(t);
    uniq.push(t);
    if (uniq.length >= 5) break;
  }
  return uniq.map((x) => `#${x}`).join(" ");
}

/** 从步骤1 #话题 池顺序切分：共 groupCount 行，第 i 行仅含第 i 组 #（每组至多 5 个）；发布时由步骤4「横幅」自动前置。 */
function buildStep5HashtagLinesFromStep1TopicGroups(topicLabels: string[], groupCount: number): string {
  const labels = normalizeHashtagLabels(topicLabels);
  const g = Math.max(1, Math.min(50, groupCount));
  const lines: string[] = [];
  for (let i = 0; i < g; i += 1) {
    lines.push(buildSingleHashtagLineFromKeywords(labels.slice(i * 5, i * 5 + 5)));
  }
  return lines.join("\n");
}

/** 从口播单条原文中抓取 #标签（每行最多 5 个，保序去重） */
function extractHashtagLabelsFromLine(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const s = (raw || "").replace(/\r\n/g, "\n");
  const re = /#([^\s#]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const label = (m[1] || "").trim().replace(/^#+/, "");
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push(label);
    if (out.length >= 5) break;
  }
  return out;
}

function normalizeHashtagLabels(rawList: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of rawList) {
    const label = String(raw || "").trim().replace(/^#+/, "");
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push(label);
    if (out.length >= 20) break;
  }
  return out;
}

/** 成片路径末段文件名（用于列表展示） */
function basenameFromUrlOrPath(p: string): string {
  const s = (p || "").trim().split(/[?#]/)[0];
  const parts = s.split(/[/\\]/);
  const name = (parts[parts.length - 1] || s).trim();
  return name || "—";
}

/** 步骤5 每行：仅填 # 话题（恰好 5 个）；# 与 # 之间可空格。真机粘贴时再前置步骤4「横幅」。 */
function parseStep5TopicLineHashtagsOnly(
  raw: string,
): { ok: true; tags: string[] } | { ok: false; error: string } {
  const s = (raw || "").trim();
  if (!s) return { ok: false, error: "不能为空" };
  const tags = extractHashtagLabelsFromLine(s);
  if (tags.length !== 5) {
    return {
      ok: false,
      error: `每行须恰好 5 个 #话题（当前 ${tags.length} 个），例如 #硬核护肤 #老板说实话 #性价比王 #美妆源头 #变美小技巧`,
    };
  }
  return { ok: true, tags };
}

/**
 * 写入抖音「#话题」框：步骤4 横幅 + 本行 # 话题串（横幅末尾与首 # 之间无空格）。
 * 若本行已以当前横幅开头（用户已整段粘贴），则不再重复拼接。
 */
function buildTopicCaptionForPublish(step4Banner: string, topicLine: string): string {
  const b = (step4Banner || "").trim();
  const t = (topicLine || "").trim();
  if (!t) return "";
  if (b && t.startsWith(b)) return t;
  if (b) return b + t;
  return t;
}

const STEP5_PUBLISH_VIDEO_EXTS = new Set(["mp4", "mov", "webm", "mkv"]);

/** 步骤5 成片路径：须与后端 resolve_media_url + 发布接口支持的视频后缀一致 */
function validateStep5PublishVideoPathLine(raw: string): string | null {
  const n = normalizeComposeAssetUrl(raw);
  if (!n) {
    return "须为 /static-data/...、/api/user-library/media/... 或系统模板 URL（不支持 file:// 或无法识别的链接）";
  }
  const base = n.split("?")[0].toLowerCase();
  const ext = base.includes(".") ? base.slice(base.lastIndexOf(".") + 1) : "";
  if (!STEP5_PUBLISH_VIDEO_EXTS.has(ext)) {
    return "须为视频文件后缀 .mp4 / .mov / .webm / .mkv";
  }
  return null;
}

type Step5DeviceMeta = { note: string; selected: boolean };

const LS_STEP5_HASHTAG_LINES = "ap_step5_hashtag_lines";
const LS_STEP5_DEVICE_META = "ap_step5_device_meta";

function loadStep5HashtagLinesText(): string {
  try {
    return localStorage.getItem(LS_STEP5_HASHTAG_LINES) || "";
  } catch {
    return "";
  }
}

function loadStep5DeviceMeta(): Record<string, Step5DeviceMeta> {
  try {
    const raw = localStorage.getItem(LS_STEP5_DEVICE_META);
    if (!raw) return {};
    const j = JSON.parse(raw) as unknown;
    return j && typeof j === "object" ? (j as Record<string, Step5DeviceMeta>) : {};
  } catch {
    return {};
  }
}

const LS_STEP4_BATCH_VIDEO_URLS = "ap_step4_batch_video_urls";
const LS_STEP4_DONE_HINT = "ap_step4_done_hint";

function loadStep4BatchVideoUrlsInitial(): string[] {
  try {
    const raw = localStorage.getItem(LS_STEP4_BATCH_VIDEO_URLS);
    if (!raw) return [];
    const j = JSON.parse(raw) as unknown;
    return Array.isArray(j) ? j.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function loadStep4DoneHintInitial(): string | null {
  try {
    const h = localStorage.getItem(LS_STEP4_DONE_HINT);
    return h && h.trim() ? h : null;
  } catch {
    return null;
  }
}

type PhoneDeviceRow = {
  serial: string;
  state: string;
  model: string;
  product: string;
  device: string;
  transport_id: string;
};

type PhoneDouyinAccountRow = {
  id: string;
  device_serial: string;
  device_label: string;
  account_label: string;
  scan_error?: string | null;
  douyin_id?: string;
  nickname?: string;
};

const LS_STEP5_PHONE_DEVICES = "ap_step5_phone_devices";
const LS_STEP5_PHONE_ACCOUNTS = "ap_step5_phone_accounts";

function loadStep5PhoneDevices(): PhoneDeviceRow[] {
  try {
    const raw = localStorage.getItem(LS_STEP5_PHONE_DEVICES);
    if (!raw) return [];
    const j = JSON.parse(raw) as unknown;
    return Array.isArray(j) ? (j as PhoneDeviceRow[]) : [];
  } catch {
    return [];
  }
}

function loadStep5PhoneAccounts(): PhoneDouyinAccountRow[] {
  try {
    const raw = localStorage.getItem(LS_STEP5_PHONE_ACCOUNTS);
    if (!raw) return [];
    const j = JSON.parse(raw) as unknown;
    return Array.isArray(j) ? (j as PhoneDouyinAccountRow[]) : [];
  } catch {
    return [];
  }
}

// Voice options matching terminal version
const VOICE_OPTIONS = [
  { value: "zh-CN-XiaoxiaoNeural", label: "晓晓 (女声)" },
  { value: "zh-CN-YunxiNeural", label: "云希 (男声)" },
  { value: "zh-CN-YunyangNeural", label: "云扬 (新闻女声)" },
  { value: "lekui", label: "乐葵 (自定义音色)" },
];

/** 仅「系统工具配音」（Edge 16k 等）可用的预设；蝉镜模式不可选（避免误走 Edge） */
const EDGE_PRESET_VOICE_VALUES = new Set([
  "zh-CN-XiaoxiaoNeural",
  "zh-CN-YunxiNeural",
  "zh-CN-YunyangNeural",
]);

function assertChanjingAudioModeOrThrow(audioMode: "local" | "api", voice: string, voiceUploadId: string | null) {
  if (audioMode !== "api") return;
  if (EDGE_PRESET_VOICE_VALUES.has(voice)) {
    throw new Error(
      "蝉镜模式不能使用晓晓/云希等系统 Edge 音色。请改用「系统工具配音」，或选择「乐葵」并上传样本获得蝉镜 C-Audio-* 后再生成。"
    );
  }
  if (voice === "lekui" && !(voiceUploadId || "").trim()) {
    throw new Error("蝉镜模式：请先为「乐葵」上传样本并完成克隆，再生成音频。");
  }
}

/** Ubuntu / 可配置：在 .env 设置 VITE_LEKUI_VOICE_FILE=/path/to/sample.aac */
const LEKUI_VOICE_HINT =
  (typeof import.meta !== "undefined" && (import.meta as ImportMeta & { env?: { VITE_LEKUI_VOICE_FILE?: string } }).env?.VITE_LEKUI_VOICE_FILE) ||
  "/home/wen/音色/乐葵音色示例.aac";

/** 与后端 /api/tts/synthesize 返回的 tts_engine 对齐（用于执行日志，避免把 hq 误标成蝉镜） */
function formatTtsEngineLabel(engine: string | undefined): string {
  const m: Record<string, string> = {
    chanjing_cloud: "蝉镜云端 TTS（定制音色）",
    edge_hq: "Edge 高质量 MP3",
    edge_16k_mono: "Edge →16k mono WAV",
    linux_edge_16k: "Edge →16k mono WAV (Linux)",
    windows_edge_16k: "Edge →16k mono WAV (Windows)",
    windows_sapi: "Windows SAPI",
    darwin_say: "macOS say",
    clone_sovits: "语音克隆 So-VITS",
    clone_seed_vc: "语音克隆 Seed-VC",
    unknown: "未知",
  };
  if (!engine) return m.unknown;
  return m[engine] || engine;
}

/** 分步生产成功提示：当前本地时间 +「完成」 */
function formatStepDoneLabel(): string {
  return new Date().toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function loadStepScriptLinesInitial(): string[] {
  try {
    const raw = localStorage.getItem("ap_step_script_lines");
    if (raw) {
      const a = JSON.parse(raw) as unknown;
      if (Array.isArray(a) && a.length > 0) return a.map((x) => String(x ?? ""));
    }
  } catch {
    /* ignore */
  }
  try {
    const flow = localStorage.getItem("ap_step_flow");
    if (flow) {
      const o = JSON.parse(flow) as { script?: string };
      if (o.script && o.script.trim()) return [o.script];
    }
  } catch {
    /* ignore */
  }
  return [""];
}

function loadStepAudioUrlsInitial(len: number): string[] {
  try {
    const raw = localStorage.getItem("ap_step_audio_urls");
    if (raw) {
      const a = JSON.parse(raw) as unknown;
      if (Array.isArray(a)) {
        const out = a.map((x) => String(x ?? ""));
        while (out.length < len) out.push("");
        return out.slice(0, Math.max(len, out.length));
      }
    }
  } catch {
    /* ignore */
  }
  return Array.from({ length: Math.max(1, len) }, () => "");
}

/** 步骤3 仅产出一条分身视频 URL；兼容旧版 ap_step_avatar_urls 首条非空 */
function loadStep3AvatarVideoUrlInitial(): string {
  try {
    const one = localStorage.getItem("ap_step3_avatar_video_url");
    if (one && one.trim()) return one.trim();
    const raw = localStorage.getItem("ap_step_avatar_urls");
    if (raw) {
      const a = JSON.parse(raw) as unknown;
      if (Array.isArray(a)) {
        const hit = a.find((x) => String(x || "").trim());
        if (hit) return String(hit).trim();
      }
    }
  } catch {
    /* ignore */
  }
  return "";
}

function loadStep3SelectedAudioIndexInitial(lineCount: number): number {
  const n = Math.max(1, lineCount);
  try {
    const s = localStorage.getItem("ap_step3_selected_audio_idx");
    if (s !== null && s !== "") {
      const v = parseInt(s, 10);
      if (!Number.isNaN(v) && v >= 0 && v < n) return v;
    }
  } catch {
    /* ignore */
  }
  return 0;
}

/** 从 /static-data/... URL 取文件名用于展示 */
function fileLabelFromStaticUrl(url: string): string {
  const u = (url || "").trim().split("?")[0];
  const parts = u.split("/").filter(Boolean);
  const last = parts[parts.length - 1] || u;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** 分身模板 URL 若在系统模板列表中则为系统模版，否则视为用户上传的自定义模版 */
function avatarTemplateKindLabel(
  videoUrl: string | null | undefined,
  templates: SystemAvatarTemplateRow[]
): "系统模版" | "自定义模版" {
  const u = (videoUrl || "").trim();
  if (!u) return "自定义模版";
  return templates.some((t) => t.video_url === u) ? "系统模版" : "自定义模版";
}

/**
 * 步骤1 口播块规范：上方为 #话题（可一行多个 #）；单独一行「正文」；以下为正文内容（唯一参与 TTS）。
 * 可选以 *------ 截断末尾说明。无「正文」行时整段视为口播正文（兼容旧数据）。
 */
function extractTtsBodyFromScriptBlock(raw: string): string {
  const t = raw.replace(/\r\n/g, "\n");
  const lines = t.split("\n");
  const zhengIdx = lines.findIndex((l) => l.trim() === "正文");
  let body: string;
  if (zhengIdx >= 0) {
    body = lines.slice(zhengIdx + 1).join("\n");
  } else {
    body = t;
  }
  return body.split(/\*-{2,}/)[0].trim();
}

/**
 * 与后端 user_media.resolve_media_url_to_path 一致：仅 /static-data/、用户素材库、系统分身模板。
 * 浏览器完整 URL（含 http://host:8000/static-data/...）会压成路径；file:// 本机路径丢弃（服务端不可读）。
 */
function normalizeComposeAssetUrl(raw: string | undefined | null): string | undefined {
  const u = (raw || "").trim();
  if (!u) return undefined;
  if (u.toLowerCase().startsWith("file:")) return undefined;
  const noQuery = u.split("?")[0].trim();
  if (noQuery.startsWith("/static-data/")) return noQuery;
  if (noQuery.startsWith("/api/user-library/media/")) return noQuery;
  if (noQuery.startsWith("/api/avatar/system-templates/raw/")) return noQuery;
  const low = noQuery.toLowerCase();
  const i = low.indexOf("/static-data/");
  if (i >= 0) return noQuery.slice(i);
  const j = noQuery.indexOf("/api/user-library/media/");
  if (j >= 0) return noQuery.slice(j);
  const k = noQuery.indexOf("/api/avatar/system-templates/raw/");
  if (k >= 0) return noQuery.slice(k);
  return undefined;
}

function buildComposeInsertMediaUrls(paths: string[]): { urls: string[]; skipped: number } {
  let skipped = 0;
  const urls: string[] = [];
  for (const p of paths) {
    const n = normalizeComposeAssetUrl(p);
    if (n) urls.push(n);
    else if ((p || "").trim()) skipped += 1;
  }
  return { urls, skipped };
}

/** 将本地选择的文件上传到后端，得到 compose 可用的 /static-data/ 或用户库 URL（浏览器无法把本机路径传给服务器）。 */
async function uploadInsertMediaToServer(file: File): Promise<string> {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const videoExts = new Set(["mp4", "mov", "mkv", "webm"]);
  const fd = new FormData();
  fd.append("file", file);

  if (videoExts.has(ext)) {
    const res = await fetch(`${API_BASE}/api/assets/upload-video`, {
      method: "POST",
      body: fd,
    });
    if (!res.ok) throw new Error(await res.text());
    const data = (await res.json()) as { video_url?: string };
    if (!data.video_url) throw new Error("上传成功但未返回 video_url");
    return data.video_url;
  }

  const res = await fetch(`${API_BASE}/api/assets/upload-image?compose_insert=true`, {
    method: "POST",
    body: fd,
  });
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as { video_url?: string; image_url?: string };
  const u = data.video_url || data.image_url;
  if (!u) throw new Error("上传成功但未返回素材 URL");
  return u;
}

// --- Shared IP brain + pipeline helpers (align with workbench.js) ---

export function parseTargetDurationInput(s: string): { min: number | null; max: number | null } {
  const t = (s || "").trim();
  if (!t) return { min: null, max: null };
  const m = t.match(/^(\d+)\s*[-–~]\s*(\d+)$/);
  if (m) {
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  const n = parseInt(t, 10);
  if (!Number.isNaN(n)) return { min: n, max: null };
  return { min: null, max: null };
}

export type IpBrainVariantRow = {
  title: string;
  subtitle_script: string;
  keywords: string[];
  target_seconds: number;
};

function buildIpBrainGenerateBody(args: {
  sourceUrl: string;
  sourceText: string;
  durationStr: string;
  productionCount: number;
  /** 勾选「自定义提示词」时须非空，否则返回 ok: false */
  customPromptEnabled?: boolean;
  customPrompt?: string;
}): { ok: true; body: Record<string, unknown> } | { ok: false; error: string } {
  const td = parseTargetDurationInput(args.durationStr);
  let pc = Math.min(50, Math.max(1, args.productionCount || 1));
  if (Number.isNaN(pc)) pc = 1;
  if (pc > 1 && td.min == null) {
    return {
      ok: false,
      error: "批量生成（生产数量>1）时必须填写目标时长：如单值 75 或区间 20-35。",
    };
  }
  if (args.customPromptEnabled && !(args.customPrompt || "").trim()) {
    return {
      ok: false,
      error: "已勾选「自定义提示词」，请先填写提示词内容。",
    };
  }
  const body: Record<string, unknown> = {
    source_url: args.sourceUrl.trim() || null,
    source_text: args.sourceText,
    target_seconds: td.min != null ? td.min : null,
    target_seconds_max: td.max != null ? td.max : null,
    production_count: pc,
    tone: "fast_boom",
  };
  if (args.customPromptEnabled && (args.customPrompt || "").trim()) {
    body.custom_prompt = (args.customPrompt || "").trim();
  }
  return { ok: true, body };
}

function parseGenerateResponse(data: Record<string, unknown>): {
  variants: IpBrainVariantRow[];
  keywords: string[];
} {
  const rawVariants = (data.variants || []) as Array<Record<string, unknown>>;
  const topKeywords = (data.keywords || []) as string[];
  if (rawVariants.length > 0) {
    const variants: IpBrainVariantRow[] = rawVariants.map((v) => ({
      title: String(v.title || ""),
      subtitle_script: String(v.subtitle_script || ""),
      keywords: Array.isArray(v.keywords) ? (v.keywords as string[]) : [],
      target_seconds: typeof v.target_seconds === "number" ? v.target_seconds : Number(v.target_seconds) || 0,
    }));
    return {
      variants,
      keywords: topKeywords.length ? topKeywords : variants[0]?.keywords || [],
    };
  }
  const script = String(data.script || data.subtitle_script || "");
  const title = String(data.title || "");
  return {
    variants: [
      {
        title,
        subtitle_script: script,
        keywords: topKeywords,
        target_seconds: 0,
      },
    ],
    keywords: topKeywords,
  };
}

async function apiIpBrainExtract(
  sourceUrl: string,
  signal?: AbortSignal
): Promise<{ source_text: string; keywords?: string[]; hashtags?: string[] }> {
  let extractRes: Response;
  let extractBodyText: string;
  try {
    extractRes = await fetch(`${API_BASE}/api/ipbrain/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_url: sourceUrl }),
      signal,
    });
    extractBodyText = await extractRes.text();
  } catch (netErr) {
    throw netErr;
  }
  if (!extractRes.ok) throw new Error(`文案提取失败: ${extractBodyText}`);
  return JSON.parse(extractBodyText) as { source_text: string; keywords?: string[]; hashtags?: string[] };
}

async function apiIpBrainGenerate(
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  const rewriteRes = await fetch(`${API_BASE}/api/ipbrain/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!rewriteRes.ok) throw new Error(`文案创作失败: ${await rewriteRes.text()}`);
  return rewriteRes.json();
}

/** 与后端 ChanjingApiOverride 对齐；同时填 AppId+Secret 时本次请求覆盖服务端 .env */
type ChanjingApiPayload = {
  chanjing_app_id: string;
  chanjing_secret_key: string;
  chanjing_openapi_base_url?: string;
};

async function apiTtsSynthesize(args: {
  text: string;
  voice: string;
  hq: boolean;
  signal?: AbortSignal;
  chanjingApi?: ChanjingApiPayload;
}): Promise<{ audio_url: string; tts_engine?: string; hq?: boolean }> {
  const body: Record<string, unknown> = {
    text: args.text,
    voice: args.voice,
    hq: args.hq,
  };
  if (args.chanjingApi) body.chanjing_api = args.chanjingApi;
  const ttsRes = await fetch(`${API_BASE}/api/tts/synthesize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: args.signal,
  });
  if (!ttsRes.ok) throw new Error(`TTS合成失败: ${await ttsRes.text()}`);
  return ttsRes.json();
}

/** 步骤3 分身：系统对口型（wav2lip 等）| 蝉镜 */
type AvatarModeKind = "wav2lip" | "chanjing";

async function apiAvatarRender(args: {
  audio_url: string;
  template_video_url: string;
  avatarMode: AvatarModeKind;
  signal?: AbortSignal;
  chanjingApi?: ChanjingApiPayload;
}): Promise<{ video_url: string }> {
  const useCj = args.avatarMode === "chanjing";
  const body: Record<string, unknown> = {
    audio_url: args.audio_url,
    template_video_url: args.template_video_url,
    width: 480,
    height: 864,
    fps: 30,
    use_chanjing_lip_sync: useCj,
    use_liveportrait_comfy: false,
  };
  if (args.chanjingApi) body.chanjing_api = args.chanjingApi;
  const renderRes = await fetch(`${API_BASE}/api/avatar/render`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: args.signal,
  });
  if (!renderRes.ok) throw new Error(`分身渲染失败: ${await renderRes.text()}`);
  return renderRes.json();
}

const COMPOSE_POLL_MS = 2000;
/** 约 30 分钟；避免任务异常时前端永久「生成中」 */
const COMPOSE_POLL_MAX_ROUNDS = 900;

async function pollComposeJobUntilDone(
  jobId: string,
  isCancelled: () => boolean,
  onTick?: (progress: number | null, stage: string | null) => void
): Promise<{ video_url?: string; video_path?: string }> {
  for (let round = 0; round < COMPOSE_POLL_MAX_ROUNDS; round++) {
    if (isCancelled()) throw new Error("已取消");
    await new Promise((r) => setTimeout(r, COMPOSE_POLL_MS));
    if (isCancelled()) throw new Error("已取消");
    const statusRes = await fetch(`${API_BASE}/api/video/compose/jobs/${jobId}`);
    if (!statusRes.ok) {
      const t = await statusRes.text();
      throw new Error(`查询合成任务失败 (${statusRes.status}): ${t.slice(0, 400)}`);
    }
    const statusData = (await statusRes.json()) as {
      status?: string;
      progress?: number | null;
      stage?: string | null;
      detail?: string | null;
    };
    onTick?.(
      typeof statusData.progress === "number" ? statusData.progress : null,
      statusData.stage ?? null
    );
    const st = statusData.status;
    if (st === "done") {
      return statusData as { video_url?: string; video_path?: string };
    }
    if (st === "error") {
      throw new Error(`合成失败: ${statusData.detail || ""}`);
    }
    if (st === "cancelled") {
      throw new Error("合成已取消");
    }
  }
  throw new Error("合成等待超时（请查看后端日志或重试）");
}

/** 受控并发：results[i] 与 items[i] 对齐，下标与串行 for 循环一致 */
async function poolMap<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const n = items.length;
  const results: R[] = new Array(n);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = nextIndex++;
      if (i >= n) return;
      results[i] = await fn(items[i], i);
    }
  }
  const c = Math.max(1, Math.min(Math.max(1, concurrency), n));
  await Promise.all(Array.from({ length: c }, () => worker()));
  return results;
}

// Pipeline step status
type StepStatus = "idle" | "running" | "done" | "error";

// Log entry
type LogEntry = {
  time: string;
  message: string;
  type: "info" | "success" | "error" | "warn";
};

type ProducerView = "auto" | "step";

/** GET /api/system/gpu */
type GpuApiPayload = {
  ok: boolean;
  available: boolean;
  gpus: Array<{
    index: number | string;
    name: string;
    driver_version: string;
    memory_total_mib: number | null;
    memory_used_mib: number | null;
    utilization_gpu_percent: number | null;
    utilization_memory_percent: number | null;
    temperature_c: number | null;
    power_draw_w: number | null;
  }>;
  error?: string | null;
  queried_at?: string;
  /** .env FFMPEG_VIDEO_ENCODER，如 auto */
  ffmpeg_video_encoder_setting?: string;
  /** 与步骤4 成片同源：h264_nvenc | libx264 */
  compose_video_encoder_effective?: string;
  ffmpeg_build_has_h264_nvenc?: boolean;
  nvenc_runtime_probe_ok?: boolean;
  compose_hwaccel_cuda_setting?: string;
  compose_hwaccel_cuda_effective?: boolean;
  compose_burn_subtitles_into_video?: boolean;
};

function AutoProducer() {
  const { pathname: routePathname } = useLocation();
  const routeBase = (routePathname || "/").replace(/\/$/, "") || "/";
  const isAdminRoute = routeBase === "/admin";

  /** /auto-producer 固定分步；/admin 固定全自动（与「左侧导航切换」解耦） */
  const [activeView, setActiveView] = useState<ProducerView>(() => {
    if (typeof window === "undefined") return "step";
    const p = (window.location.pathname || "/").replace(/\/$/, "") || "/";
    return p === "/admin" ? "auto" : "step";
  });

  useEffect(() => {
    const p = (routePathname || "/").replace(/\/$/, "") || "/";
    if (p === "/admin") setActiveView("auto");
    else setActiveView("step");
  }, [routePathname]);
  // Step 1: URL
  const [url, setUrl] = useState(() => localStorage.getItem("ap_url") || "");
  const [urlInput, setUrlInput] = useState(url);

  // Step 2: Audio mode
  const [audioMode, setAudioMode] = useState<"local" | "api">(
    (localStorage.getItem("ap_audio_mode") as "local" | "api") || "api"
  );

  // Step 3: Avatar mode（系统对口型 | 蝉镜）
  const [avatarMode, setAvatarMode] = useState<AvatarModeKind>(() => {
    const raw = localStorage.getItem("ap_avatar_mode");
    if (raw === "chanjing") return "chanjing";
    if (raw === "liveportrait") return "wav2lip";
    if (raw === "wav2lip") return "wav2lip";
    if (raw === "local") return "wav2lip";
    return "wav2lip";
  });

  // Step 4: Voice
  const [voice, setVoice] = useState(
    localStorage.getItem("ap_voice") || "zh-CN-XiaoxiaoNeural"
  );
  const [voiceUploadId, setVoiceUploadId] = useState<string | null>(() =>
    localStorage.getItem("ap_voice_upload_id")
  );
  const [voiceUploadProgress, setVoiceUploadProgress] = useState<string | null>(null);

  // Step 5: Duration
  const [duration, setDuration] = useState(
    localStorage.getItem("ap_duration") || "60"
  );

  // Step 6: Banner
  const [banner, setBanner] = useState(
    localStorage.getItem("ap_banner") || ""
  );

  // Step 7: Media files
  const [mediaFiles, setMediaFiles] = useState<string[]>(() => {
    const saved = localStorage.getItem("ap_media");
    return saved ? JSON.parse(saved) : [];
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stepInsertFileRef = useRef<HTMLInputElement>(null);

  // Pipeline status
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [stepStatuses, setStepStatuses] = useState<Record<string, StepStatus>>({
    step1_extract: "idle",
    step2_rewrite: "idle",
    step3_tts: "idle",
    step4_avatar: "idle",
    step5_compose: "idle",
  });
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [finalVideo, setFinalVideo] = useState<string | null>(null);
  const [finalError, setFinalError] = useState<string | null>(null);

  // Progress
  const [progress, setProgress] = useState(0);

  const [stepFlowRunning, setStepFlowRunning] = useState(false);
  /** 分步：取消长任务（TTS/分身/合成轮询） */
  const stepFlowCancelledRef = useRef(false);
  const stepFlowAbortRef = useRef<AbortController | null>(null);
  /** 分步步骤4：可能并行多路 compose job，取消时需全部 POST cancel */
  const stepComposeActiveJobIdsRef = useRef<Set<string>>(new Set());
  /** 自动流水线：停止按钮 */
  const pipelineCancelledRef = useRef(false);
  const activeComposeJobIdRef = useRef<string | null>(null);

  const [stepFlow, setStepFlow] = useState(() => {
    try {
      const raw = localStorage.getItem("ap_step_flow");
      if (raw) {
        const o = JSON.parse(raw) as Record<string, string>;
        return {
          script: o.script || "",
          title: o.title || "",
          audioUrl: o.audioUrl || "",
          avatarUrl: o.avatarUrl || "",
          finalVideoUrl: o.finalVideoUrl || "",
          finalJobId: o.finalJobId || "",
        };
      }
    } catch {
      /* ignore */
    }
    return {
      script: "",
      title: "",
      audioUrl: "",
      avatarUrl: "",
      finalVideoUrl: "",
      finalJobId: "",
    };
  });

  const [productionCount, setProductionCount] = useState(() => {
    const s = localStorage.getItem("ap_production_count");
    const n = parseInt(s || "1", 10);
    if (Number.isNaN(n) || n < 1) return 1;
    return Math.min(50, n);
  });

  /** 步骤1「再创作」：勾选后与原文案一并传给 LLM */
  const [step1CustomPromptEnabled, setStep1CustomPromptEnabled] = useState(
    () => localStorage.getItem("ap_step1_custom_prompt_enabled") === "1"
  );
  const [step1CustomPrompt, setStep1CustomPrompt] = useState(
    () => localStorage.getItem("ap_step1_custom_prompt") || ""
  );

  const [stepExtractedText, setStepExtractedText] = useState(
    () => localStorage.getItem("ap_step_extracted_text") || ""
  );
  const [stepKeywords, setStepKeywords] = useState<string[]>(() => {
    try {
      const s = localStorage.getItem("ap_step_keywords");
      return s ? JSON.parse(s) : [];
    } catch {
      return [];
    }
  });
  const step1TopicLabels = useMemo(() => {
    if (stepKeywords.length > 0) return normalizeHashtagLabels(stepKeywords);
    return normalizeHashtagLabels(extractHashtagLabelsFromLine(stepExtractedText));
  }, [stepKeywords, stepExtractedText]);
  const [stepVariants, setStepVariants] = useState<IpBrainVariantRow[]>(() => {
    try {
      const s = localStorage.getItem("ap_step_variants");
      return s ? JSON.parse(s) : [];
    } catch {
      return [];
    }
  });
  /** 分步：当前口播正文，每条独立输入框；与再创作条数、步骤2 多条音频一一对应 */
  const [stepScriptLines, setStepScriptLines] = useState<string[]>(() => loadStepScriptLinesInitial());
  const [stepAudioUrls, setStepAudioUrls] = useState<string[]>(() =>
    loadStepAudioUrlsInitial(loadStepScriptLinesInitial().length)
  );
  /** 步骤3：仅一条分身口播成品（由勾选的步骤2 单条音频 + 模板生成） */
  const [step3AvatarVideoUrl, setStep3AvatarVideoUrl] = useState<string>(() => loadStep3AvatarVideoUrlInitial());
  /** 步骤2 多音频中，用于步骤3/4（有分身时）的那一条下标（单选） */
  const [step3SelectedAudioIndex, setStep3SelectedAudioIndex] = useState<number>(() =>
    loadStep3SelectedAudioIndexInitial(loadStepScriptLinesInitial().length)
  );
  /** 步骤4 最近一次批量混剪输出的成片路径（用于预览列表；刷新后从 localStorage 恢复） */
  const [step4BatchVideoUrls, setStep4BatchVideoUrls] = useState<string[]>(loadStep4BatchVideoUrlsInitial);

  /** 插入素材：上传中 / 每文件一行「时间 + 成功或失败 + 文件名」 */
  const [insertMediaUploading, setInsertMediaUploading] = useState(false);
  const [insertMediaStatusLines, setInsertMediaStatusLines] = useState<string[]>([]);

  /** 步骤2/3/4 生产成功后，按钮右侧显示「时间 + 完成」 */
  const [step2DoneHint, setStep2DoneHint] = useState<string | null>(null);
  const [step3DoneHint, setStep3DoneHint] = useState<string | null>(null);
  const [step4DoneHint, setStep4DoneHint] = useState<string | null>(loadStep4DoneHintInitial);

  /** 步骤5：手机发布（USB 安卓 + adb；与网页抖音矩阵号独立） */
  const [step5PathsText, setStep5PathsText] = useState(
    () => localStorage.getItem("ap_step5_paths_text") || ""
  );
  const [phoneDevices, setPhoneDevices] = useState<PhoneDeviceRow[]>(loadStep5PhoneDevices);
  const [, setPhoneAccounts] = useState<PhoneDouyinAccountRow[]>(loadStep5PhoneAccounts);
  const [step5Busy, setStep5Busy] = useState<string | null>(null);
  const [step5LastNote, setStep5LastNote] = useState<string | null>(null);
  /** 每行一条发布用 #话题（可编辑；行数与成片路径、勾选设备数一致） */
  const [step5HashtagLinesText, setStep5HashtagLinesText] = useState(loadStep5HashtagLinesText);
  /** 按 serial 备注、是否参与本次发布（默认勾选） */
  const [step5DeviceMeta, setStep5DeviceMeta] = useState<Record<string, Step5DeviceMeta>>(loadStep5DeviceMeta);

  /** 步骤5 手机发布：默认隐藏，访问码 0000 解锁（sessionStorage，关闭标签页后失效） */
  const [step5AdminUnlocked, setStep5AdminUnlocked] = useState(() => {
    try {
      return typeof sessionStorage !== "undefined" && sessionStorage.getItem("ap_step5_admin_unlocked") === "1";
    } catch {
      return false;
    }
  });
  const [step5AdminPinInput, setStep5AdminPinInput] = useState("");
  const [step5AdminPinError, setStep5AdminPinError] = useState("");

  const step5PathLines = useMemo(
    () =>
      step5PathsText
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0),
    [step5PathsText]
  );

  const step5HashtagLines = useMemo(
    () =>
      step5HashtagLinesText
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0),
    [step5HashtagLinesText]
  );

  /** 当前勾选参与发布的设备 serial（顺序与扫描列表一致） */
  const step5SelectedDeviceSerials = useMemo(() => {
    return phoneDevices
      .filter((d) => step5DeviceMeta[d.serial]?.selected !== false)
      .map((d) => d.serial);
  }, [phoneDevices, step5DeviceMeta]);

  /**
   * 执行顺序预览：序号 · 设备名 · 发布文案行 · 文件名（与手机发布任务一一对应）
   */
  const step5MissionBoardRows = useMemo(() => {
    const paths = step5PathLines;
    const serials = step5SelectedDeviceSerials;
    if (paths.length === 0 || paths.length !== serials.length) return null;
    return paths.map((pathLine, i) => {
      const serial = serials[i] ?? "";
      const dev = phoneDevices.find((d) => d.serial === serial);
      const deviceLabel = (dev?.model || dev?.serial || serial).trim() || serial.slice(-8);
      const rawTagLines = step5HashtagLinesText.split("\n");
      const rawLine = (rawTagLines[i] ?? "").trim();
      const hashtagLine = buildTopicCaptionForPublish(banner, rawLine) || rawLine || "—";
      return {
        index: i + 1,
        deviceLabel,
        hashtagLine,
        fileName: basenameFromUrlOrPath(pathLine),
        pathLine,
      };
    });
  }, [
    step5PathLines,
    step5SelectedDeviceSerials,
    phoneDevices,
    step5HashtagLinesText,
    banner,
  ]);

  /** 成片数、发布文案行数、勾选设备数是否一致（多机发布前提；每行须含恰好 5 个 #话题；横幅取自步骤4） */
  const step5PublishCountsOk = useMemo(() => {
    const nPath = step5PathLines.length;
    const nDev = step5SelectedDeviceSerials.length;
    if (nPath < 1 || nDev < 1) return false;
    if (nPath !== nDev) return false;
    const htLines = step5HashtagLinesText.split("\n");
    for (let i = 0; i < nPath; i++) {
      const pr = parseStep5TopicLineHashtagsOnly(htLines[i] ?? "");
      if (!pr.ok) return false;
    }
    return true;
  }, [step5PathLines.length, step5SelectedDeviceSerials.length, step5HashtagLinesText]);

  /** 扫描结果或本地缓存加载后，为每台设备补默认勾选与备注槽 */
  useEffect(() => {
    if (phoneDevices.length === 0) return;
    setStep5DeviceMeta((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const d of phoneDevices) {
        if (next[d.serial] === undefined) {
          next[d.serial] = { note: "", selected: true };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [phoneDevices]);

  /** 步骤4：false=用分身（步骤3 + 素材）；true=不用分身（仅步骤2 音频 + 上传素材混剪）。持久化 ap_step_compose_no_avatar */
  const [stepComposeNoAvatar, setStepComposeNoAvatar] = useState(
    () => localStorage.getItem("ap_step_compose_no_avatar") === "1"
  );

  const [avatarTemplateVideoUrl, setAvatarTemplateVideoUrl] = useState<string | null>(
    () => localStorage.getItem("ap_avatar_template_url")
  );
  const [avatarTemplates, setAvatarTemplates] = useState<SystemAvatarTemplateRow[]>([]);

  /** 请求体 use_proxy_media；需后端 compose_proxy_* 与代理文件，出错时可勾选重试 */
  const [step4ComposeUseProxyMedia, setStep4ComposeUseProxyMedia] = useState(
    () => localStorage.getItem("ap_compose_use_proxy_media") === "1"
  );

  /** 步骤4 成片：weak=弱特效（默认）；none=不叠加服务端弱滤镜与镜间转场 */
  const [step4ComposeEffectsMode, setStep4ComposeEffectsMode] = useState<"weak" | "none">(() => {
    const v = localStorage.getItem("ap_step4_compose_effects_mode");
    return v === "none" ? "none" : "weak";
  });

  /** 步骤3「上传分身模版」：勿用 stepFlowRunning，否则会整页禁用导致交互异常 */
  const [avatarTemplateUploadBusy, setAvatarTemplateUploadBusy] = useState(false);
  const [avatarTemplateUploadHint, setAvatarTemplateUploadHint] = useState("");

  /** 可选：请求级蝉镜 OpenAPI 凭据（步骤2 hq 蝉镜 TTS / 步骤3 蝉镜对口型共用，覆盖服务端 .env） */
  /** 外部蝉镜：仅 ID + API 密钥两项，保存后步骤2/3 自动用该账号调蝉镜（覆盖服务端 .env） */
  const [chanjingAppId, setChanjingAppId] = useState(() => localStorage.getItem("ap_chanjing_app_id") || "");
  const [chanjingSecretKey, setChanjingSecretKey] = useState(
    () => localStorage.getItem("ap_chanjing_secret_key") || ""
  );

  const chanjingApiPayload = useMemo((): ChanjingApiPayload | undefined => {
    const a = chanjingAppId.trim();
    const s = chanjingSecretKey.trim();
    if (!a || !s) return undefined;
    return {
      chanjing_app_id: a,
      chanjing_secret_key: s,
    };
  }, [chanjingAppId, chanjingSecretKey]);

  /** 服务器 GPU 状态（/api/system/gpu，约每 12 秒刷新） */
  const [gpuMonitor, setGpuMonitor] = useState<GpuApiPayload | null>(null);

  useEffect(() => {
    localStorage.setItem("ap_active_view", activeView);
  }, [activeView]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/system/gpu`);
        if (!res.ok) {
          if (!cancelled) {
            setGpuMonitor({
              ok: false,
              available: false,
              gpus: [],
              error: `HTTP ${res.status}`,
            });
          }
          return;
        }
        const data = (await res.json()) as GpuApiPayload;
        if (!cancelled) setGpuMonitor(data);
      } catch {
        if (!cancelled) {
          setGpuMonitor({
            ok: false,
            available: false,
            gpus: [],
            error: "无法连接后端",
          });
        }
      }
    };
    void tick();
    const id = window.setInterval(tick, 12000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  /** 切换到蝉镜模式时，若当前为 Edge 预设音色则自动切到乐葵（避免无效选项） */
  useEffect(() => {
    if (audioMode === "api" && EDGE_PRESET_VOICE_VALUES.has(voice)) {
      setVoice("lekui");
    }
  }, [audioMode, voice]);

  // Save to localStorage on change
  useEffect(() => {
    localStorage.setItem("ap_url", url);
    localStorage.setItem("ap_audio_mode", audioMode);
    localStorage.setItem("ap_avatar_mode", avatarMode);
    localStorage.setItem("ap_voice", voice);
    localStorage.setItem("ap_duration", duration);
    localStorage.setItem("ap_banner", banner);
    localStorage.setItem("ap_media", JSON.stringify(mediaFiles));
    localStorage.setItem("ap_production_count", String(productionCount));
    localStorage.setItem("ap_step1_custom_prompt_enabled", step1CustomPromptEnabled ? "1" : "0");
    localStorage.setItem("ap_step1_custom_prompt", step1CustomPrompt);
    localStorage.setItem("ap_step_extracted_text", stepExtractedText);
    localStorage.setItem("ap_step_keywords", JSON.stringify(stepKeywords));
    localStorage.setItem("ap_step_variants", JSON.stringify(stepVariants));
    localStorage.setItem("ap_step_script_lines", JSON.stringify(stepScriptLines));
    localStorage.setItem("ap_step_audio_urls", JSON.stringify(stepAudioUrls));
    localStorage.setItem("ap_step3_avatar_video_url", step3AvatarVideoUrl);
    localStorage.setItem("ap_step3_selected_audio_idx", String(step3SelectedAudioIndex));
    localStorage.setItem("ap_step_compose_no_avatar", stepComposeNoAvatar ? "1" : "0");
    localStorage.setItem("ap_compose_use_proxy_media", step4ComposeUseProxyMedia ? "1" : "0");
    localStorage.setItem(LS_STEP4_BATCH_VIDEO_URLS, JSON.stringify(step4BatchVideoUrls));
    if (step4DoneHint) localStorage.setItem(LS_STEP4_DONE_HINT, step4DoneHint);
    else localStorage.removeItem(LS_STEP4_DONE_HINT);
    localStorage.setItem("ap_step5_paths_text", step5PathsText);
    localStorage.setItem(LS_STEP5_HASHTAG_LINES, step5HashtagLinesText);
    localStorage.setItem(LS_STEP5_DEVICE_META, JSON.stringify(step5DeviceMeta));
    if (avatarTemplateVideoUrl) localStorage.setItem("ap_avatar_template_url", avatarTemplateVideoUrl);
    else localStorage.removeItem("ap_avatar_template_url");
    localStorage.setItem(
      "ap_step_flow",
      JSON.stringify({
        script: stepScriptLines[0] ?? stepFlow.script,
        title: stepFlow.title,
        audioUrl: stepFlow.audioUrl,
        avatarUrl: stepFlow.avatarUrl,
        finalVideoUrl: stepFlow.finalVideoUrl,
        finalJobId: stepFlow.finalJobId,
      })
    );
    if (voiceUploadId) localStorage.setItem("ap_voice_upload_id", voiceUploadId);
    else localStorage.removeItem("ap_voice_upload_id");
    localStorage.setItem("ap_chanjing_app_id", chanjingAppId);
    localStorage.setItem("ap_chanjing_secret_key", chanjingSecretKey);
  }, [
    url,
    audioMode,
    avatarMode,
    voice,
    chanjingAppId,
    chanjingSecretKey,
    duration,
    banner,
    mediaFiles,
    productionCount,
    step1CustomPromptEnabled,
    step1CustomPrompt,
    stepExtractedText,
    stepKeywords,
    stepVariants,
    stepScriptLines,
    stepAudioUrls,
    step3AvatarVideoUrl,
    step3SelectedAudioIndex,
    stepComposeNoAvatar,
    step4ComposeUseProxyMedia,
    step4BatchVideoUrls,
    step4DoneHint,
    step5PathsText,
    step5HashtagLinesText,
    step5DeviceMeta,
    avatarTemplateVideoUrl,
    stepFlow,
    voiceUploadId,
  ]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/avatar/system-templates/list`);
        const data = (await res.json()) as { templates?: SystemAvatarTemplateRow[] };
        if (cancelled) return;
        const list = Array.isArray(data.templates) ? data.templates : [];
        setAvatarTemplates(list);
        if (list.length === 0) return;
        setAvatarTemplateVideoUrl((prev) => {
          if (prev) return prev;
          return list[0].video_url;
        });
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** 按当前选中的步骤2 音频行同步步骤流展示（步骤3/4 有分身时共用该条） */
  useEffect(() => {
    const i = step3SelectedAudioIndex;
    const script = stepScriptLines[i] ?? stepScriptLines[0] ?? "";
    const au = stepAudioUrls[i] || "";
    const av = step3AvatarVideoUrl.trim();
    const v = stepVariants[i] ?? stepVariants[0];
    setStepFlow((prev) => ({
      ...prev,
      script,
      audioUrl: au,
      avatarUrl: av,
      title: v?.title != null ? String(v.title) : "",
    }));
  }, [stepAudioUrls, step3AvatarVideoUrl, step3SelectedAudioIndex, stepScriptLines, stepVariants]);

  /** 步骤2 音频列表变化时：校正选中下标，并保证指向仍有音频的条目 */
  useEffect(() => {
    setStep3SelectedAudioIndex((prev) => {
      const n = stepAudioUrls.length;
      if (n === 0) return 0;
      let idx = Math.min(Math.max(0, prev), n - 1);
      if (!stepAudioUrls[idx]?.trim()) {
        const first = stepAudioUrls.findIndex((u) => (u || "").trim());
        idx = first >= 0 ? first : 0;
      }
      return idx;
    });
  }, [stepAudioUrls]);

  useEffect(() => {
    localStorage.setItem("ap_step4_compose_effects_mode", step4ComposeEffectsMode);
  }, [step4ComposeEffectsMode]);

  // Add log entry
  const addLog = useCallback((message: string, type: LogEntry["type"] = "info") => {
    const now = new Date();
    const time = now.toLocaleTimeString("zh-CN", { hour12: false });
    setLogs((prev) => [...prev, { time, message, type }]);
  }, []);

  /** 步骤2 每条已生成音频的播放倍速（与 stepAudioUrls 下标对齐） */
  const [stepAudioPlaybackRates, setStepAudioPlaybackRates] = useState<number[]>([]);
  const stepAudioElementsRef = useRef<(HTMLAudioElement | null)[]>([]);
  useEffect(() => {
    const n = Math.max(stepAudioUrls.length, 1);
    setStepAudioPlaybackRates((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push(1);
      return next;
    });
    stepAudioElementsRef.current.length = n;
  }, [stepAudioUrls.length]);

  /** 删除步骤1 某条口播：同步文案 / 音频 URL / 变体，至少保留一行 */
  const removeStepScriptLine = useCallback(
    (index: number) => {
      setStepScriptLines((lines) => {
        if (lines.length <= 1) return lines;
        return lines.filter((_, j) => j !== index);
      });
      setStepAudioUrls((urls) => urls.filter((_, j) => j !== index));
      setStepVariants((vars) => vars.filter((_, j) => j !== index));
      setStep3AvatarVideoUrl("");
      setStep3SelectedAudioIndex((prev) => {
        if (index < prev) return prev - 1;
        if (index === prev) return Math.max(0, prev - 1);
        return prev;
      });
      addLog(`已删除第 ${index + 1} 条口播文案及对应音频槽位（步骤3 分身需重新生成）`, "info");
    },
    [addLog]
  );

  /** 仅清除某条已生成的音频（文案保留，可重新点「生成音频」） */
  const clearStepAudioAt = useCallback(
    (index: number) => {
      setStepAudioUrls((prev) => {
        const next = [...prev];
        if (index >= 0 && index < next.length) next[index] = "";
        return next;
      });
      if (index === step3SelectedAudioIndex) setStep3AvatarVideoUrl("");
      addLog(`已清除第 ${index + 1} 条音频（文案仍在，可重新生成）`, "info");
    },
    [addLog, step3SelectedAudioIndex]
  );

  const clearAllStep1Content = useCallback(() => {
    if (
      !window.confirm(
        "确定清空提取原文、关键词、全部口播正文与已记录的生成音频？（不影响已上传的乐葵样本 ID）"
      )
    ) {
      return;
    }
    setStepExtractedText("");
    setStepKeywords([]);
    setStepScriptLines([""]);
    setStepAudioUrls([""]);
    setStep3AvatarVideoUrl("");
    setStep3SelectedAudioIndex(0);
    setStepVariants([]);
    setStep4BatchVideoUrls([]);
    setStep4DoneHint(null);
    setStepFlow((prev) => ({ ...prev, script: "", title: "", audioUrl: "", avatarUrl: "" }));
    addLog("已清空步骤1 文案相关与步骤2 音频 URL 记录", "info");
  }, [addLog]);

  // Update step status
  const updateStepStatus = useCallback((step: string, status: StepStatus) => {
    setStepStatuses((prev) => ({ ...prev, [step]: status }));
  }, []);

  // Reset pipeline state（新一次「开始创作」前清空）
  const resetPipeline = useCallback(() => {
    pipelineCancelledRef.current = false;
    activeComposeJobIdRef.current = null;
    setPipelineRunning(false);
    setCurrentStep(null);
    setStepStatuses({
      step1_extract: "idle",
      step2_rewrite: "idle",
      step3_tts: "idle",
      step4_avatar: "idle",
      step5_compose: "idle",
    });
    setLogs([]);
    setFinalVideo(null);
    setFinalError(null);
    setProgress(0);
  }, []);

  const stopPipelineRun = useCallback(() => {
    pipelineCancelledRef.current = true;
    const jid = activeComposeJobIdRef.current;
    if (jid) {
      void fetch(`${API_BASE}/api/video/compose/jobs/${jid}/cancel`, { method: "POST" });
      activeComposeJobIdRef.current = null;
    }
    addLog("已请求停止自动流水线（若正在合成将取消或忽略成片）", "warn");
    setPipelineRunning(false);
    setCurrentStep(null);
  }, [addLog]);

  const cancelStepFlow = useCallback(() => {
    stepFlowCancelledRef.current = true;
    stepFlowAbortRef.current?.abort();
    const ids = stepComposeActiveJobIdsRef.current;
    for (const jid of ids) {
      void fetch(`${API_BASE}/api/video/compose/jobs/${jid}/cancel`, { method: "POST" });
    }
    ids.clear();
    addLog("已请求取消当前分步任务", "warn");
    setStepFlowRunning(false);
  }, [addLog]);

  const fetchPhoneDevices = useCallback(async () => {
    setStep5Busy("devices");
    setStep5LastNote(null);
    try {
      const res = await fetch(`${API_BASE}/api/phone-publish/devices`);
      const raw = await res.text();
      let data: { devices?: PhoneDeviceRow[]; warning?: string | null; detail?: string };
      try {
        data = JSON.parse(raw) as typeof data;
      } catch {
        throw new Error(raw.slice(0, 200));
      }
      if (!res.ok) {
        throw new Error(data.detail || raw.slice(0, 300));
      }
      const devs = data.devices ?? [];
      setPhoneDevices(devs);
      setStep5DeviceMeta((prev) => {
        const next = { ...prev };
        for (const d of devs) {
          if (next[d.serial] === undefined) {
            next[d.serial] = { note: "", selected: true };
          }
        }
        return next;
      });
      try {
        localStorage.setItem(LS_STEP5_PHONE_DEVICES, JSON.stringify(devs));
      } catch {
        /* ignore quota */
      }
      if (data.warning) setStep5LastNote(data.warning);
      addLog(`步骤5：已刷新 USB 设备 ${devs.length} 台`, "info");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      addLog(`步骤5 扫描设备失败: ${msg}`, "error");
      setStep5LastNote(msg);
    } finally {
      setStep5Busy(null);
    }
  }, [addLog]);

  const scanPhoneDouyinAccounts = useCallback(async () => {
    if (step5SelectedDeviceSerials.length === 0) {
      addLog("步骤5：请先在下方设备列表中至少勾选一台要执行的手机", "error");
      return;
    }
    setStep5Busy("scan");
    setStep5LastNote(null);
    try {
      const serials = [...step5SelectedDeviceSerials];
      const res = await fetch(`${API_BASE}/api/phone-publish/scan-douyin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serials }),
      });
      const raw = await res.text();
      let data: { accounts?: PhoneDouyinAccountRow[]; note?: string; detail?: string };
      try {
        data = JSON.parse(raw) as typeof data;
      } catch {
        throw new Error(raw.slice(0, 200));
      }
      if (!res.ok) {
        throw new Error(data.detail || raw.slice(0, 300));
      }
      const accs = data.accounts ?? [];
      setPhoneAccounts(accs);
      try {
        localStorage.setItem(LS_STEP5_PHONE_ACCOUNTS, JSON.stringify(accs));
      } catch {
        /* ignore quota */
      }
      const note = data.note || "";
      if (note) setStep5LastNote(note);
      const okN = accs.filter((a) => !a.scan_error).length;
      addLog(`步骤5：扫描抖音完成，${okN}/${accs.length} 台已成功打开抖音`, "info");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      addLog(`步骤5 扫描抖音失败: ${msg}`, "error");
      setStep5LastNote(msg);
    } finally {
      setStep5Busy(null);
    }
  }, [addLog, step5SelectedDeviceSerials]);

  /** 将步骤4 最近一次本批成片路径（或仅有单条 finalVideoUrl 时）填入步骤5 成片路径框 */
  const importStep4OutputsToStep5Paths = useCallback(() => {
    const fromBatch = step4BatchVideoUrls.map((u) => (u || "").trim()).filter(Boolean);
    const single = (stepFlow.finalVideoUrl || "").trim();
    const urls = fromBatch.length > 0 ? fromBatch : single ? [single] : [];
    if (urls.length === 0) {
      addLog("步骤5：暂无步骤4 成品路径，请先完成步骤4 混剪。", "error");
      return;
    }
    setStep5PathsText(urls.join("\n"));
    addLog(`步骤5：已导入步骤4 ${urls.length} 条成品路径（已替换成片路径文本框）。`, "info");
  }, [step4BatchVideoUrls, stepFlow.finalVideoUrl, addLog]);

  /** 步骤5 POC：仅在已勾选设备上执行；先杀抖音进程再冷启动 →「+」→「相册」（不选片、不发布） */
  const pocPhonePublishEntry = useCallback(async () => {
    if (step5SelectedDeviceSerials.length === 0) {
      addLog("步骤5：请先在下方设备列表中至少勾选一台要执行的手机", "error");
      return;
    }
    setStep5Busy("poc");
    setStep5LastNote(null);
    try {
      const serials = [...step5SelectedDeviceSerials];
      const res = await fetch(`${API_BASE}/api/phone-publish/poc-publish-entry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serials }),
      });
      const raw = await res.text();
      let data: {
        results?: Array<{ device_serial?: string; ok?: boolean; message?: string }>;
        note?: string;
        detail?: string;
      };
      try {
        data = JSON.parse(raw) as typeof data;
      } catch {
        throw new Error(raw.slice(0, 200));
      }
      if (!res.ok) {
        throw new Error(data.detail || raw.slice(0, 300));
      }
      const list = data.results ?? [];
      const okCount = list.filter((r) => r.ok).length;
      const note = data.note || "";
      if (note) setStep5LastNote(note);
      addLog(
        `步骤5 POC：+→相册 流程完成（${okCount}/${list.length} 台成功）。`,
        okCount > 0 ? "success" : "warn",
      );
      for (const r of list) {
        addLog(
          `  [${r.device_serial}] ${r.ok ? "成功" : "失败"} ${(r.message || "").slice(0, 120)}`,
          r.ok ? "info" : "error",
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      addLog(`步骤5 POC 失败: ${msg}`, "error");
      setStep5LastNote(msg);
    } finally {
      setStep5Busy(null);
    }
  }, [addLog, step5SelectedDeviceSerials]);

  /** 请求服务端终止当前步骤5 长任务（扫描/POC/手机发布线程内协作式取消） */
  const abortPhonePublishAction = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/phone-publish/abort`, {
        method: "POST",
      });
      const raw = await res.text();
      let data: { ok?: boolean; message?: string; detail?: string };
      try {
        data = JSON.parse(raw) as typeof data;
      } catch {
        throw new Error(raw.slice(0, 200));
      }
      if (!res.ok) {
        throw new Error(data.detail || raw.slice(0, 300));
      }
      const msg = data.message || "已发送终止请求";
      addLog(`步骤5：${msg}`, "warn");
      setStep5LastNote(msg);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      addLog(`步骤5 终止请求失败: ${msg}`, "error");
      setStep5LastNote(msg);
    }
  }, [addLog]);

  /** 步骤5：adb push 成片 + 抖音内全流程；多机按序对齐：第 i 台 ↔ 成片第 i 行 ↔ 发布文案第 i 行（步骤4 横幅 + 5 个 #） */
  const publishPhoneOnDevice = useCallback(
    async (dryRun: boolean) => {
      if (step5PathLines.length === 0) {
        addLog("步骤5：请至少填写一行成片路径（/static-data/...）", "error");
        return;
      }
      for (let i = 0; i < step5PathLines.length; i++) {
        const pathErr = validateStep5PublishVideoPathLine(step5PathLines[i]);
        if (pathErr) {
          addLog(`步骤5：第 ${i + 1} 行成片路径格式错误：${pathErr}`, "error");
          return;
        }
      }
      if (step5SelectedDeviceSerials.length === 0) {
        addLog("步骤5：请至少勾选一台发布设备", "error");
        return;
      }
      if (step5PathLines.length !== step5SelectedDeviceSerials.length) {
        addLog(
          `步骤5：成片路径行数（${step5PathLines.length}）须与勾选设备数（${step5SelectedDeviceSerials.length}）一致`,
          "error",
        );
        return;
      }
      const htLines = step5HashtagLinesText.split("\n");
      for (let slot = 0; slot < step5PathLines.length; slot++) {
        const line = htLines[slot] ?? "";
        const pr = parseStep5TopicLineHashtagsOnly(line);
        if (!pr.ok) {
          addLog(`步骤5：第 ${slot + 1} 行 #话题 格式错误：${pr.error}`, "error");
          return;
        }
      }
      const paths = [...step5PathLines];
      const n = paths.length;
      const devicesOrdered = [...step5SelectedDeviceSerials];
      const notes: string[] = [];
      const failedDeviceLabels: string[] = [];
      setStep5Busy("device_flow");
      setStep5LastNote(null);
      if (step5MissionBoardRows && step5MissionBoardRows.length > 0) {
        addLog(
          `步骤5：任务顺序 ${step5MissionBoardRows.map((r) => `${r.index}.${r.deviceLabel}+${r.hashtagLine}+${r.fileName}`).join(" → ")}`,
          "info",
        );
      }
      try {
        for (let slot = 0; slot < n; slot++) {
          const video_url = paths[slot];
          const device_serial = devicesOrdered[slot];
          const dev = phoneDevices.find((d) => d.serial === device_serial);
          const modelLabel = (dev?.model || dev?.serial || device_serial).trim() || device_serial.slice(-8);
          const noteLabel = (step5DeviceMeta[device_serial]?.note || "").trim();
          const deviceLabel = noteLabel ? `${modelLabel}(${noteLabel})` : modelLabel;
          const rawTopicLine = (step5HashtagLinesText.split("\n")[slot] ?? "").trim();
          const tagParse = parseStep5TopicLineHashtagsOnly(rawTopicLine);
          const hashtagsForTask = tagParse.ok ? tagParse.tags : [];
          const topic_caption = buildTopicCaptionForPublish(banner, rawTopicLine);
          const prev =
            topic_caption.length > 72 ? `${topic_caption.slice(0, 72)}…` : topic_caption;
          addLog(
            `步骤5 分配：勾选序第 ${slot + 1} 台 ${deviceLabel} ← 成片第 ${slot + 1} 行；#话题 将写入：${prev}`,
            "info",
          );
          const res = await fetch(`${API_BASE}/api/phone-publish/publish-on-device`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              device_serial,
              video_url,
              description: "",
              hashtags: hashtagsForTask,
              topic_caption,
              dry_run: dryRun,
              skip_caption_fill: false,
            }),
          });
          const raw = await res.text();
          let data: {
            ok?: boolean;
            phase?: string;
            message?: string;
            pushed_remote?: string | null;
            detail?: string;
          };
          try {
            data = JSON.parse(raw) as typeof data;
          } catch {
            throw new Error(raw.slice(0, 200));
          }
          if (!res.ok) {
            throw new Error(data.detail || raw.slice(0, 400));
          }
          const msg = data.message || "";
          const phase = data.phase || "";
          if (!data.ok) {
            failedDeviceLabels.push(`${deviceLabel} phase=${phase}`);
          }
          notes.push(
            `[${deviceLabel}] ${data.ok ? "ok" : "fail"} phase=${phase} ${msg.slice(0, 120)}`,
          );
          addLog(
            `步骤5 手机发布 ${slot + 1}/${n}（${deviceLabel}）：${data.ok ? "ok" : "fail"} phase=${phase} ${msg.slice(0, 140)}`,
            data.ok ? "success" : "error",
          );
          if (slot < n - 1) {
            await new Promise((r) => setTimeout(r, 600));
          }
        }
        const failedSummary =
          failedDeviceLabels.length > 0
            ? `\n失败设备（${failedDeviceLabels.length}）：${failedDeviceLabels.join("；")}`
            : "\n失败设备：无";
        setStep5LastNote(
          `共 ${n} 台串行结束。${failedSummary}\n${notes.join("\n")}${dryRun ? "\n（dry_run：未点发作品）" : ""}`,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        addLog(`步骤5 手机发布失败: ${msg}`, "error");
        setStep5LastNote(msg);
      } finally {
        setStep5Busy(null);
      }
    },
    [
      addLog,
      step5PathLines,
      step5SelectedDeviceSerials,
      phoneDevices,
      step5DeviceMeta,
      step5HashtagLinesText,
      step5MissionBoardRows,
      banner,
    ],
  );

  // Handle voice file upload
  const handleVoiceFileChange = async (file: File) => {
    if (audioMode !== "api") {
      addLog(`已选择本地音频文件: ${file.name} (将在系统工具配音模式使用)`, "info");
      return;
    }

    setVoiceUploadProgress("正在上传音色文件...");
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(`${API_BASE}/api/tts/upload-voice`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const raw = await res.text();
        let detail = raw.slice(0, 800);
        try {
          const j = JSON.parse(raw) as { detail?: unknown };
          if (j.detail != null) detail = String(j.detail);
        } catch {
          /* 非 JSON */
        }
        throw new Error(`上传失败 (${res.status}): ${detail}`);
      }

      const data = await res.json();
      const voiceId = data.chanjing_voice_id;
      if (voiceId) {
        setVoiceUploadId(voiceId);
        setVoiceUploadProgress(`音色已克隆: ${voiceId}`);
        addLog(`音色克隆成功: ${voiceId}`, "success");
      } else {
        setVoiceUploadProgress("上传成功但未获取到音色ID");
        addLog(`上传成功但未获取到音色ID: ${JSON.stringify(data)}`, "warn");
      }
    } catch (e) {
      const msg = `上传失败: ${e}`;
      setVoiceUploadProgress(msg);
      addLog(msg, "error");
    }
  };

  // Add media file（服务端 URL 或手动输入的可解析路径；函数式更新避免连选多文件时状态丢失）
  const addMediaFile = (path: string) => {
    const p = (path || "").trim();
    if (!p) return;
    setMediaFiles((prev) => (prev.includes(p) ? prev : [...prev, p]));
    addLog(`已添加素材: ${p.split(/[\\/]/).pop()}`, "info");
  };

  // Remove media file
  const removeMediaFile = (path: string) => {
    setMediaFiles((prev) => prev.filter((f) => f !== path));
    addLog(`已移除素材: ${path.split(/[\\/]/).pop()}`, "info");
  };

  /** 「选择文件」：先上传到后端再写入列表（浏览器不能传本机路径给 FFmpeg） */
  const handleInsertMediaFilesSelected = async (files: FileList | null) => {
    if (!files?.length) return;
    setInsertMediaUploading(true);
    setInsertMediaStatusLines([]);
    for (const f of Array.from(files)) {
      try {
        addLog(`正在上传插入素材: ${f.name}…`, "info");
        const url = await uploadInsertMediaToServer(f);
        addMediaFile(url);
        const line = `${formatStepDoneLabel()} 成功上传 ${f.name}`;
        setInsertMediaStatusLines((prev) => [...prev, line]);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        addLog(`插入素材上传失败 (${f.name}): ${msg}`, "error");
        const line = `${formatStepDoneLabel()} 上传失败 ${f.name}：${msg.slice(0, 120)}`;
        setInsertMediaStatusLines((prev) => [...prev, line]);
      }
    }
    setInsertMediaUploading(false);
  };

  // Execute full pipeline（与分步共用同一套 API 参数与 TTS/分身分支）
  const executePipeline = async () => {
    if (!url.trim()) {
      setFinalError("请输入来源URL");
      return;
    }

    resetPipeline();
    setPipelineRunning(true);
    addLog("=== 开始执行流水线 ===", "info");

    let rewrittenScript = "";
    let audioUrl = "";
    let avatarVideoUrl = "";

    try {
      setCurrentStep("step1_extract");
      updateStepStatus("step1_extract", "running");
      addLog("Step 1: 从URL提取文案...", "info");
      setProgress(5);

      const extractData = await apiIpBrainExtract(url);
      const extractedText = extractData.source_text || "";
      addLog(`文案提取完成 (${extractedText.length} 字符)`, "success");
      updateStepStatus("step1_extract", "done");
      setProgress(15);
      if (pipelineCancelledRef.current) throw new Error("已取消");

      setCurrentStep("step2_rewrite");
      updateStepStatus("step2_rewrite", "running");
      addLog("Step 2: 文案再创作（爆款 fast_boom）...", "info");

      const built = buildIpBrainGenerateBody({
        sourceUrl: url,
        sourceText: extractedText,
        durationStr: duration,
        productionCount,
        customPromptEnabled: step1CustomPromptEnabled,
        customPrompt: step1CustomPrompt,
      });
      if (!built.ok) throw new Error(built.error);

      const rewriteData = await apiIpBrainGenerate(built.body);
      const parsed = parseGenerateResponse(rewriteData);
      const first = parsed.variants[0];
      rewrittenScript = first?.subtitle_script || "";
      const generatedTitle = first?.title || "";
      addLog(`标题: ${generatedTitle}`, "success");
      addLog(`文案长度: ${rewrittenScript.length} 字符；批量: ${parsed.variants.length} 条`, "success");
      updateStepStatus("step2_rewrite", "done");
      setProgress(25);
      if (pipelineCancelledRef.current) throw new Error("已取消");

      setCurrentStep("step3_tts");
      updateStepStatus("step3_tts", "running");
      addLog("Step 3: TTS音频合成...", "info");

      let voiceForTts = voice;
      if (voice === "lekui") {
        if (!voiceUploadId) throw new Error("乐葵音色需要先上传并克隆，再执行 TTS");
        voiceForTts = voiceUploadId;
      }

      assertChanjingAudioModeOrThrow(audioMode, voice, voiceUploadId);

      const ttsHq = audioMode === "api";
      const ttsData = await apiTtsSynthesize({
        text: rewrittenScript,
        voice: voiceForTts,
        hq: ttsHq,
        chanjingApi: chanjingApiPayload,
      });
      audioUrl = ttsData.audio_url || "";
      addLog(
        `音频生成完成 [请求hq=${ttsHq} · 实际引擎=${formatTtsEngineLabel(ttsData.tts_engine)}]: ${audioUrl}`,
        "success"
      );
      updateStepStatus("step3_tts", "done");
      setProgress(45);
      if (pipelineCancelledRef.current) throw new Error("已取消");

      setCurrentStep("step4_avatar");
      updateStepStatus("step4_avatar", "running");
      addLog("Step 4: 分身视频生成...", "info");

      const avatarCapRes = await fetch(`${API_BASE}/api/avatar/capabilities`);
      const avatarCap = await avatarCapRes.json();
      addLog(`Avatar backend: ${avatarCap.avatar_render_backend_default}`, "info");

      let templateVideoUrl = avatarTemplateVideoUrl;
      if (!templateVideoUrl) {
        const templatesRes = await fetch(`${API_BASE}/api/avatar/system-templates/list`);
        const templatesData = await templatesRes.json();
        if (!templatesData.templates?.length) throw new Error("未找到分身模板");
        templateVideoUrl = templatesData.templates[0].video_url;
        addLog(`使用默认模板: ${templatesData.templates[0].filename}`, "info");
      } else {
        addLog(`使用已选模板 URL`, "info");
      }
      if (!templateVideoUrl) throw new Error("未选择分身模板");
      const renderData = await apiAvatarRender({
        audio_url: audioUrl,
        template_video_url: templateVideoUrl,
        avatarMode,
        chanjingApi: chanjingApiPayload,
      });
      avatarVideoUrl = renderData.video_url || "";
      addLog(`分身视频生成完成: ${avatarVideoUrl}`, "success");
      updateStepStatus("step4_avatar", "done");
      setProgress(70);
      if (pipelineCancelledRef.current) throw new Error("已取消");

      setCurrentStep("step5_compose");
      updateStepStatus("step5_compose", "running");
      addLog("Step 5: 画中画合成...", "info");

      const composeAudioNorm = normalizeComposeAssetUrl(audioUrl);
      const composeHeadNorm = normalizeComposeAssetUrl(avatarVideoUrl);
      if (!composeAudioNorm) {
        throw new Error("口播音频链接无效，请检查步骤3 TTS 输出是否为 /static-data/ 路径。");
      }
      if (!composeHeadNorm) {
        throw new Error("分身视频链接无效，请重试步骤4 分身渲染。");
      }
      const { urls: pipelineInsertUrls, skipped: pipelineInsertSkipped } =
        buildComposeInsertMediaUrls(mediaFiles);
      if (pipelineInsertSkipped > 0) {
        addLog(
          `已跳过 ${pipelineInsertSkipped} 条无法在服务端使用的素材路径（合成仅支持 /static-data/ 等）。`,
          "warn"
        );
      }
      const composePipelineBody: Record<string, unknown> = {
        talking_head_url: composeHeadNorm,
        audio_url: composeAudioNorm,
        script_text: rewrittenScript,
        banner_text: banner,
        width: 1080,
        height: 1920,
        fps: 30,
        compose_mode: "talking_head_plus_media",
        compose_effects_mode: step4ComposeEffectsMode,
      };
      if (pipelineInsertUrls.length > 0) {
        composePipelineBody.insert_media_urls = pipelineInsertUrls;
      }
      const composeRes = await fetch(`${API_BASE}/api/video/compose/async`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(composePipelineBody),
      });

      if (!composeRes.ok) {
        const errText = await composeRes.text();
        throw new Error(`视频合成启动失败: ${errText}`);
      }

      const composeData = await composeRes.json();
      const jobId = composeData.job_id as string;
      activeComposeJobIdRef.current = jobId;
      addLog(`合成任务已创建: ${jobId}`, "info");

      if (pipelineCancelledRef.current) throw new Error("已取消");

      const jobResult = await pollComposeJobUntilDone(
        jobId,
        () => pipelineCancelledRef.current,
        (prog, stage) => {
          addLog(`进度: ${prog ?? 0}% - ${stage || "处理中…"}`, "info");
          setProgress(70 + (prog ?? 0) * 0.3);
        }
      );
      activeComposeJobIdRef.current = null;

      setFinalVideo(jobResult?.video_url || jobResult?.video_path || null);
      updateStepStatus("step5_compose", "done");
      setProgress(100);
      addLog("=== 流水线执行完成 ===", "success");
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : String(e);
      if (raw === "已取消" || raw === "合成已取消") {
        addLog("流水线已取消", "warn");
      } else {
        const msg = `执行失败: ${raw}`;
        addLog(msg, "error");
        setFinalError(msg);
        if (currentStep) {
          updateStepStatus(currentStep, "error");
        }
      }
    } finally {
      activeComposeJobIdRef.current = null;
      setPipelineRunning(false);
      setCurrentStep(null);
    }
  };

  const handleAvatarTemplateUpload = async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    if (!["mp4", "mov", "mkv", "webm"].includes(ext)) {
      addLog(`不支持的模板格式: ${ext}`, "error");
      setAvatarTemplateUploadHint(`不支持：.${ext}`);
      return;
    }
    setAvatarTemplateUploadBusy(true);
    setAvatarTemplateUploadHint("正在上传…");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${API_BASE}/api/assets/upload-video`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { video_url?: string };
      const u = data.video_url || "";
      if (u) {
        setAvatarTemplateVideoUrl(u);
        setAvatarTemplateUploadHint("上传成功");
        addLog(`分身模板已上传: ${u}`, "success");
      } else {
        setAvatarTemplateUploadHint("上传失败：未返回路径");
        addLog("分身模板上传未返回 video_url", "error");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setAvatarTemplateUploadHint(`上传失败：${msg.slice(0, 80)}`);
      addLog(`模板上传失败: ${msg}`, "error");
    } finally {
      setAvatarTemplateUploadBusy(false);
    }
  };

  const runStepExtractOnly = async () => {
    if (!url.trim()) throw new Error("请先输入来源 URL");
    stepFlowCancelledRef.current = false;
    const ac = new AbortController();
    stepFlowAbortRef.current = ac;
    setStepFlowRunning(true);
    try {
      addLog("分步-提取原文案...", "info");
      const extractData = await apiIpBrainExtract(url, ac.signal);
      const text = extractData.source_text || "";
      const rawTopics = [
        ...((extractData.hashtags || []) as string[]),
        ...((extractData.keywords || []) as string[]),
      ];
      const normalizedTopics =
        normalizeHashtagLabels(rawTopics).length > 0
          ? normalizeHashtagLabels(rawTopics)
          : normalizeHashtagLabels(extractHashtagLabelsFromLine(text));
      setStepExtractedText(text);
      setStepKeywords(normalizedTopics);
      setStepVariants([]);
      // 提取仅用于“原文案/话题”展示，不自动灌入口播输入框；口播由“再创作”生成。
      setStepScriptLines([""]);
      setStepAudioUrls([""]);
      setStep3AvatarVideoUrl("");
      setStep3SelectedAudioIndex(0);
      setStep4BatchVideoUrls([]);
      setStep4DoneHint(null);
      addLog(
        `提取完成 (${text.length} 字符，#话题 ${normalizedTopics.length} 个)，请设置目标时长/生产数量后点「再创作」`,
        "success"
      );
    } finally {
      stepFlowAbortRef.current = null;
      setStepFlowRunning(false);
    }
  };

  const runStepRegenerate = async () => {
    if (!url.trim()) throw new Error("请先输入来源 URL");
    const src = stepExtractedText.trim();
    if (!src) throw new Error("请先点击「提取文案」或粘贴原文");
    const built = buildIpBrainGenerateBody({
      sourceUrl: url,
      sourceText: src,
      durationStr: duration,
      productionCount,
      customPromptEnabled: step1CustomPromptEnabled,
      customPrompt: step1CustomPrompt,
    });
    if (!built.ok) throw new Error(built.error);
    stepFlowCancelledRef.current = false;
    const ac = new AbortController();
    stepFlowAbortRef.current = ac;
    setStepFlowRunning(true);
    try {
      addLog("分步-再创作（爆款）...", "info");
      const rewriteData = await apiIpBrainGenerate(built.body, ac.signal);
      const parsed = parseGenerateResponse(rewriteData);
      setStepKeywords(parsed.keywords);
      setStepVariants(parsed.variants);
      const lines = parsed.variants.map((v) => v.subtitle_script);
      const n = Math.max(1, lines.length);
      setStepScriptLines(lines.length ? lines : [""]);
      setStepAudioUrls(Array.from({ length: n }, () => ""));
      setStep3AvatarVideoUrl("");
      setStep3SelectedAudioIndex(0);
      setStep4BatchVideoUrls([]);
      setStep4DoneHint(null);
      const v0 = parsed.variants[0];
      if (v0) {
        setStepFlow((prev) => ({
          ...prev,
          script: v0.subtitle_script,
          title: v0.title,
          audioUrl: "",
          avatarUrl: "",
          finalVideoUrl: "",
          finalJobId: "",
        }));
      }
      addLog(`再创作完成：${parsed.variants.length} 条文案（已填入下方输入框）`, "success");
    } finally {
      stepFlowAbortRef.current = null;
      setStepFlowRunning(false);
    }
  };

  const runStep2ProduceAudio = async () => {
    const lines = stepScriptLines.map((s) => s.trim());
    if (!lines.some((s) => extractTtsBodyFromScriptBlock(s).length > 0)) {
      throw new Error("请在步骤1「当前口播正文」至少填写一条可朗读的正文（见「正文」行下方）");
    }
    setStep2DoneHint(null);
    stepFlowCancelledRef.current = false;
    const ac = new AbortController();
    stepFlowAbortRef.current = ac;
    setStepFlowRunning(true);
    try {
      assertChanjingAudioModeOrThrow(audioMode, voice, voiceUploadId);

      let voiceForTts = voice;
      if (voice === "lekui") {
        if (!voiceUploadId) throw new Error("乐葵音色需要先上传并克隆");
        voiceForTts = voiceUploadId;
      }
      const ttsHq = audioMode === "api";
      const urls: string[] = Array.from({ length: lines.length }, (_, i) => stepAudioUrls[i] || "");
      let generated = 0;
      for (let i = 0; i < lines.length; i++) {
        if (stepFlowCancelledRef.current) throw new Error("已取消");
        const rawBlock = lines[i];
        if (!rawBlock) {
          urls[i] = "";
          continue;
        }
        const text = extractTtsBodyFromScriptBlock(rawBlock);
        if (!text) {
          urls[i] = "";
          continue;
        }
        addLog(`分步-步骤2：正在生成第 ${i + 1}/${lines.length} 条音频…`, "info");
        const ttsData = await apiTtsSynthesize({
          text,
          voice: voiceForTts,
          hq: ttsHq,
          signal: ac.signal,
          chanjingApi: chanjingApiPayload,
        });
        urls[i] = ttsData.audio_url || "";
        generated++;
        addLog(
          `第 ${i + 1} 条 [引擎=${formatTtsEngineLabel(ttsData.tts_engine)}]: ${urls[i]}`,
          "success"
        );
      }
      setStepAudioUrls(urls);
      setStep3AvatarVideoUrl("");
      const au = urls[0] || urls.find((u) => u) || "";
      setStepFlow((prev) => ({ ...prev, audioUrl: au, avatarUrl: "" }));
      addLog(
        `分步-步骤2完成：共 ${generated} 条（请求hq=${ttsHq}；详见每条「引擎=…」；元数据可查 GET /api/tts/audio-meta/<文件名>）`,
        "success"
      );
      setStep2DoneHint(`${formatStepDoneLabel()} 完成`);
    } finally {
      stepFlowAbortRef.current = null;
      setStepFlowRunning(false);
    }
  };

  const runStep3ProduceAvatar = async () => {
    if (!stepAudioUrls.some((u) => (u || "").trim())) {
      throw new Error("请先在步骤2 至少生成一条口播音频");
    }
    const sel = step3SelectedAudioIndex;
    const rawAu = stepAudioUrls[sel];
    if (!rawAu?.trim()) {
      throw new Error("请先在上方勾选一条已生成的步骤2 音频");
    }
    const audioNorm = normalizeComposeAssetUrl(rawAu);
    if (!audioNorm) {
      throw new Error(`第 ${sel + 1} 条音频 URL 无效，请重新生成该条音频`);
    }
    setStep3DoneHint(null);
    stepFlowCancelledRef.current = false;
    const ac = new AbortController();
    stepFlowAbortRef.current = ac;
    setStepFlowRunning(true);
    try {
      if (stepFlowCancelledRef.current) throw new Error("已取消");
      addLog(`分步-步骤3：使用第 ${sel + 1} 条音频 + 分身模板，生成一条口播分身视频…`, "info");
      let templateVideoUrl = avatarTemplateVideoUrl;
      if (!templateVideoUrl) {
        const templatesRes = await fetch(`${API_BASE}/api/avatar/system-templates/list`, {
          signal: ac.signal,
        });
        const templatesData = await templatesRes.json();
        if (!templatesData.templates?.length) throw new Error("未找到分身模板");
        templateVideoUrl = templatesData.templates[0].video_url;
      }
      if (!templateVideoUrl) throw new Error("未选择分身模板");
      const tplName =
        avatarTemplates.find((x) => x.video_url === templateVideoUrl)?.filename ||
        templateVideoUrl.split("/").pop() ||
        templateVideoUrl;
      addLog(`分步-步骤3：使用分身模板 ${tplName}`, "info");
      const renderData = await apiAvatarRender({
        audio_url: audioNorm,
        template_video_url: templateVideoUrl,
        avatarMode,
        signal: ac.signal,
        chanjingApi: chanjingApiPayload,
      });
      const url = renderData.video_url || "";
      setStep3AvatarVideoUrl(url);
      setStepFlow((prev) => ({ ...prev, avatarUrl: url }));
      addLog(`步骤3 分身成品：${url || "（空）"}`, "success");
      addLog("分步-步骤3完成：已生成 1 条分身口播视频", "success");
      setStep3DoneHint(`${formatStepDoneLabel()} 完成`);
    } finally {
      stepFlowAbortRef.current = null;
      setStepFlowRunning(false);
    }
  };

  const runStep4Compose = async () => {
    const indicesNoAvatar: number[] = [];
    for (let i = 0; i < stepScriptLines.length; i++) {
      if (!stepAudioUrls[i]?.trim()) continue;
      if (stepComposeNoAvatar) indicesNoAvatar.push(i);
    }
    const sel = step3SelectedAudioIndex;
    const batchIndices = stepComposeNoAvatar ? indicesNoAvatar : [sel];
    if (stepComposeNoAvatar) {
      if (batchIndices.length === 0) {
        throw new Error("请先在步骤2 至少生成一条口播音频（有几条音频则混剪几条成片）");
      }
    } else {
      if (!stepAudioUrls[sel]?.trim()) {
        throw new Error("请先在步骤2 为当前勾选的那条口播生成音频");
      }
      if (!normalizeComposeAssetUrl(step3AvatarVideoUrl)) {
        throw new Error("请先在步骤3 生成一条分身口播视频（与上方勾选的音频对应）");
      }
    }

    setStep4DoneHint(null);
    setStep4BatchVideoUrls([]);
    stepFlowCancelledRef.current = false;
    stepComposeActiveJobIdsRef.current.clear();
    setStepFlowRunning(true);
    try {
      const conc = STEP4_COMPOSE_CONCURRENCY;
      addLog(
        (stepComposeNoAvatar
          ? `分步-步骤4：不用分身（纯素材切播），共 ${batchIndices.length} 条成片（口播音频+字幕+横幅+素材）`
          : `分步-步骤4：用分身（步骤3+素材），共 ${batchIndices.length} 条成片`) +
          ` · 并发=${Math.min(conc, batchIndices.length)}`,
        "info"
      );
      const { urls: insertUrls, skipped: insertSkipped } = buildComposeInsertMediaUrls(mediaFiles);
      if (insertSkipped > 0) {
        addLog(
          `已跳过 ${insertSkipped} 条无法在服务端使用的素材路径（仅支持 /static-data/、用户库或系统模板 URL，不支持本机 file:// 路径）。`,
          "warn"
        );
      }

      const tasks = batchIndices.map((i, k) => ({ i, k }));
      let composeDoneCount = 0;
      const slotResults = await poolMap(
        tasks,
        conc,
        async ({ i, k }: { i: number; k: number }): Promise<{ url: string; jobId: string } | null> => {
          if (stepFlowCancelledRef.current) throw new Error("已取消");
          const scriptForCompose = extractTtsBodyFromScriptBlock(stepScriptLines[i] ?? "").trim();
          const audioNorm = normalizeComposeAssetUrl(stepAudioUrls[i]);
          if (!audioNorm) {
            addLog(`步骤4：第 ${i + 1} 条口播音频无效，已跳过`, "warn");
            return null;
          }
          const body: Record<string, unknown> = {
            audio_url: audioNorm,
            script_text: scriptForCompose,
            banner_text: banner.trim(),
            width: 1080,
            height: 1920,
            fps: 30,
            compose_mode: "talking_head_plus_media",
            compose_effects_mode: step4ComposeEffectsMode,
          };
          if (step4ComposeUseProxyMedia) {
            body.use_proxy_media = true;
          }
          if (!stepComposeNoAvatar) {
            const thNorm = normalizeComposeAssetUrl(step3AvatarVideoUrl);
            if (!thNorm) {
              addLog("步骤4：步骤3 分身视频 URL 无效", "warn");
              return null;
            }
            body.talking_head_url = thNorm;
          }
          if (insertUrls.length > 0) {
            body.insert_media_urls = insertUrls;
            if (!stepComposeNoAvatar) {
              // 后端：任意 >0 启用步骤4 专用切播（开头 2s 分身 + M,M,A,M,M 循环，槽位 2～4s）；数值本身不参与节奏
              body.media_streak_before_avatar = 1;
            }
          }
          const composeRes = await fetch(`${API_BASE}/api/video/compose/async`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!composeRes.ok) throw new Error(`视频合成启动失败: ${await composeRes.text()}`);
          const composeData = await composeRes.json();
          const jobId = composeData.job_id as string;
          stepComposeActiveJobIdsRef.current.add(jobId);
          setStepFlow((prev) => ({ ...prev, finalJobId: jobId }));
          addLog(`分步-步骤4 第 ${k + 1}/${batchIndices.length} 个任务创建：${jobId}（口播第 ${i + 1} 条）`, "info");
          try {
            const donePayload = await pollComposeJobUntilDone(
              jobId,
              () => stepFlowCancelledRef.current,
              (prog, stage) => {
                addLog(
                  `合成[${k + 1}/${batchIndices.length}] 进度: ${prog ?? 0}% ${stage ? `· ${stage}` : ""}`,
                  "info"
                );
              }
            );
            const finalVideoUrl = (donePayload.video_url || donePayload.video_path || "").trim();
            if (finalVideoUrl) {
              composeDoneCount += 1;
              addLog(
                `分步-步骤4 已完成 ${composeDoneCount}/${batchIndices.length} 条（口播第 ${i + 1} 条）`,
                "success"
              );
              return { url: finalVideoUrl, jobId };
            }
            addLog(`分步-步骤4 第 ${k + 1}/${batchIndices.length} 条成片无有效 URL`, "warn");
            return { url: "", jobId };
          } finally {
            stepComposeActiveJobIdsRef.current.delete(jobId);
          }
        }
      );

      const outVideos: string[] = [];
      let lastJobId = "";
      for (let t = 0; t < slotResults.length; t++) {
        const r = slotResults[t];
        if (r?.jobId) lastJobId = r.jobId;
        if (r?.url) outVideos.push(r.url);
      }

      if (outVideos.length === 0) {
        throw new Error("步骤4 未得到任何成片 URL，请检查日志或重试");
      }
      setStep4BatchVideoUrls(outVideos);
      setStep5PathsText(outVideos.join("\n"));
      const lastU = outVideos[outVideos.length - 1] || "";
      setStepFlow((prev) => ({ ...prev, finalVideoUrl: lastU, finalJobId: lastJobId }));
      addLog(`步骤5：已用本批 ${outVideos.length} 条成片路径替换下方「成片路径」文本框（非累积追加）`, "info");
      addLog(`分步-步骤4完成：共 ${outVideos.length} 条成片`, "success");
      setStep4DoneHint(`${formatStepDoneLabel()} 完成（${outVideos.length} 条）`);
    } finally {
      stepComposeActiveJobIdsRef.current.clear();
      setStepFlowRunning(false);
    }
  };

  // Get step display name
  const getStepName = (step: string) => {
    const names: Record<string, string> = {
      step1_extract: "Step 1: 提取文案",
      step2_rewrite: "Step 2: 文案创作",
      step3_tts: "Step 3: TTS合成",
      step4_avatar: "Step 4: 分身渲染",
      step5_compose: "Step 5: 画中画合成",
    };
    return names[step] || step;
  };

  // Get step status icon
  const getStepIcon = (status: StepStatus) => {
    switch (status) {
      case "done":
        return "✓";
      case "running":
        return "⟳";
      case "error":
        return "✗";
      default:
        return "○";
    }
  };

  /** 步骤2 顶部展示：外部蝉镜仅 ID + API 两项；步骤3 共用同一凭据 */
  const externalChanjingApiBlock = useMemo(
    () => (
      <div
        className="ap-external-chanjing-block"
        style={{
          marginBottom: 16,
          padding: "12px 14px",
          borderRadius: 8,
          border: "1px solid rgba(148,163,184,0.35)",
          background: "rgba(15,23,42,0.4)",
        }}
      >
        <div className="label" style={{ marginBottom: 8 }}>
          外部蝉镜 API（可选）
        </div>
        <p className="mini" style={{ margin: "0 0 14px", lineHeight: 1.55 }}>
          填写<strong>蝉镜 ID</strong>与<strong>蝉镜 API</strong>后，系统会自动用该账号对接蝉镜并生成成品：步骤2 选「蝉镜」口播、步骤3
          选「蝉镜对口型」时均生效（覆盖服务器
          <span className="apiVal"> .env </span>
          ）。接口域名由服务器配置，此处只需两项。
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "14px 20px",
            alignItems: "start",
          }}
          className="ap-external-chanjing-grid"
        >
          <div>
            <label className="label" style={{ display: "block", marginBottom: 6 }}>
              蝉镜 ID
            </label>
            <input
              className="input"
              type="text"
              autoComplete="off"
              placeholder="与 .env 中 CHANJING_APP_ID 相同"
              value={chanjingAppId}
              onChange={(e) => setChanjingAppId(e.target.value)}
              disabled={stepFlowRunning}
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label className="label" style={{ display: "block", marginBottom: 6 }}>
              蝉镜 API（密钥）
            </label>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              placeholder="与 .env 中 CHANJING_SECRET_KEY 相同"
              value={chanjingSecretKey}
              onChange={(e) => setChanjingSecretKey(e.target.value)}
              disabled={stepFlowRunning}
              style={{ width: "100%" }}
            />
          </div>
        </div>
        {chanjingApiPayload ? (
          <div className="mini" style={{ marginTop: 12, color: "#86efac" }}>
            ✓ 已识别外部蝉镜凭据，步骤2 / 步骤3 将使用该账号
          </div>
        ) : (
          <div className="mini" style={{ marginTop: 12, color: "#94a3b8" }}>
            两项都填即启用；留空则用服务器已配置的蝉镜（若有）
          </div>
        )}
      </div>
    ),
    [chanjingAppId, chanjingSecretKey, chanjingApiPayload, stepFlowRunning]
  );

  return (
    <div className="page ap-wide">
      <div className="container">
        <main className="ap-main">
        <header className="header">
          <div>
            <div className="kicker">本地对标 duoleai｜一键创作</div>
            <h1>{isAdminRoute ? "画中画｜全自动视频创作" : "分步生产｜工具导航"}</h1>
            <div className="sub">
              {isAdminRoute
                ? "完整流水线：URL提取 → 文案创作 → TTS → 分身渲染 → 画中画合成（本页仅全自动；分步请在「分步生产工作台」）"
                : "默认分步：步骤1～4 → 底部「管理员入口」输入 0000 解锁步骤5 手机发布（USB 安卓）。参数与全自动页共用并持久化。"}
            </div>
          </div>
          <div className="header-right">
            <div
              className="ap-gpu-monitor"
              title={
                gpuMonitor?.queried_at
                  ? `查询 UTC ${gpuMonitor.queried_at}${gpuMonitor.ffmpeg_video_encoder_setting != null ? ` · FFMPEG_VIDEO_ENCODER=${gpuMonitor.ffmpeg_video_encoder_setting}` : ""}`
                  : "GPU / 步骤4 编码器"
              }
            >
              {gpuMonitor == null ? (
                <span className="ap-gpu-line">GPU：加载中…</span>
              ) : !gpuMonitor.available || gpuMonitor.gpus.length === 0 ? (
                <span className="ap-gpu-line ap-gpu-warn">
                  GPU：{gpuMonitor.error || "不可用"}
                </span>
              ) : (
                gpuMonitor.gpus.map((g) => (
                  <span key={String(g.index)} className="ap-gpu-line">
                    {g.name.replace(/^NVIDIA\s+/i, "")} · 占用 {g.utilization_gpu_percent ?? "—"}% · 显存{" "}
                    {g.memory_used_mib ?? "—"}/{g.memory_total_mib ?? "—"} MiB · {g.temperature_c ?? "—"}°C
                    {g.power_draw_w != null ? ` · ${g.power_draw_w.toFixed(0)}W` : ""}
                  </span>
                ))
              )}
              {gpuMonitor?.compose_video_encoder_effective != null && gpuMonitor.compose_video_encoder_effective !== "" ? (
                <span
                  className={`ap-gpu-line ${gpuMonitor.compose_video_encoder_effective === "h264_nvenc" ? "ap-gpu-encode-nvenc" : "ap-gpu-encode-cpu"}`}
                >
                  步骤4 成片编码：{gpuMonitor.compose_video_encoder_effective}
                </span>
              ) : null}
              {gpuMonitor?.compose_hwaccel_cuda_effective != null ? (
                <span
                  className={`ap-gpu-line ${gpuMonitor.compose_hwaccel_cuda_effective ? "ap-gpu-encode-nvenc" : ""}`}
                >
                  步骤4 解码 NVDEC：{gpuMonitor.compose_hwaccel_cuda_effective ? "开" : "关"}
                  {gpuMonitor.compose_hwaccel_cuda_setting != null && gpuMonitor.compose_hwaccel_cuda_setting !== ""
                    ? `（${gpuMonitor.compose_hwaccel_cuda_setting}）`
                    : ""}
                </span>
              ) : null}
              {gpuMonitor?.ffmpeg_build_has_h264_nvenc === true &&
              gpuMonitor?.nvenc_runtime_probe_ok === false &&
              gpuMonitor.compose_video_encoder_effective === "libx264" ? (
                <span className="ap-gpu-line ap-gpu-warn">NVENC 已列出但运行时不可用，成片使用 libx264</span>
              ) : null}
              {gpuMonitor?.compose_burn_subtitles_into_video === false ? (
                <span className="ap-gpu-line">步骤4 字幕：仅导出 SRT（未烧录）</span>
              ) : null}
            </div>
            <div className="api">
              API: <span className="apiVal">{formatApiBaseLabel(API_BASE)}</span>
            </div>
          </div>
        </header>

        {/* Pipeline Status */}
        {isAdminRoute && pipelineRunning && (
          <section className="card pipeline-status">
            <div className="pipeline-steps">
              {Object.entries(stepStatuses).map(([step, status]) => (
                <div
                  key={step}
                  className={`pipeline-step ${status} ${currentStep === step ? "current" : ""}`}
                >
                  <span className="step-icon">{getStepIcon(status)}</span>
                  <span className="step-name">{getStepName(step)}</span>
                </div>
              ))}
            </div>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progress}%` }}></div>
            </div>
          </section>
        )}

        {isAdminRoute && (
        <>
        <div className="grid">
          {/* Step 1: URL */}
          <section className="card">
            <div className="cardTitle apStepSectionTitle">Step 1: 来源URL</div>
            <label className="label">抖音/视频链接</label>
            <input
              value={urlInput}
              onChange={(e) => {
                const v = e.target.value;
                setUrlInput(v);
                setUrl(v);
              }}
              onBlur={(e) => {
                const v = e.currentTarget.value;
                setUrlInput(v);
                setUrl(v);
              }}
              placeholder="https://www.douyin.com/jingxuan?modal_id=..."
              className="input"
              disabled={pipelineRunning}
            />
          </section>

          {/* Step 2: Audio Mode */}
          <section className="card">
            <div className="cardTitle apStepSectionTitle">Step 2: 音频生产方式</div>
            <div className="radio-group">
              <label className={`radio-item ${audioMode === "local" ? "selected" : ""}`}>
                <input
                  type="radio"
                  name="audioMode"
                  value="local"
                  checked={audioMode === "local"}
                  onChange={() => setAudioMode("local")}
                  disabled={pipelineRunning}
                />
                <span>系统工具配音（快速，内置系统音色）</span>
              </label>
              <label className={`radio-item ${audioMode === "api" ? "selected" : ""}`}>
                <input
                  type="radio"
                  name="audioMode"
                  value="api"
                  checked={audioMode === "api"}
                  onChange={() => setAudioMode("api")}
                  disabled={pipelineRunning}
                />
                <span>
                  蝉镜云端：仅乐葵上传后的音色 ID；晓晓/云希等请用「系统工具配音」
                </span>
              </label>
            </div>
          </section>

          {/* Step 3: Avatar Mode */}
          <section className="card">
            <div className="cardTitle apStepSectionTitle">Step 3: 分身视频生产方式</div>
            <div className="radio-group">
              <label className={`radio-item ${avatarMode === "wav2lip" ? "selected" : ""}`}>
                <input
                  type="radio"
                  name="avatarMode"
                  value="wav2lip"
                  checked={avatarMode === "wav2lip"}
                  onChange={() => setAvatarMode("wav2lip")}
                  disabled={pipelineRunning}
                />
                <span>系统对口型（本机推理，速度快）</span>
              </label>
              <label className={`radio-item ${avatarMode === "chanjing" ? "selected" : ""}`}>
                <input
                  type="radio"
                  name="avatarMode"
                  value="chanjing"
                  checked={avatarMode === "chanjing"}
                  onChange={() => setAvatarMode("chanjing")}
                  disabled={pipelineRunning}
                />
                <span>蝉镜 API 对口型（云端，高质量）</span>
              </label>
            </div>
          </section>

          {/* Step 4: Voice */}
          <section className="card">
            <div className="cardTitle apStepSectionTitle">Step 4: 音色选择</div>
            <div className="voice-grid">
              {VOICE_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={`voice-item ${voice === opt.value ? "selected" : ""}`}
                >
                  <input
                    type="radio"
                    name="voice"
                    value={opt.value}
                    checked={voice === opt.value}
                    onChange={() => setVoice(opt.value)}
                    disabled={
                      pipelineRunning ||
                      (audioMode === "api" && EDGE_PRESET_VOICE_VALUES.has(opt.value))
                    }
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>

            {voice === "lekui" && (
              <div className="lekui-info">
                <div className="mini">
                  乐葵参考路径（可设 VITE_LEKUI_VOICE_FILE）: {LEKUI_VOICE_HINT}
                </div>
                <input
                  type="file"
                  accept="audio/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleVoiceFileChange(file);
                  }}
                  className="input"
                  style={{ marginTop: 8 }}
                  disabled={pipelineRunning}
                />
                {voiceUploadProgress && (
                  <div className="upload-progress">{voiceUploadProgress}</div>
                )}
              </div>
            )}

            {audioMode === "api" && voice !== "lekui" && (
              <div style={{ marginTop: 12 }}>
                <label className="label">或上传自定义音色文件</label>
                <input
                  type="file"
                  accept="audio/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleVoiceFileChange(file);
                  }}
                  className="input"
                  disabled={pipelineRunning}
                />
                {voiceUploadProgress && (
                  <div className="upload-progress">{voiceUploadProgress}</div>
                )}
              </div>
            )}
          </section>

          {/* Step 5: Duration + production count（与 IP 大脑 workbench 一致） */}
          <section className="card">
            <div className="cardTitle apStepSectionTitle">Step 5: 目标时长与生产数量</div>
            <label className="label">目标时长（秒）</label>
            <input
              type="text"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              placeholder="如 75 或区间 20-35"
              className="input"
              disabled={pipelineRunning}
            />
            <div className="mini" style={{ marginTop: 4 }}>
              单值或区间；生产数量大于 1 时必须填写。
            </div>
            <label className="label" style={{ marginTop: 12 }}>
              生产数量
            </label>
            <input
              type="number"
              value={productionCount}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                setProductionCount(Number.isNaN(n) ? 1 : Math.min(50, Math.max(1, n)));
              }}
              min={1}
              max={50}
              className="input"
              style={{ width: 120 }}
              disabled={pipelineRunning}
            />
          </section>

          <section className="card">
            <div className="cardTitle apStepSectionTitle">Step 5b: 分身模板</div>
            <label className="label">系统模板（点击小图选用）</label>
            <AvatarSystemTemplateStrip
              templates={avatarTemplates}
              selectedVideoUrl={avatarTemplateVideoUrl}
              onSelectVideoUrl={(url) => {
                setAvatarTemplateVideoUrl(url);
                setAvatarTemplateUploadHint("");
              }}
              disabled={pipelineRunning}
              apiBase={API_BASE}
            />
            <div style={{ marginTop: 10 }}>
              <div className="mini" style={{ marginBottom: avatarTemplateVideoUrl ? 4 : 0 }}>
                {avatarTemplateVideoUrl ? (
                  <>
                    {avatarTemplateKindLabel(avatarTemplateVideoUrl, avatarTemplates)} ·{" "}
                    {fileLabelFromStaticUrl(avatarTemplateVideoUrl)}
                  </>
                ) : (
                  <>当前分身模板 · —</>
                )}
              </div>
              {avatarTemplateVideoUrl ? (
                <div className="step-output-path-rel">接口路径：{avatarTemplateVideoUrl}</div>
              ) : null}
            </div>
            <label className="label" style={{ marginTop: 8 }}>
              或上传口播模板视频（mp4/mov/webm）
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
              <input
                type="file"
                accept="video/mp4,video/quicktime,video/x-matroska,video/webm"
                className="input"
                style={{ flex: "1 1 200px", maxWidth: 360 }}
                disabled={pipelineRunning || avatarTemplateUploadBusy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleAvatarTemplateUpload(f);
                  e.target.value = "";
                }}
              />
              {avatarTemplateUploadHint ? (
                <span
                  className="mini"
                  style={{
                    color:
                      avatarTemplateUploadHint === "上传成功"
                        ? "var(--success, #22c55e)"
                        : avatarTemplateUploadHint.startsWith("上传失败") ||
                            avatarTemplateUploadHint.startsWith("不支持")
                          ? "var(--danger, #f87171)"
                          : "#94a3b8",
                  }}
                >
                  {avatarTemplateUploadHint}
                </span>
              ) : null}
            </div>
          </section>

          {/* Step 6: Banner */}
          <section className="card">
            <div className="cardTitle apStepSectionTitle">Step 6: 横幅文字（可选）</div>
            <label className="label">视频顶部横幅</label>
            <input
              value={banner}
              onChange={(e) => setBanner(e.target.value)}
              placeholder="留空自动生成"
              className="input"
              disabled={pipelineRunning}
            />
          </section>

          {/* Step 7: Media Files */}
          <section className="card">
            <div className="cardTitle apStepSectionTitle">Step 7: 插入素材</div>
            <div className="mini" style={{ marginBottom: 8 }}>
              添加视频/图片素材，会穿插在分身视频中。「选择文件」会先上传到服务器并得到 /static-data/
              路径；浏览器无法把本机磁盘路径直接交给后端。
            </div>

            <input
              type="text"
              placeholder="输入素材路径，按回车添加"
              className="input"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const input = e.target as HTMLInputElement;
                  addMediaFile(input.value);
                  input.value = "";
                }
              }}
              disabled={pipelineRunning}
            />

            <label
              className={`btnGhost ap-file-select-label${pipelineRunning ? " ap-file-select-label--disabled" : ""}`}
              style={{ marginTop: 8 }}
            >
              选择文件
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="video/*,image/*"
                className="ap-file-input-sr"
                disabled={pipelineRunning}
                onChange={async (e) => {
                  await handleInsertMediaFilesSelected(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
            {(insertMediaUploading || insertMediaStatusLines.length > 0) && (
              <div
                className="step-done-hint"
                style={{ marginTop: 8, whiteSpace: "pre-line" }}
              >
                {insertMediaUploading && insertMediaStatusLines.length === 0
                  ? "上传中…"
                  : insertMediaStatusLines.join("\n")}
              </div>
            )}

            {mediaFiles.length > 0 && (
              <div className="media-list">
                {mediaFiles.map((f, i) => (
                  <div key={i} className="media-item">
                    <span className="media-name">{f.split(/[\\/]/).pop()}</span>
                    <button
                      className="btn-remove"
                      onClick={() => removeMediaFile(f)}
                      disabled={pipelineRunning}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {mediaFiles.length === 0 && (
              <div className="empty" style={{ marginTop: 8 }}>
                未添加素材，将只显示分身视频
              </div>
            )}
          </section>
        </div>

        {/* Execute Button */}
        <section className="card execute-section">
          <div className="config-summary">
            <h3>配置摘要</h3>
            <ul>
              <li>URL: {url || "(未设置)"}</li>
              <li>
                音频:{" "}
                {audioMode === "local" ? "系统工具配音（标准 16k 等）" : "高质量 hq（蝉镜仅定制声；否则 Edge）"}
              </li>
              <li>
                分身:{" "}
                {avatarMode === "wav2lip" ? "系统对口型" : "蝉镜 API 对口型"}
              </li>
              <li>音色: {VOICE_OPTIONS.find((v) => v.value === voice)?.label || voice}</li>
              <li>时长: {duration || "(未设置)"}</li>
              <li>生产数量: {productionCount}</li>
              <li>素材: {mediaFiles.length}个</li>
            </ul>
          </div>

          <div className="actions">
            <button
              disabled={!url.trim() || pipelineRunning}
              onClick={executePipeline}
              className="btnPrimary btn-large"
            >
              {pipelineRunning ? "执行中..." : "开始创作"}
            </button>
            {pipelineRunning && (
              <button type="button" onClick={stopPipelineRun} className="btnGhost">
                取消
              </button>
            )}
          </div>
        </section>
        </>
        )}

        {!isAdminRoute && (
        <>
        <section className="card">
          <div className="cardTitle apStepSectionTitle">步骤1｜链接、提取与再创作</div>
          <label className="label">抖音/视频链接</label>
          <input
            value={urlInput}
            onChange={(e) => {
              const v = e.target.value;
              setUrlInput(v);
              setUrl(v);
            }}
            onBlur={(e) => {
              const v = e.currentTarget.value;
              setUrlInput(v);
              setUrl(v);
            }}
            className="input"
            disabled={stepFlowRunning}
          />
          <div className="actions" style={{ marginTop: 12, gap: 8, display: "flex", flexWrap: "wrap" }}>
            <button
              type="button"
              className="btnPrimary"
              disabled={stepFlowRunning || !url.trim()}
              onClick={async () => {
                try {
                  await runStepExtractOnly();
                } catch (e: unknown) {
                  const msg = e instanceof Error ? e.message : String(e);
                  if (msg === "已取消" || (e instanceof Error && e.name === "AbortError")) {
                    addLog("提取已取消", "warn");
                  } else {
                    addLog(`提取失败: ${msg}`, "error");
                  }
                }
              }}
            >
              {stepFlowRunning ? "处理中..." : "提取文案"}
            </button>
            {stepFlowRunning && (
              <button type="button" className="btnGhost" onClick={cancelStepFlow}>
                取消
              </button>
            )}
          </div>
          <div
            style={{
              marginTop: 12,
              display: "grid",
              gridTemplateColumns: "minmax(300px, 1fr) minmax(360px, 1fr)",
              gap: 14,
              alignItems: "start",
            }}
          >
            <div>
              <div className="ap-step1-meta-row" style={{ marginTop: 0 }}>
                <div className="ap-step1-meta-field">
                  <label className="label">目标时长</label>
                  <input
                    type="text"
                    className="input ap-input-2han"
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                    placeholder="例75"
                    title="如 75 或 20-35；框宽约两字，可横向滚动查看"
                    disabled={stepFlowRunning}
                  />
                </div>
                <div className="ap-step1-meta-field">
                  <label className="label">生产数量</label>
                  <input
                    type="number"
                    className="input ap-input-2han"
                    min={1}
                    max={50}
                    value={productionCount}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10);
                      setProductionCount(Number.isNaN(n) ? 1 : Math.min(50, Math.max(1, n)));
                    }}
                    disabled={stepFlowRunning}
                  />
                </div>
              </div>
              <div className="actions" style={{ marginTop: 12, gap: 8, display: "flex", flexWrap: "wrap", alignItems: "center" }}>
                <button
                  type="button"
                  className="btnPrimary"
                  disabled={stepFlowRunning || !stepExtractedText.trim()}
                  onClick={async () => {
                    try {
                      await runStepRegenerate();
                    } catch (e: unknown) {
                      const msg = e instanceof Error ? e.message : String(e);
                      if (msg === "已取消" || (e instanceof Error && e.name === "AbortError")) {
                        addLog("再创作已取消", "warn");
                      } else {
                        addLog(`再创作失败: ${msg}`, "error");
                      }
                    }
                  }}
                >
                  {stepFlowRunning ? "处理中..." : "再创作"}
                </button>
                {stepFlowRunning && (
                  <button type="button" className="btnGhost" onClick={cancelStepFlow}>
                    取消
                  </button>
                )}
                <label
                  className="mini"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    cursor: stepFlowRunning ? "not-allowed" : "pointer",
                    userSelect: "none",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={step1CustomPromptEnabled}
                    onChange={(e) => setStep1CustomPromptEnabled(e.target.checked)}
                    disabled={stepFlowRunning}
                  />
                  自定义提示词
                </label>
              </div>
              {step1CustomPromptEnabled && (
                <textarea
                  className="input"
                  rows={3}
                  style={{ marginTop: 8 }}
                  value={step1CustomPrompt}
                  onChange={(e) => setStep1CustomPrompt(e.target.value)}
                  disabled={stepFlowRunning}
                  placeholder="将与此处原文案一并交给再创作 LLM；须遵守口播格式与关键词来自原文等规则。"
                />
              )}
              <div className="mini" style={{ marginTop: 8 }}>
                提取文案不会自动填入下方「当前口播正文」。点击「再创作」后，按目标时长与生产数量生成口播。
                {step1CustomPromptEnabled ? " 勾选自定义提示词时须填写上方说明。" : ""}
              </div>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
                minWidth: 0,
              }}
            >
              <div>
                <label className="label">#话题</label>
                <div
                  className="input"
                  style={{
                    minHeight: 120,
                    padding: 8,
                    display: "flex",
                    flexWrap: "wrap",
                    alignContent: "flex-start",
                    gap: 6,
                    overflowY: "auto",
                  }}
                >
                  {step1TopicLabels.length > 0 ? (
                    step1TopicLabels.map((k) => (
                      <span key={`step1-topic-${k}`} className="chip" style={{ padding: "2px 8px", borderRadius: 4, background: "var(--chip-bg, #333)" }}>
                        #{k}
                      </span>
                    ))
                  ) : (
                    <span className="mini">提取后在此展示 #话题</span>
                  )}
                </div>
              </div>
              <div>
                <label className="label">原文案</label>
                <textarea
                  value={stepExtractedText}
                  onChange={(e) => setStepExtractedText(e.target.value)}
                  className="input"
                  rows={10}
                  disabled={stepFlowRunning}
                  placeholder="提取后显示于此，也可手动粘贴原文"
                />
              </div>
            </div>
          </div>
          <div className="actions" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btnGhost"
              disabled={stepFlowRunning || !stepExtractedText.trim()}
              onClick={() => {
                setStepExtractedText("");
                addLog("已清空提取原文", "info");
              }}
            >
              清空提取原文
            </button>
            <button
              type="button"
              className="btnGhost"
              disabled={stepFlowRunning || step1TopicLabels.length === 0}
              onClick={() => {
                setStepKeywords([]);
                addLog("已清空步骤1话题", "info");
              }}
            >
              清空话题
            </button>
            <button
              type="button"
              className="btnGhost"
              disabled={stepFlowRunning}
              onClick={clearAllStep1Content}
            >
              清空全部口播与音频记录
            </button>
          </div>
          {stepFlow.title && (
            <div className="upload-progress" style={{ marginTop: 8 }}>
              当前选中标题：{stepFlow.title}
            </div>
          )}
          <label className="label" style={{ marginTop: 12 }}>
            当前口播正文（可改）
          </label>
          <div className="mini" style={{ marginBottom: 8 }}>
            {
              "规范：上方写 #话题（可多行）；单独一行「正文」；其下为口播正文（仅此段参与 TTS；无「正文」行时整段朗读）。再创作条数为 N 时生成 N 个输入框；步骤2 为每条有正文的块各生成一条音频；步骤3 勾选其中一条音频生成分身；步骤4（有分身）用该分身与插入素材混剪一条成片。"
            }
          </div>
          {stepScriptLines.map((line, i) => (
            <div
              key={`script-line-${i}`}
              style={{
                marginTop: 10,
                paddingLeft: 10,
                borderLeft: "3px solid var(--chip-bg, #444)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  marginBottom: 6,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flex: "1 1 auto",
                  }}
                >
                  <span>
                    第 {i + 1} 条{stepVariants[i]?.title ? ` · ${stepVariants[i].title}` : ""}
                    {stepVariants[i]?.target_seconds ? ` · 约 ${stepVariants[i].target_seconds} 秒` : ""}
                  </span>
                </div>
                <button
                  type="button"
                  className="btnGhost"
                  style={{ fontSize: 12, padding: "4px 10px", flex: "0 0 auto" }}
                  disabled={stepFlowRunning || stepScriptLines.length <= 1}
                  title={stepScriptLines.length <= 1 ? "至少保留一条" : "删除本条文案与对应音频槽"}
                  onClick={() => removeStepScriptLine(i)}
                >
                  删除本条
                </button>
              </div>
              <textarea
                value={line}
                onChange={(e) => {
                  const v = e.target.value;
                  setStepScriptLines((prev) => {
                    const next = [...prev];
                    next[i] = v;
                    return next;
                  });
                }}
                className="input"
                rows={4}
                disabled={stepFlowRunning}
                placeholder={
                  i === 0
                    ? "#话题1#话题2\n正文\n*------"
                    : `第 ${i + 1} 条（同上格式：话题 / 正文）`
                }
              />
            </div>
          ))}
          <button
            type="button"
            className="btnGhost"
            style={{ marginTop: 10 }}
            disabled={stepFlowRunning}
            onClick={() => {
              setStepScriptLines((p) => [...p, ""]);
              setStepAudioUrls((p) => [...p, ""]);
            }}
          >
            + 添加一条文案
          </button>
        </section>

        <section className="card">
          <div className="cardTitle apStepSectionTitle">步骤2｜生产音频</div>
          {externalChanjingApiBlock}
          <div className="radio-group">
            <label className={`radio-item ${audioMode === "local" ? "selected" : ""}`}>
              <input
                type="radio"
                name="stepAudioMode"
                checked={audioMode === "local"}
                onChange={() => setAudioMode("local")}
                disabled={stepFlowRunning}
              />
              <span>系统工具配音</span>
            </label>
            <label className={`radio-item ${audioMode === "api" ? "selected" : ""}`}>
              <input
                type="radio"
                name="stepAudioMode"
                checked={audioMode === "api"}
                onChange={() => setAudioMode("api")}
                disabled={stepFlowRunning}
              />
              <span>
                蝉镜：仅乐葵上传后的蝉镜 ID（走云端合成）；晓晓/云希请用「系统工具配音」
              </span>
            </label>
          </div>
          <div className="voice-grid" style={{ marginTop: 12 }}>
            {VOICE_OPTIONS.map((opt) => (
              <label key={opt.value} className={`voice-item ${voice === opt.value ? "selected" : ""}`}>
                <input
                  type="radio"
                  name="stepVoice"
                  value={opt.value}
                  checked={voice === opt.value}
                  onChange={() => setVoice(opt.value)}
                  disabled={
                    stepFlowRunning ||
                    (audioMode === "api" && EDGE_PRESET_VOICE_VALUES.has(opt.value))
                  }
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>
          {voice === "lekui" && audioMode === "api" && (
            <div style={{ marginTop: 8 }}>
              <label
                className={`btnGhost ap-file-select-label${stepFlowRunning ? " ap-file-select-label--disabled" : ""}`}
              >
                上传音色
                <input
                  type="file"
                  accept="audio/*"
                  className="ap-file-input-sr"
                  disabled={stepFlowRunning}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleVoiceFileChange(file);
                    e.target.value = "";
                  }}
                />
              </label>
              {voiceUploadProgress && <div className="upload-progress">{voiceUploadProgress}</div>}
              <div className="mini" style={{ marginTop: 8, lineHeight: 1.45, opacity: 0.92 }}>
                蝉镜定制音色：请尽量一口气录 <strong>15～40 秒</strong>清晰口播、少长停顿；平台要求约{" "}
                <strong>10 秒连续说话</strong>，句间空白过长易报错。服务端会自动压短静音并重采样后再上传。
              </div>
            </div>
          )}
          <div className="actions" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btnPrimary"
              disabled={
                stepFlowRunning ||
                !stepScriptLines.some((s) => extractTtsBodyFromScriptBlock(s).length > 0)
              }
              onClick={async () => {
                try {
                  await runStep2ProduceAudio();
                } catch (e: unknown) {
                  const msg = e instanceof Error ? e.message : String(e);
                  if (msg === "已取消" || (e instanceof Error && e.name === "AbortError")) {
                    addLog("步骤2已取消", "warn");
                  } else {
                    addLog(`步骤2失败: ${msg}`, "error");
                  }
                }
              }}
            >
              {stepFlowRunning ? "处理中..." : "生成音频"}
            </button>
            {stepFlowRunning && (
              <button type="button" className="btnGhost" onClick={cancelStepFlow}>
                取消
              </button>
            )}
            {step2DoneHint && <span className="step-done-hint">{step2DoneHint}</span>}
          </div>
          {stepAudioUrls.some((u) => u) && (
            <div style={{ marginTop: 12 }}>
              <div className="label">
                已生成音频（步骤3 请勾选其中一条；步骤4 选「不用分身」时可按多条口播批量出片）
              </div>
              {stepAudioUrls.map((u, i) =>
                u ? (
                  <div key={`aud-${i}`} className="step-media-block ap-audio-toolbar-block" style={{ marginTop: 8 }}>
                    <div className="mini" style={{ marginBottom: 4 }}>
                      第 {i + 1} 条
                    </div>
                    <div className="ap-audio-toolbar-row">
                      <audio
                        ref={(el) => {
                          stepAudioElementsRef.current[i] = el;
                        }}
                        className="mini-player mini-player--audio ap-audio-toolbar-player"
                        controls
                        src={publicAssetAbsoluteUrl(API_BASE, u)}
                        preload="metadata"
                        onLoadedMetadata={(e) => {
                          e.currentTarget.playbackRate = stepAudioPlaybackRates[i] ?? 1;
                        }}
                      />
                      <div className="ap-audio-toolbar-actions">
                        <label className="ap-audio-rate-label">
                          倍速
                          <select
                            className="ap-audio-rate-select"
                            value={stepAudioPlaybackRates[i] ?? 1}
                            onChange={(e) => {
                              const r = parseFloat(e.target.value);
                              setStepAudioPlaybackRates((prev) => {
                                const next = [...prev];
                                next[i] = r;
                                return next;
                              });
                              const el = stepAudioElementsRef.current[i];
                              if (el) el.playbackRate = r;
                            }}
                          >
                            <option value={0.75}>0.75×</option>
                            <option value={1}>1×</option>
                            <option value={1.25}>1.25×</option>
                            <option value={1.5}>1.5×</option>
                            <option value={2}>2×</option>
                          </select>
                        </label>
                        <a
                          className="btnGhost ap-audio-dl"
                          href={publicAssetAbsoluteUrl(API_BASE, u)}
                          download
                          target="_blank"
                          rel="noreferrer"
                        >
                          下载
                        </a>
                        <details className="ap-audio-more">
                          <summary className="ap-audio-more-btn" title="更多">
                            ⋯
                          </summary>
                          <div className="ap-audio-more-panel">
                            <button
                              type="button"
                              className="ap-audio-more-item"
                              onClick={(e) => {
                                clearStepAudioAt(i);
                                const d = (e.currentTarget as HTMLElement).closest("details");
                                if (d) (d as HTMLDetailsElement).open = false;
                              }}
                            >
                              删除本条音频
                            </button>
                          </div>
                        </details>
                      </div>
                    </div>
                    <div className="step-output-path-rel">接口路径：{u}</div>
                  </div>
                ) : null
              )}
            </div>
          )}
        </section>

        <section className="card">
          <div className="cardTitle apStepSectionTitle">步骤3｜分身口播视频</div>
          <p className="mini" style={{ margin: "0 0 10px", color: "#94a3b8" }}>
            若使用下方「蝉镜 API 对口型」，蝉镜账号与步骤2 顶部「外部蝉镜 API」相同，无需重复填写。
          </p>
          <div className="radio-group">
            <label className={`radio-item ${avatarMode === "wav2lip" ? "selected" : ""}`}>
              <input
                type="radio"
                name="stepAvatarMode"
                checked={avatarMode === "wav2lip"}
                onChange={() => setAvatarMode("wav2lip")}
                disabled={stepFlowRunning}
              />
              <span>系统对口型</span>
            </label>
            <label className={`radio-item ${avatarMode === "chanjing" ? "selected" : ""}`}>
              <input
                type="radio"
                name="stepAvatarMode"
                checked={avatarMode === "chanjing"}
                onChange={() => setAvatarMode("chanjing")}
                disabled={stepFlowRunning}
              />
              <span>蝉镜 API 对口型</span>
            </label>
          </div>
          <label className="label" style={{ marginTop: 8 }}>
            系统分身模板（点击小图选用，再点「生成分身视频」）
          </label>
          <AvatarSystemTemplateStrip
            templates={avatarTemplates}
            selectedVideoUrl={avatarTemplateVideoUrl}
            onSelectVideoUrl={(url) => {
              setAvatarTemplateVideoUrl(url);
              setAvatarTemplateUploadHint("");
            }}
            disabled={stepFlowRunning}
            apiBase={API_BASE}
          />
          <div style={{ marginTop: 10 }}>
            <div className="mini" style={{ marginBottom: avatarTemplateVideoUrl ? 4 : 0 }}>
              {avatarTemplateVideoUrl ? (
                <>
                  {avatarTemplateKindLabel(avatarTemplateVideoUrl, avatarTemplates)} ·{" "}
                  {fileLabelFromStaticUrl(avatarTemplateVideoUrl)}
                </>
              ) : (
                <>当前分身模板 · —</>
              )}
            </div>
            {avatarTemplateVideoUrl ? (
              <div className="step-output-path-rel">接口路径：{avatarTemplateVideoUrl}</div>
            ) : null}
          </div>
          <label className="label" style={{ marginTop: 12 }}>
            选用哪条步骤2 音频生成分身（单选，仅列出已生成音频）
          </label>
          <div
            className="ap-step3-audio-pick"
            style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}
          >
            {stepAudioUrls.map((u, i) =>
              (u || "").trim() ? (
                <label
                  key={`step3-pick-${i}`}
                  style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}
                >
                  <input
                    type="radio"
                    name="step3AudioLine"
                    checked={step3SelectedAudioIndex === i}
                    onChange={() => {
                      setStep3SelectedAudioIndex(i);
                      setStep3AvatarVideoUrl("");
                    }}
                    disabled={stepFlowRunning}
                  />
                  <span className="mini">
                    第 {i + 1} 条 · {fileLabelFromStaticUrl(u)}
                  </span>
                </label>
              ) : null
            )}
            {!stepAudioUrls.some((u) => (u || "").trim()) && (
              <span className="mini" style={{ color: "#94a3b8" }}>
                暂无已生成音频，请先在步骤2 生产音频
              </span>
            )}
          </div>
          <div
            style={{
              marginTop: 8,
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "10px 14px",
            }}
          >
            <label
              className={`btnGhost ap-file-select-label${
                stepFlowRunning || avatarTemplateUploadBusy ? " ap-file-select-label--disabled" : ""
              }`}
              style={{ marginTop: 0 }}
            >
              上传分身模版
              <input
                type="file"
                accept="video/mp4,video/quicktime,video/x-matroska,video/webm"
                className="ap-file-input-sr"
                disabled={stepFlowRunning || avatarTemplateUploadBusy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleAvatarTemplateUpload(f);
                  e.target.value = "";
                }}
              />
            </label>
            {avatarTemplateUploadHint ? (
              <span
                className="mini"
                style={{
                  color:
                    avatarTemplateUploadHint === "上传成功"
                      ? "var(--success, #22c55e)"
                      : avatarTemplateUploadHint.startsWith("上传失败") ||
                          avatarTemplateUploadHint.startsWith("不支持")
                        ? "var(--danger, #f87171)"
                        : "#94a3b8",
                  maxWidth: "min(100%, 28rem)",
                }}
              >
                {avatarTemplateUploadHint}
              </span>
            ) : null}
          </div>
          <div className="mini" style={{ color: "#94a3b8", marginTop: 6 }}>
            文件过大可能导致成品失败
          </div>
          <div className="actions" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btnPrimary"
              disabled={
                stepFlowRunning ||
                !stepAudioUrls.some((u) => (u || "").trim()) ||
                !stepAudioUrls[step3SelectedAudioIndex]?.trim()
              }
              onClick={async () => {
                try {
                  await runStep3ProduceAvatar();
                } catch (e: unknown) {
                  const msg = e instanceof Error ? e.message : String(e);
                  if (msg === "已取消" || (e instanceof Error && e.name === "AbortError")) {
                    addLog("步骤3已取消", "warn");
                  } else {
                    addLog(`步骤3失败: ${msg}`, "error");
                  }
                }
              }}
            >
              {stepFlowRunning ? "处理中..." : "生成分身视频"}
            </button>
            {stepFlowRunning && (
              <button type="button" className="btnGhost" onClick={cancelStepFlow}>
                取消
              </button>
            )}
            {step3DoneHint && <span className="step-done-hint">{step3DoneHint}</span>}
          </div>
          {step3AvatarVideoUrl.trim() ? (
            <div style={{ marginTop: 12 }}>
              <div className="label">
                已生成分身口播视频（对应第 {step3SelectedAudioIndex + 1} 条步骤2 音频）
              </div>
              <div className="step-media-block" style={{ marginTop: 8 }}>
                <div className="mini" style={{ marginBottom: 4 }}>
                  {fileLabelFromStaticUrl(step3AvatarVideoUrl)}
                </div>
                <video
                  className="mini-player mini-player--video"
                  controls
                  playsInline
                  src={publicAssetAbsoluteUrl(API_BASE, step3AvatarVideoUrl)}
                  preload="metadata"
                />
                <div className="step-output-path-rel">接口路径：{step3AvatarVideoUrl}</div>
              </div>
            </div>
          ) : null}
        </section>

        <section className="card">
          <div className="cardTitle apStepSectionTitle">步骤4｜合成混剪</div>
          <div className="ap-step4-compose-opts" style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
            <span
              className="label"
              style={{ margin: 0, display: "inline-flex", alignItems: "center", gap: 8 }}
              title="步骤4 多条成片同时 POST /compose/async 的并发数，固定为 2"
            >
              批量并发：
              <span className="input" style={{ width: 72, display: "inline-flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box", opacity: 0.85 }}>
                {STEP4_COMPOSE_CONCURRENCY}
              </span>
              <span className="mini">（固定，不可改）</span>
            </span>
            <label className="label" style={{ margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={step4ComposeUseProxyMedia}
                onChange={(e) => setStep4ComposeUseProxyMedia(e.target.checked)}
                disabled={stepFlowRunning}
              />
              合成使用代理素材路径（若出现错误请勾选这里再次提交任务）
            </label>
          </div>
          <label className="label" style={{ marginTop: 12 }}>
            横幅（可选，与自动生成共用并持久化）
          </label>
          <input
            value={banner}
            onChange={(e) => setBanner(e.target.value)}
            placeholder="留空则按后端默认；与自动生成 Step6 相同"
            className="input"
            disabled={stepFlowRunning}
          />
          <label className="label" style={{ marginTop: 12 }}>
            插入素材（与自动生成列表共用）
          </label>
          <div className="mini" style={{ marginBottom: 8 }}>
            路径与自动生成 Step7 一致。选「用分身」时与步骤3 分身按切播规则混剪；选「不用分身」时仅用素材与口播音频混剪。「选择文件」会先上传至后端再参与合成。
          </div>
          <input
            type="text"
            placeholder="输入素材路径，按回车添加"
            className="input"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const input = e.target as HTMLInputElement;
                addMediaFile(input.value);
                input.value = "";
              }
            }}
            disabled={stepFlowRunning}
          />
          <label
            className={`btnGhost ap-file-select-label${stepFlowRunning ? " ap-file-select-label--disabled" : ""}`}
            style={{ marginTop: 8 }}
          >
            选择文件
            <input
              ref={stepInsertFileRef}
              type="file"
              multiple
              accept="video/*,image/*"
              className="ap-file-input-sr"
              disabled={stepFlowRunning}
              onChange={async (e) => {
                await handleInsertMediaFilesSelected(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          {(insertMediaUploading || insertMediaStatusLines.length > 0) && (
            <div
              className="step-done-hint"
              style={{ marginTop: 8, whiteSpace: "pre-line" }}
            >
              {insertMediaUploading && insertMediaStatusLines.length === 0
                ? "上传中…"
                : insertMediaStatusLines.join("\n")}
            </div>
          )}
          {mediaFiles.length > 0 && (
            <div className="media-list">
              {mediaFiles.map((f, i) => (
                <div key={i} className="media-item">
                  <span className="media-name">{f.split(/[\\/]/).pop()}</span>
                  <button
                    type="button"
                    className="btn-remove"
                    onClick={() => removeMediaFile(f)}
                    disabled={stepFlowRunning}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          {mediaFiles.length === 0 && (
            <div className="empty" style={{ marginTop: 8 }}>
              未添加素材时：步骤4 选「用分身」则主画面为分身视频；选「不用分身即可」且无素材时按口播音频+字幕成片。
            </div>
          )}
          <div className="label" style={{ marginTop: 12 }}>
            合成模式
          </div>
          <div
            className="radio-group"
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              alignItems: "center",
              marginTop: 8,
              gap: 12,
            }}
          >
            <label className={`radio-item ${!stepComposeNoAvatar ? "selected" : ""}`}>
              <input
                type="radio"
                name="step4ComposeMode"
                checked={!stepComposeNoAvatar}
                onChange={() => setStepComposeNoAvatar(false)}
                disabled={stepFlowRunning}
              />
              <span>用分身</span>
            </label>
            <label className={`radio-item ${stepComposeNoAvatar ? "selected" : ""}`}>
              <input
                type="radio"
                name="step4ComposeMode"
                checked={stepComposeNoAvatar}
                onChange={() => setStepComposeNoAvatar(true)}
                disabled={stepFlowRunning}
              />
              <span>不用分身即可</span>
            </label>
          </div>
          <div className="mini" style={{ marginTop: 8, color: "#94a3b8", lineHeight: 1.5 }}>
            用分身：使用步骤3 分身口播与上方素材混剪。不用分身即可：仅用步骤2 口播与素材混剪（可批量）。
          </div>
          <div className="label" style={{ marginTop: 12 }}>
            成片特效
          </div>
          <div
            className="radio-group"
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              alignItems: "center",
              marginTop: 8,
              gap: 12,
            }}
          >
            <label className={`radio-item ${step4ComposeEffectsMode === "weak" ? "selected" : ""}`}>
              <input
                type="radio"
                name="step4ComposeEffectsMode"
                checked={step4ComposeEffectsMode === "weak"}
                onChange={() => setStep4ComposeEffectsMode("weak")}
                disabled={stepFlowRunning}
              />
              <span>启用弱特效（防备算法标记为同类作品）</span>
            </label>
            <label className={`radio-item ${step4ComposeEffectsMode === "none" ? "selected" : ""}`}>
              <input
                type="radio"
                name="step4ComposeEffectsMode"
                checked={step4ComposeEffectsMode === "none"}
                onChange={() => setStep4ComposeEffectsMode("none")}
                disabled={stepFlowRunning}
              />
              <span>无特效</span>
            </label>
          </div>
          <div className="mini" style={{ marginTop: 8, color: "#94a3b8", lineHeight: 1.5 }}>
            弱特效：服务端按现有规则叠加段内弱滤镜与镜间转场（与历史默认一致），FFmpeg
            阶段更多、耗时往往明显长于「无特效」，多素材时更易长时间显示「处理中」。无特效：成片不叠加这些弱滤镜与转场。
            <br />
            <span style={{ color: "#cbd5e1" }}>
              若长时间无进展：请先点下方「取消」停止本页等待（会请求后端标记取消；已跑起来的编码可能仍要稍后结束）。仍卡住可查后端终端 ffmpeg
              日志，或改选「无特效」后重试。
            </span>
          </div>
          <div
            className="upload-progress"
            style={{
              marginTop: 10,
              padding: "10px 12px",
              borderRadius: 8,
              background: "rgba(99,102,241,0.12)",
              border: "1px solid rgba(148,163,184,0.25)",
            }}
          >
            {stepComposeNoAvatar ? (
              <>
                <div className="label" style={{ marginBottom: 6 }}>
                  当前「不用分身」：本批将使用的步骤2 口播音频（共{" "}
                  {stepAudioUrls.filter((u) => (u || "").trim()).length} 条）
                </div>
                <div className="mini" style={{ lineHeight: 1.7 }}>
                  {stepAudioUrls.some((u) => (u || "").trim()) ? (
                    <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
                      {stepAudioUrls.map((u, i) =>
                        (u || "").trim() ? (
                          <li key={`step4-aud-${i}`}>
                            第 {i + 1} 条：{fileLabelFromStaticUrl(u)}
                          </li>
                        ) : null
                      )}
                    </ul>
                  ) : (
                    <span className="apiVal">（尚无步骤2 音频，请先在步骤2 生成）</span>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="label" style={{ marginBottom: 6 }}>
                  当前「用分身」：步骤3 的 1 条分身视频 + 本页插入素材 + 第 {step3SelectedAudioIndex + 1}{" "}
                  条步骤2 口播音频
                </div>
                <div className="mini" style={{ lineHeight: 1.7 }}>
                  {step3AvatarVideoUrl.trim() ? (
                    <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
                      <li>分身：{fileLabelFromStaticUrl(step3AvatarVideoUrl)}</li>
                      <li>
                        口播音频（第 {step3SelectedAudioIndex + 1} 条）：
                        {stepAudioUrls[step3SelectedAudioIndex]?.trim()
                          ? fileLabelFromStaticUrl(stepAudioUrls[step3SelectedAudioIndex])
                          : "—"}
                      </li>
                    </ul>
                  ) : (
                    <span className="apiVal">（请先在步骤3 勾选音频并生成分身口播视频）</span>
                  )}
                </div>
              </>
            )}
          </div>
          <div className="actions" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btnPrimary"
              disabled={
                stepFlowRunning ||
                (stepComposeNoAvatar
                  ? !stepAudioUrls.some((u) => (u || "").trim())
                  : !step3AvatarVideoUrl.trim() ||
                    !stepAudioUrls[step3SelectedAudioIndex]?.trim())
              }
              onClick={async () => {
                try {
                  await runStep4Compose();
                } catch (e: unknown) {
                  const msg = e instanceof Error ? e.message : String(e);
                  if (
                    msg === "已取消" ||
                    msg === "合成已取消" ||
                    msg.includes("合成等待超时")
                  ) {
                    addLog(
                      msg.includes("超时") ? `步骤4：${msg}` : "步骤4已取消或合成已终止",
                      msg.includes("超时") ? "error" : "warn"
                    );
                  } else {
                    addLog(`步骤4失败: ${msg}`, "error");
                  }
                }
              }}
            >
              {stepFlowRunning
                ? "处理中..."
                : stepComposeNoAvatar
                  ? "执行混剪（纯素材）"
                  : "执行混剪（分身+素材）"}
            </button>
            {stepFlowRunning && (
              <button type="button" className="btnGhost" onClick={cancelStepFlow}>
                取消（断开等待）
              </button>
            )}
            {step4DoneHint && <span className="step-done-hint">{step4DoneHint}</span>}
          </div>
          {stepFlow.finalJobId ? (
            <div
              className={stepFlowRunning ? "mini" : "upload-progress"}
              style={stepFlowRunning ? { marginTop: 8, color: "#94a3b8" } : undefined}
            >
              {stepFlowRunning ? (
                <>
                  当前合成任务 ID：<span className="apiVal">{stepFlow.finalJobId}</span>
                  （点「取消」可断开本页等待；取消后后端可能仍短暂显示进行中，属正常现象）
                </>
              ) : (
                <>最近任务ID：{stepFlow.finalJobId}</>
              )}
            </div>
          ) : null}
          {step4BatchVideoUrls.length > 0 ? (
            <div style={{ marginTop: 12 }}>
              <div className="label">本批成片（共 {step4BatchVideoUrls.length} 个，内容互不相同）</div>
              {step4BatchVideoUrls.map((vu, idx) => (
                <div key={`batch-out-${idx}`} className="step-media-block" style={{ marginTop: 10 }}>
                  <div className="mini" style={{ marginBottom: 4 }}>
                    第 {idx + 1} 个 · {fileLabelFromStaticUrl(vu)}
                  </div>
                  <video
                    className="mini-player mini-player--video"
                    controls
                    playsInline
                    src={publicAssetAbsoluteUrl(API_BASE, vu)}
                    preload="metadata"
                  />
                  <div className="step-output-path-rel">接口路径：{vu}</div>
                </div>
              ))}
            </div>
          ) : (
            stepFlow.finalVideoUrl && (
              <div className="step-media-block" style={{ marginTop: 12 }}>
                <video
                  className="mini-player mini-player--video"
                  controls
                  playsInline
                  src={publicAssetAbsoluteUrl(API_BASE, stepFlow.finalVideoUrl)}
                  preload="metadata"
                />
                <div className="step-output-path">
                  <div className="step-output-path-label">生产文件（点击打开或复制链接）</div>
                  <a
                    className="step-output-path-link"
                    href={publicAssetAbsoluteUrl(API_BASE, stepFlow.finalVideoUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {publicAssetAbsoluteUrl(API_BASE, stepFlow.finalVideoUrl)}
                  </a>
                  <div className="step-output-path-rel">接口路径：{stepFlow.finalVideoUrl}</div>
                </div>
              </div>
            )
          )}
        </section>

        <section className="card">
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 8,
              marginBottom: step5AdminUnlocked ? 4 : 0,
            }}
          >
            <div className="cardTitle apStepSectionTitle" style={{ margin: 0 }}>
              管理员入口
            </div>
            {step5AdminUnlocked ? (
              <button
                type="button"
                className="btnGhost"
                onClick={() => {
                  setStep5AdminUnlocked(false);
                  try {
                    sessionStorage.removeItem("ap_step5_admin_unlocked");
                  } catch {
                    /* ignore */
                  }
                }}
              >
                隐藏
              </button>
            ) : null}
          </div>
          {!step5AdminUnlocked ? (
            <div style={{ marginTop: 8 }}>
              <div className="mini" style={{ marginBottom: 10, color: "#94a3b8" }}>
                步骤5（手机发布）为隐藏功能，输入访问码 <strong>0000</strong> 后显示。
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  className="input"
                  style={{ width: 120 }}
                  placeholder="访问码"
                  value={step5AdminPinInput}
                  onChange={(e) => {
                    setStep5AdminPinInput(e.target.value);
                    setStep5AdminPinError("");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (step5AdminPinInput === "0000") {
                        setStep5AdminUnlocked(true);
                        try {
                          sessionStorage.setItem("ap_step5_admin_unlocked", "1");
                        } catch {
                          /* ignore */
                        }
                        setStep5AdminPinInput("");
                        setStep5AdminPinError("");
                      } else {
                        setStep5AdminPinError("访问码错误");
                      }
                    }
                  }}
                />
                <button
                  type="button"
                  className="btnPrimary"
                  onClick={() => {
                    if (step5AdminPinInput === "0000") {
                      setStep5AdminUnlocked(true);
                      try {
                        sessionStorage.setItem("ap_step5_admin_unlocked", "1");
                      } catch {
                        /* ignore */
                      }
                      setStep5AdminPinInput("");
                      setStep5AdminPinError("");
                    } else {
                      setStep5AdminPinError("访问码错误");
                    }
                  }}
                >
                  进入
                </button>
              </div>
              {step5AdminPinError ? (
                <div className="mini" style={{ color: "var(--err, #c44)", marginTop: 8 }}>
                  {step5AdminPinError}
                </div>
              ) : null}
            </div>
          ) : (
            <>
              <div className="label" style={{ marginTop: 4, marginBottom: 8 }}>
                步骤5｜手机发布
              </div>
              <div className="label" style={{ marginTop: 12 }}>
                发布文案（每行对应一台勾选设备；与成片第 1、2… 行对齐；点「发布」时以此为准）
              </div>
              <div className="mini" style={{ marginTop: 4, marginBottom: 8, lineHeight: 1.5 }}>
                真机流程：推送视频并选片成功后 → 两次「下一步」→ 点「#话题」→ 粘贴<strong>步骤4 横幅 + 下方本行 # 话题</strong>（由系统自动拼接）→ 最后点「发布」。
                下方<strong>每行只写 5 个 #话题</strong>（# 与 # 之间可空格），例如：
                <span className="apiVal"> #硬核护肤 #老板说实话 #性价比王 #美妆源头 #变美小技巧</span>
                ；步骤4「横幅」当前为：
                <span className="apiVal"> {banner.trim() ? banner.trim() : "（未填写，将只写入话题行）"}</span>
                。拼接结果示例：
                <span className="apiVal">
                  {banner.trim()
                    ? `${banner.trim()}#硬核护肤 #老板说实话 #性价比王 #美妆源头 #变美小技巧`
                    : "#硬核护肤 #老板说实话 #性价比王 #美妆源头 #变美小技巧"}
                </span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 6 }}>
                <button
                  type="button"
                  className="btnGhost"
                  disabled={!!step5Busy || stepFlowRunning}
                  onClick={() => {
                    if (step1TopicLabels.length === 0) {
                      addLog("步骤1 尚无 #话题：请先「提取文案」或维护关键词后再试。", "warn");
                      return;
                    }
                    const gc = Math.max(1, Math.min(50, productionCount));
                    setStep5HashtagLinesText(buildStep5HashtagLinesFromStep1TopicGroups(step1TopicLabels, gc));
                    addLog(
                      `步骤5：已按步骤1 #话题 填入 ${gc} 行（每行 5 个 #，空格分隔）；点「发布」时会自动在各行前追加步骤4「横幅」。`,
                      "info",
                    );
                    if (step5PathLines.length > 0 && step5PathLines.length !== gc) {
                      addLog(
                        `提示：当前成片路径 ${step5PathLines.length} 行，与本次填入的 ${gc} 行发布文案数量不一致，发布前请对齐。`,
                        "warn",
                      );
                    }
                  }}
                  title="按「生产数量」生成多行：每行仅含步骤1 中第 1～5、6～10… 个 # 话题（空格分隔）；发布时再拼步骤4 横幅"
                >
                  使用步骤1的#话题
                </button>
                <span className="mini">每行仅 # 话题；横幅一律用步骤4 里填写的「横幅」。</span>
              </div>
              <textarea
                className="input"
                rows={4}
                style={{ width: "100%", fontFamily: "inherit", resize: "vertical" }}
                placeholder={
                  "#硬核护肤 #老板说实话 #性价比王 #美妆源头 #变美小技巧\n（每行一条，须恰好 5 个 #；横幅在步骤4 填写，发布时自动加在本行前）"
                }
                value={step5HashtagLinesText}
                onChange={(e) => setStep5HashtagLinesText(e.target.value)}
                disabled={!!step5Busy}
              />
          <div
            style={{
              marginTop: 12,
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <label className="label" style={{ marginTop: 0, flex: "1 1 240px" }}>
              成片路径（每行一条；步骤4 每完成一整批混剪后会用本批成品路径整框替换，也可手改）
            </label>
            <button
              type="button"
              className="btnGhost"
              style={{ flex: "0 0 auto" }}
              disabled={
                !!step5Busy ||
                stepFlowRunning ||
                (step4BatchVideoUrls.filter((u) => (u || "").trim()).length === 0 &&
                  !(stepFlow.finalVideoUrl || "").trim())
              }
              title="填入步骤4 最近一次混剪的全部成品路径（仅一条成片时也可用）；替换当前文本框内容"
              onClick={() => importStep4OutputsToStep5Paths()}
            >
              导入步骤4成品路径
            </button>
          </div>
          <textarea
            className="input"
            rows={5}
            style={{ width: "100%", fontFamily: "inherit", resize: "vertical" }}
            placeholder={"/static-data/compose_jobs/xxx/out.mp4\n/static-data/..."}
            value={step5PathsText}
            onChange={(e) => setStep5PathsText(e.target.value)}
            disabled={!!step5Busy}
          />
          <div className="mini" style={{ marginTop: 8 }}>
            步骤1 关键词预览：{" "}
            {stepKeywords.length > 0 ? (
              <span className="apiVal">{formatStep5HashtagPreview(stepKeywords)}</span>
            ) : (
              <span className="apiVal">（空）</span>
            )}
            {" · 以「发布文案」多行框为准"}
          </div>
          <div className="mini" style={{ marginTop: 4 }}>
            描述预览（第 1 条口播 · 正文段，用于发布描述）：{" "}
            <span className="apiVal">
              {extractTtsBodyFromScriptBlock(stepScriptLines[0] ?? "").trim() || "（空）"}
            </span>
          </div>
          <div
            className="mini"
            style={{
              marginTop: 10,
              padding: "8px 10px",
              borderRadius: 8,
              background: step5PublishCountsOk ? "rgba(34,197,94,0.12)" : "rgba(251,191,36,0.15)",
            }}
          >
            发布数量校验：勾选设备 <strong>{step5SelectedDeviceSerials.length}</strong> 台 · 成片路径{" "}
            <strong>{step5PathLines.length}</strong> 行 · 发布文案 <strong>{step5HashtagLines.length}</strong> 行
            {step5PublishCountsOk ? (
              <span> — 数量一致且每行含恰好 5 个 #话题；发布时将自动加上步骤4「横幅」。</span>
            ) : (
              <span> — 勾选设备数、成片路径行数须一致，且前 N 行各含恰好 5 个 #话题（横幅在步骤4 填写）。</span>
            )}
          </div>
          <div className="ap-step5-actions" style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button
              type="button"
              className="btnGhost"
              disabled={!!step5Busy || stepFlowRunning}
              onClick={() => void fetchPhoneDevices()}
            >
              {step5Busy === "devices" ? "扫描中…" : "扫描手机设备"}
            </button>
            <button
              type="button"
              className="btnGhost"
              disabled={
                !!step5Busy ||
                stepFlowRunning ||
                phoneDevices.length === 0 ||
                step5SelectedDeviceSerials.length === 0
              }
              onClick={() => void scanPhoneDouyinAccounts()}
              title="仅在下方列表中已勾选的设备上打开抖音"
            >
              {step5Busy === "scan" ? "打开中…" : "扫描抖音"}
            </button>
            <button
              type="button"
              className="btnGhost"
              disabled={
                !!step5Busy ||
                stepFlowRunning ||
                phoneDevices.length === 0 ||
                step5SelectedDeviceSerials.length === 0
              }
              onClick={() => void pocPhonePublishEntry()}
              title="仅在已勾选设备上：先强制停止抖音再打开 → 点「+」→ 点「相册」；不选片、不发布"
            >
              {step5Busy === "poc" ? "测试中…" : "抖音→+→相册"}
            </button>
            <button
              type="button"
              className="btnGhost"
              onClick={() => void abortPhonePublishAction()}
              title="向服务端发送终止：将强制停止抖音（adb force-stop）并置取消标记；多设备连接时可能对每台手机执行。无任务时无害。"
              style={{ borderColor: "var(--err, #c44)", color: "var(--err, #c44)" }}
            >
              终止动作
            </button>
            <button
              type="button"
              className="btnGhost"
              disabled={!!step5Busy || stepFlowRunning}
              title="adb push 成片 → 抖音内全流程；默认演练不点发作品。若首页出现「存草稿 / 去编辑」弹窗，服务端会先点去编辑→返回→不保存返回再回到 +→相册…（数量不一致时点击后会有提示）"
              onClick={() => void publishPhoneOnDevice(true)}
            >
              {step5Busy === "device_flow" ? "手机发布中…" : "手机完整发布（演练）"}
            </button>
            <button
              type="button"
              className="btnPrimary"
              disabled={!!step5Busy || stepFlowRunning}
              title="真发：push 成片 → 选片 → 两次下一步 → 点#话题 → 粘贴「发布文案」整行 → 点发布。成片、设备、文案行一一对齐。"
              onClick={() => void publishPhoneOnDevice(false)}
            >
              {step5Busy === "device_flow" ? "发布中…" : "发布"}
            </button>
          </div>
          <div className="mini" style={{ marginTop: 10, color: "var(--muted, #888)" }}>
            {!step5PublishCountsOk && step5PathLines.length > 0 ? (
              <>
                发布前请对齐：勾选设备数、成片路径行数一致，且第 1～N 行各含恰好 5 个 #话题；成片须为可识别的
                /static-data/ 等路径且为 mp4/mov/webm/mkv。横幅请在步骤4 填写，发布时自动拼到 # 话题前。
              </>
            ) : step5PathLines.length === 0 && phoneDevices.length > 0 ? (
              <>请补充成片路径并勾选对应台数设备后再点「发布」或「手机完整发布（演练）」。</>
            ) : null}
          </div>
          {step5LastNote && (
            <div className="step-done-hint" style={{ marginTop: 10, whiteSpace: "pre-wrap" }}>
              {step5LastNote}
            </div>
          )}
          {phoneDevices.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div className="label">设备管理（勾选参与本次步骤5 操作的设备；备注仅本地保存）</div>
              <div className="mini" style={{ marginTop: 4 }}>
                「扫描抖音」「抖音→+→相册」与手机发布均只在已勾选设备上执行。多机发布时：成片第 1 行、发布文案第 1
                行 → 勾选列表中第 1 台设备（由上到下顺序），一一对应、不随机打乱。
              </div>
              <ul style={{ marginTop: 8, paddingLeft: 0, listStyle: "none" }}>
                {phoneDevices.map((d) => {
                  const meta = step5DeviceMeta[d.serial] ?? { note: "", selected: true };
                  return (
                    <li
                      key={d.serial}
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        alignItems: "center",
                        gap: 10,
                        minHeight: 44,
                        padding: "8px 0",
                        borderBottom: "1px solid rgba(148,163,184,0.12)",
                        boxSizing: "border-box",
                      }}
                    >
                      <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={meta.selected !== false}
                          disabled={!!step5Busy || stepFlowRunning}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setStep5DeviceMeta((prev) => ({
                              ...prev,
                              [d.serial]: { ...meta, selected: checked },
                            }));
                          }}
                        />
                        <span>{d.model || "设备"}</span>
                      </label>
                      <span className="mini" style={{ opacity: 0.85 }}>
                        serial={d.serial}
                      </span>
                      <input
                        className="input"
                        type="text"
                        inputMode="numeric"
                        placeholder="备注11位"
                        title="备注仅本地保存，建议 11 位数字"
                        maxLength={11}
                        style={{ width: "11ch", flex: "0 0 auto", fontFamily: "ui-monospace, monospace" }}
                        value={meta.note}
                        disabled={!!step5Busy || stepFlowRunning}
                        onChange={(e) => {
                          const v = e.target.value.slice(0, 11);
                          setStep5DeviceMeta((prev) => ({
                            ...prev,
                            [d.serial]: { ...meta, note: v },
                          }));
                        }}
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {step5PathLines.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div className="label">
                成片列表（执行顺序：序号 · 设备 · 发布文案 · 文件名；与勾选设备列表由上到下对齐）
              </div>
              <div className="mini" style={{ marginTop: 6 }}>
                点击「发布」后：对齐设备与成片 → adb push → 抖音内选片 → 两次「下一步」→ 点「#话题」→ 粘贴「步骤4 横幅
                + 本行 5 个 #」→ 点「发布」。完整路径见每行末尾。
              </div>
              {!step5MissionBoardRows && step5PathLines.length > 0 ? (
                <div className="mini" style={{ marginTop: 6, color: "var(--err, #c44)" }}>
                  当前成片行数与勾选设备数不一致，无法生成任务预览；请对齐后再发布。
                </div>
              ) : null}
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 0 }}>
                {step5MissionBoardRows
                  ? step5MissionBoardRows.map((row) => (
                      <div
                        key={`${row.index}-${row.pathLine.slice(0, 40)}`}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 4,
                          minHeight: 44,
                          padding: "8px 0",
                          borderBottom: "1px solid rgba(148,163,184,0.15)",
                          boxSizing: "border-box",
                        }}
                      >
                        <span className="mini" style={{ lineHeight: 1.45 }}>
                          <strong>{row.index}</strong> {row.deviceLabel} · {row.hashtagLine} ·{" "}
                          <span style={{ wordBreak: "break-all" }}>{row.fileName}</span>
                        </span>
                        <span className="mini" style={{ opacity: 0.8, wordBreak: "break-all" }}>
                          {row.pathLine}
                        </span>
                      </div>
                    ))
                  : step5PathLines.map((pathLine, i) => (
                      <div
                        key={`${i}-${pathLine.slice(0, 32)}`}
                        style={{
                          minHeight: 44,
                          padding: "8px 0",
                          borderBottom: "1px solid rgba(148,163,184,0.15)",
                          boxSizing: "border-box",
                        }}
                      >
                        <span className="mini" style={{ wordBreak: "break-all" }}>
                          {i + 1}. {pathLine}
                        </span>
                      </div>
                    ))}
              </div>
            </div>
          )}
            </>
          )}
        </section>
        </>
        )}

        {/* Logs */}
        {logs.length > 0 && (
          <section className="card logs-section">
            <div className="cardTitle">执行日志</div>
            <div className="logs-container">
              {logs.map((log, i) => (
                <div key={i} className={`log-entry ${log.type}`}>
                  <span className="log-time">[{log.time}]</span>
                  <span className="log-message">{log.message}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Result */}
        {isAdminRoute && finalVideo && (
          <section className="card result-section">
            <div className="cardTitle">执行结果</div>
            <div className="success">创作成功！</div>
            <div className="step-output-path" style={{ marginTop: 10 }}>
              <div className="step-output-path-label">生产文件（点击打开或复制链接）</div>
              <a
                className="step-output-path-link"
                href={publicAssetAbsoluteUrl(API_BASE, finalVideo)}
                target="_blank"
                rel="noopener noreferrer"
              >
                {publicAssetAbsoluteUrl(API_BASE, finalVideo)}
              </a>
              <div className="step-output-path-rel">
                文件名：{finalVideo.split(/[\\/]/).pop()} · 接口路径：{finalVideo}
              </div>
            </div>
          </section>
        )}

        {isAdminRoute && finalError && (
          <section className="card result-section">
            <div className="cardTitle">执行结果</div>
            <div className="err">{finalError}</div>
          </section>
        )}

        <footer className="footer">
          流水线配置已保存到浏览器 localStorage。完整流水线可直接在Web端执行。
        </footer>
        </main>
      </div>
    </div>
  );
}

export default AutoProducer;
