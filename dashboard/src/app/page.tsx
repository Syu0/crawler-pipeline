"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Tab = "overview" | "registration" | "tasks" | "logs" | "chat";
type ChatMode = "judy" | "aegis" | "group";
type LogLevel = "INFO" | "ERROR";

const tabs: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "registration", label: "Qoo10" },
  { key: "tasks", label: "Tasks" },
  { key: "logs", label: "Logs" },
  { key: "chat", label: "Chat" },
];

type TaskStatus = "TODO" | "IN_PROGRESS" | "DONE" | "BLOCKED";

type ProjectTask = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  deployedOnce?: boolean;
};

type ProjectIssueStatus = "TODO" | "IN_PROGRESS" | "DONE" | "BLOCKED";

type ProjectIssue = {
  id: string;
  title: string;
  description: string;
  status: ProjectIssueStatus;
  deployedOnce?: boolean;
};

type ProjectItem = {
  name: string;
  purpose: string;
  contextPath: string;
  openUrl: string;
  tasks: ProjectTask[];
  issues?: ProjectIssue[];
};

type Qoo10Status = "UNREGISTERED" | "REGISTERED" | "UPDATE_NEEDED" | "ERROR";
type Qoo10Result = "SUCCESS" | "FAIL";
type Qoo10Record = {
  id: string;
  status: Qoo10Status;
  productName: string;
  vendorItemId: string;
  sellerCode?: string;
  qoo10ItemId?: string;
  excluded?: boolean;
  updateReasons: string[];
  lastResult: { status: Qoo10Result; message: string; code?: string };
  lastUpdatedAt?: string;
  collectedAt?: string;
  categorySummary?: string;
  diff?: { field: string; oldValue: string; newValue: string }[];
  apiResults?: { at: string; code: string; message: string }[];
  logs?: string[];
  runHistory?: { runId: string; outcome: "SUCCESS" | "FAIL" | "WARN"; at: string }[];
};

const statusClass: Record<TaskStatus, string> = {
  TODO: "bg-slate-500/30 text-slate-200",
  IN_PROGRESS: "bg-cyan-500/30 text-cyan-200",
  DONE: "bg-emerald-500/30 text-emerald-200",
  BLOCKED: "bg-rose-500/30 text-rose-200",
};

const CONTROL_STASH_IDS = new Set(["DASH-T02", "DASH-T06", "DASH-T09", "DASH-T10", "DASH-I02", "DASH-I03", "DASH-I05"]);

function formatSeoulDateTime(raw?: string | null) {
  if (!raw) return "-";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;

  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(d);

  const v = (type: string) => parts.find((p) => p.type === type)?.value || "";
  const dayPeriod = v("dayPeriod") || "";
  const year = v("year");
  const month = v("month");
  const day = v("day");
  const hour = v("hour");
  const minute = v("minute");

  return `${year}-${month}-${day} ${dayPeriod} ${hour}:${minute}`.trim();
}

const effectiveTaskStatus = (task: ProjectTask): TaskStatus => {
  if (task.status === "DONE") return "DONE";
  if (task.deployedOnce) return "IN_PROGRESS";
  return task.status;
};

const effectiveIssueStatus = (issue: ProjectIssue): TaskStatus => {
  if (issue.status === "DONE") return "DONE";
  if (issue.deployedOnce) return "IN_PROGRESS";
  return issue.status as TaskStatus;
};

const initialProjectOverview: ProjectItem[] = [
  {
    name: "crawler-pipeline (CORE)",
    purpose: "Qoo10 상품 API 등록/업데이트 도메인 처리",
    contextPath: "/Users/judy/dev/crawler-pipeline/docs/PROJECT_CONTEXT.md",
    openUrl: "https://github.com/gracejudy/crawler-pipeline/blob/oc/roughdiamond-dashboard/docs/PROJECT_CONTEXT.md",
    tasks: [
      {
        id: "CORE-T01",
        title: "Import 경로 정리 범위 확정",
        description: "backend→src 전환 이후 import 경로를 어떤 단위로 정리할지 결정",
        status: "IN_PROGRESS" as TaskStatus,
      },
      {
        id: "CORE-T02",
        title: "start 스크립트 src 기본 전환 검증",
        description: "start:legacy fallback 유지 상태에서 src 기본 전환 안정성 점검",
        status: "TODO" as TaskStatus,
      },
      {
        id: "CORE-T03",
        title: "Qoo10 등록/업데이트 E2E 확인",
        description: "실데이터 기준 등록/업데이트 API 플로우 재검증 및 로그 점검",
        status: "TODO" as TaskStatus,
      },
      {
        id: "CORE-T04",
        title: "[HOTFIX] Extension 옵션 값(옵션 항목) 수집 보강",
        description: "우선순위: HOTFIX\nRefs: vendorItemId=73359457956 | HTML Label=색상 × 구성품 × 수량 | Value=혼합색상 × 숟가락 + 젓가락 + 케이스 × 1세트\nAcceptance: 옵션 value 텍스트를 렌더링 값 기준으로 trim/공백정규화 후 저장. 다중 옵션 row 존재 시 전체 수집(뉴라인 또는 JSON 배열 문자열 포맷 고정).\nDone when: 샘플 vendorItemId(73359457956) 포함 케이스에서 옵션 값 누락 0건, 저장 포맷 일관성 검증 통과.",
        status: "TODO" as TaskStatus,
      },
      {
        id: "CORE-T05",
        title: "[HOTFIX] 상세페이지 이미지 URL 전체 수집",
        description: "우선순위: HOTFIX\nRefs: vendorItemId=73359457956 | example=https://thumbnail.coupangcdn.com/thumbnails/remote/q89/image/rs_quotation_api/sclk56uh/1106710cf33a4f0182aa028636e960ad.jpg\nAcceptance: 상품 상세 섹션의 이미지 URL을 누락 없이 전부 수집. 다중 URL 저장 포맷(뉴라인 또는 JSON 배열 문자열) 고정.\nDone when: 샘플 상품에서 상세 이미지 URL 전체가 시트에 저장되고 재수집 시 순서/포맷 안정적으로 유지.",
        status: "TODO" as TaskStatus,
      },
      {
        id: "CORE-T06",
        title: "[HOTFIX] 추가 썸네일 URL 600x600ex 정규화",
        description: "우선순위: HOTFIX\nRefs: vendorItemId=73359457956 | input=https://thumbnail.coupangcdn.com/thumbnails/remote/492x492ex/image/retail/images/1687346096889051-f11d95b2-4e90-4145-9e31-d0bb686078a5.jpg | output=https://thumbnail.coupangcdn.com/thumbnails/remote/600x600ex/image/retail/images/1687346096889051-f11d95b2-4e90-4145-9e31-d0bb686078a5.jpg\nAcceptance: /thumbnails/remote/{WxH}ex/ 패턴에 한해 안전 치환으로 600x600ex 저장. 다중 URL 전부 정규화. 비매칭 URL은 원본 유지(비손상).\nDone when: 샘플 포함 케이스에서 정규화 정확도 100%, 비매칭 URL 오염 0건.",
        status: "TODO" as TaskStatus,
      },
    ],
  },
  {
    name: "roughdiamond-dashboard (DASHBOARD)",
    purpose: "진행 중 프로젝트 Tasks/Logs/Chat 운영 뷰",
    contextPath: "/Users/judy/dev/crawler-pipeline/dashboard/docs/PROJECT_CONTEXT.md",
    openUrl: "https://github.com/gracejudy/crawler-pipeline/blob/oc/roughdiamond-dashboard/dashboard/docs/PROJECT_CONTEXT.md",
    tasks: [
      {
        id: "DASH-T01",
        title: "Project Overview 개선",
        description: "프로젝트별 task 리스트를 접기/펴기 UI로 제공",
        status: "DONE" as TaskStatus,
      },
      {
        id: "DASH-T02",
        title: "OpenClaw Chat 왕복 E2E 캡처",
        description: "전송→응답 성공 판정/오류 노출 흐름을 캡처해 검증",
        status: "TODO" as TaskStatus,
        deployedOnce: true,
      },
      {
        id: "DASH-T03",
        title: "상태/로그 가독성 개선",
        description: "모바일 기준 배지/로그 밀도 조정 및 에러 표현 정리",
        status: "IN_PROGRESS" as TaskStatus,
        deployedOnce: true,
      },
      {
        id: "DASH-T04",
        title: "Issues 섹션(tasks와 분리) 추가",
        description: "프로젝트별 이슈를 task와 별도로 등록/표시하는 섹션 추가",
        status: "DONE" as TaskStatus,
        deployedOnce: true,
      },
      {
        id: "DASH-T05",
        title: "타이틀 ID 체계 적용",
        description: "모든 task/issue에 고유 ID를 부여하고 ID + title 형식으로 표시",
        status: "DONE" as TaskStatus,
      },
      {
        id: "DASH-T06",
        title: "issues 섹션에 실행버튼 추가",
        description: "issues 항목에도 task와 유사한 실행 제어 버튼을 추가",
        status: "IN_PROGRESS" as TaskStatus,
      },
      {
        id: "DASH-T07",
        title: "task / issue 우선순위 타입 + 정렬 규칙 적용",
        description: "우선순위 높은 항목 상단, 우선순위 동일 시 등록일(오래된 순) 우선 정렬",
        status: "IN_PROGRESS" as TaskStatus,
      },
      {
        id: "DASH-T08",
        title: "완료된 작업 별도 리스트 분리(기본 접힘)",
        description: "완료된 작업은 tasks 리스트와 분리하여 별도 섹션으로 표시하고 기본은 접힌 상태로 관리",
        status: "DONE" as TaskStatus,
      },
      {
        id: "DASH-T09",
        title: "OpenClaw 연결 URL 영구 named tunnel 고정",
        description: "quick tunnel 대신 영구 Cloudflare named tunnel로 OPENCLAW_BASE_URL을 고정해 실행 안정성 확보",
        status: "IN_PROGRESS" as TaskStatus,
      },
      {
        id: "DASH-T10",
        title: "1차 목표에서 제어 기능 제외 기준 확정",
        description: "대시보드 1차 목표를 관측 중심으로 확정하고 제어 기능은 2차 고도화로 분리",
        status: "DONE" as TaskStatus,
      },
      {
        id: "DASH-T11",
        title: "task/issue 실행·중단 버튼 제거(롤백 포함)",
        description: "제어 기능 제거 방향에 맞춰 실행/중단 버튼 제거 및 되돌릴 수 있는 롤백 작업 항목 포함",
        status: "DONE" as TaskStatus,
      },
      {
        id: "DASH-T12",
        title: "task에 stash 섹션 추가 + 제어 관련 항목 이동",
        description: "제어 기능 관련 task/issue를 stash 섹션으로 이동해 2차 고도화 참조용으로 보존",
        status: "DONE" as TaskStatus,
      },
      {
        id: "DASH-T13",
        title: "dashboard 첫 탭 기본값 변경 (Qoo10 → Overview)",
        description: "초기 진입 시 registration 탭 대신 overview 탭이 기본으로 열리도록 변경",
        status: "DONE" as TaskStatus,
      },
      { id: "DASH-T14", title: "Qoo10 tab skeleton + routing", description: "Qoo10 탭 read-only v1 섹션 골격 구성", status: "DONE" as TaskStatus },
      { id: "DASH-T15", title: "Sticky header: run summary", description: "Run Status/Last Sync/Coverage/Data Source 헤더 구현", status: "DONE" as TaskStatus },
      { id: "DASH-T16", title: "Ingestion Snapshot block", description: "Google extension 수집 스냅샷 카드 + 결측 필드 필터 연동", status: "DONE" as TaskStatus },
      { id: "DASH-T17", title: "KPI cards + drill-down", description: "Overview 동일 KPI 카드 + 필터 드릴다운 연동", status: "DONE" as TaskStatus },
      { id: "DASH-T18", title: "Main table read-only", description: "기본 정렬/모바일 카드뷰 포함 read-only 테이블 구현", status: "DONE" as TaskStatus },
      { id: "DASH-T19", title: "Filters + unified search", description: "상태/범위/사유/결과/시간 필터 및 통합 검색 구현", status: "DONE" as TaskStatus },
      { id: "DASH-T20", title: "Detail panel read-only", description: "Diff/API 요약/로그/런이력 포함 슬라이드오버 구현", status: "DONE" as TaskStatus },
      { id: "DASH-T21", title: "Metrics aggregation validation", description: "KPI/ingestion 집계 규칙 lightweight 검증 로직 반영", status: "DONE" as TaskStatus },
      { id: "DASH-T22", title: "Visual polish mobile-first", description: "모바일 가독성/배지/간격 튜닝", status: "DONE" as TaskStatus },
      { id: "DASH-T23", title: "Chat 탭 session key + token usage 헤더 표시", description: "헤더 영역에 현재 세션 키와 누적 토큰 사용량 표시", status: "DONE" as TaskStatus, deployedOnce: true },
      { id: "DASH-T24", title: "Chat 탭 Aegis 연동 (aegis-send / aegis-history 프록시)", description: "Aegis 에이전트 전용 send/history API 프록시 라우트 추가 및 Chat 탭 연결", status: "DONE" as TaskStatus, deployedOnce: true },
      { id: "DASH-T25", title: "Chat 탭 그룹챗 모드 (judy / aegis / group)", description: "judy·aegis·group 세 가지 채팅 모드 전환 UI 및 그룹 메시지 라우팅 구현", status: "DONE" as TaskStatus, deployedOnce: true },
    ],
    issues: [
      {
        id: "DASH-I01",
        title: "최신 빌드 커밋번호 + Vercel 배포번호 표현",
        description: "대시보드에 최신 빌드의 git commit과 Vercel deployment 식별자를 표시",
        status: "DONE",
        deployedOnce: true,
      },
      {
        id: "DASH-I02",
        title: "Task 실행 버튼 오류 해결 및 정상동작",
        description: "task 실행 버튼 클릭 시 발생하는 에러를 해결하고 정상 동작 보장",
        status: "IN_PROGRESS",
        deployedOnce: true,
      },
      {
        id: "DASH-I03",
        title: "클라이언트 에러 서버 로그화",
        description: "클라이언트에서 발생하는 모든 에러를 서버에서 수집/로그화하여 사용자 수동 전달 의존 제거",
        status: "IN_PROGRESS",
        deployedOnce: true,
      },
      {
        id: "DASH-I04",
        title: "Logs 탭 사용성 복구",
        description: "현재 Logs 탭이 테스트/운영에서 충분히 활용되지 못하는 상태를 개선",
        status: "IN_PROGRESS",
      },
      {
        id: "DASH-I05",
        title: "1차 목표에서 제어 기능 제외 후속 정리",
        description: "기존 제어 기능 요구사항/잔여 구현을 2차 고도화로 이관하고 문서·화면 반영 누락 방지",
        status: "IN_PROGRESS",
      },
      {
        id: "DASH-I06",
        title: "[HOTFIX] NeedsUpdate 공집합 집계 오분류",
        description: "우선순위: HOTFIX\n문제: Chrome extension 신규 수집 row에서 needsUpdate가 empty/null인데도 Needs Update KPI에 포함됨.\nAcceptance: Needs Update는 needsUpdate가 YES/true 등 명시적 값일 때만 집계. empty/null/undefined는 집계 제외.\nDone when: KPI 집계 테스트/실데이터 검증에서 공집합 needsUpdate row가 Needs Update에 0건 반영.",
        status: "DONE",
      },
      {
        id: "DASH-I07",
        title: "[HOTFIX] needsUpdate 비어있을 때 상태 표기 불일치",
        description: "우선순위: HOTFIX\n문제: needsUpdate empty + qoo10 등록식별자 없음 케이스가 UPDATE_NEEDED로 보이는 상태 불일치.\nAcceptance: 해당 케이스는 UNREGISTERED(등록 필요)로 표기. 테이블/상세패널 상태 일관성 유지.\nDone when: vendorItemId=73359457956 포함 검증에서 table/detail 모두 동일한 UNREGISTERED 상태를 표시.",
        status: "DONE",
      },
    ],
  },
];

export default function Home() {
  const [tab, setTab] = useState<Tab>("overview");
  const [summary, setSummary] = useState<any>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [prompt, setPrompt] = useState("");
  const [chatConfig, setChatConfig] = useState<any>(null);
  const [chatHealth, setChatHealth] = useState<any>(null);
  const [sessionStatus, setSessionStatus] = useState<any>(null);
  const [isSending, setIsSending] = useState(false);
  const [chatMode, setChatMode] = useState<ChatMode>("judy");
  const [aegisHistory, setAegisHistory] = useState<any[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [logs, setLogs] = useState<{ ts: string; level: LogLevel; event: string; detail?: string }[]>([]);
  const [projectOverview, setProjectOverview] = useState(initialProjectOverview);
  const [qoo10Data, setQoo10Data] = useState<any>(null);
  const [selectedRecord, setSelectedRecord] = useState<Qoo10Record | null>(null);
  const [statusFilter, setStatusFilter] = useState("All");
  const [scopeFilter, setScopeFilter] = useState("Active");
  const [resultFilter, setResultFilter] = useState("All");
  const [timeFilter, setTimeFilter] = useState("7d");
  const [reasonFilter, setReasonFilter] = useState<string[]>([]);
  const [search, setSearch] = useState("");

  const chatEndRef = useRef<HTMLDivElement>(null);

  const apiUrl = (path: string) => {
    if (typeof window === "undefined") return path;
    // Basic Auth userinfo가 현재 URL에 포함되어 있어도 안전한 origin 기준으로 재구성
    return new URL(path, window.location.origin).toString();
  };

  const addLog = (level: LogLevel, event: string, detail?: string) => {
    // 요청사항: warning/info 제외, error만 기록
    if (level !== "ERROR") return;
    setLogs((prev) => [
      { ts: new Date().toLocaleTimeString(), level, event, detail },
      ...prev,
    ]);
  };

  const patchProjectTask = (projectName: string, taskId: string, patch: Partial<ProjectTask>) => {
    setProjectOverview((prev) =>
      prev.map((project) => {
        if (project.name !== projectName) return project;
        return {
          ...project,
          tasks: project.tasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task)),
        };
      }),
    );
  };

  const updateProjectTaskStatus = (projectName: string, task: ProjectTask, status: TaskStatus) => {
    patchProjectTask(projectName, task.id, { status });
    addLog("INFO", "overview.task.status_changed", `${projectName} | ${task.id} ${task.title} -> ${status}`);
  };

  const loadSummary = async () => {
    const r = await fetch("/api/sheets/summary", { cache: "no-store" });
    const d = await r.json();
    setSummary(d);
  };

  const loadQoo10Diagnostics = async () => {
    const r = await fetch("/api/qoo10/diagnostics", { cache: "no-store" });
    const d = await r.json();
    setQoo10Data(d);
  };

  const loadHistory = async () => {
    const r = await fetch("/api/openclaw/history", { cache: "no-store" });
    const d = await r.json();
    setHistory((d.messages || []).map((m: any) => ({ ...m, agent: "judy" })));
  };

  const loadAegisHistory = async () => {
    const r = await fetch("/api/openclaw/aegis-history", { cache: "no-store" });
    const d = await r.json();
    setAegisHistory(d.messages || []);
  };

  const runHealth = async () => {
    const r = await fetch("/api/openclaw/health", { cache: "no-store" });
    const d = await r.json();
    setChatHealth(d);
    addLog(d.ok ? "INFO" : "ERROR", "chat.health", JSON.stringify(d));
  };

  const loadSessionStatus = async () => {
    const r = await fetch("/api/openclaw/session-status", { cache: "no-store" });
    const d = await r.json();
    setSessionStatus(d);
  };

  useEffect(() => {
    loadSummary();
    loadQoo10Diagnostics();
    loadSessionStatus();
    fetch("/api/chat/config").then((r) => r.json()).then(setChatConfig).catch(() => null);
  }, []);

  useEffect(() => {
    if (tab !== "chat") return;
    loadHistory();
    loadAegisHistory();
    const t = setInterval(() => {
      loadHistory();
      if (chatMode === "aegis" || chatMode === "group") loadAegisHistory();
    }, 3000);
    return () => clearInterval(t);
  }, [tab, chatMode]);

  useEffect(() => {
    if (!jobId) return;
    const t = setInterval(async () => {
      const r = await fetch(`/api/registration/status?jobId=${jobId}`, { cache: "no-store" });
      const d = await r.json();
      setJob(d);

      if (d?.status === "done") {
        addLog("INFO", "qoo10.job.end", "done");
        clearInterval(t);
      }
      if (d?.status === "error") {
        addLog("ERROR", "qoo10.job.end", "error");
        clearInterval(t);
      }
    }, 1800);
    return () => clearInterval(t);
  }, [jobId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  const runRegistration = async () => {
    if (job?.status === "running") return;
    addLog("INFO", "qoo10.job.start");
    const r = await fetch("/api/registration/run", { method: "POST" });
    const d = await r.json();
    setJobId(d.jobId);
    setJob({ status: "running" });
  };

  const sendToAgent = async (endpoint: string, message: string) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const r = await fetch(apiUrl(endpoint), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
        signal: controller.signal,
      });
      const d = await r.json();
      if (!r.ok || !d?.accepted) {
        const rid = d?.requestId ? ` (requestId: ${d.requestId})` : "";
        throw new Error(`${d?.error || d?.data?.error || "send failed"}${rid}`);
      }
      return d;
    } finally {
      clearTimeout(timeout);
    }
  };

  const sendPrompt = async (text?: string) => {
    console.log("SEND_TRIGGERED");
    const message = (text ?? prompt).trim();
    if (!message || isSending) return;

    addLog("INFO", "chat.send.attempt", message.slice(0, 80));
    setIsSending(true);

    try {
      if (chatMode === "judy" || chatMode === "group") {
        await sendToAgent("/api/openclaw/send", message);
        setTimeout(loadHistory, 500);
      }
      if (chatMode === "aegis" || chatMode === "group") {
        await sendToAgent("/api/openclaw/aegis-send", message);
        setTimeout(loadAegisHistory, 500);
      }
      setPrompt("");
      addLog("INFO", "chat.send.success", `mode=${chatMode}`);
    } catch (e: any) {
      const msg = e?.name === "AbortError" ? "Chat send timeout (>10s)" : `Chat send failed: ${e.message}`;
      setToast(msg);
      addLog("ERROR", "chat.send.error", msg);
      setTimeout(() => setToast(null), 3500);
    } finally {
      setIsSending(false);
    }
  };

  const parsedProposal = useMemo(() => {
    const last = history[history.length - 1]?.text || "";
    const m = last.match(/```json\n([\s\S]*?)\n```/);
    if (!m) return null;
    try {
      return JSON.parse(m[1]);
    } catch {
      return null;
    }
  }, [history]);

  const confirmProposal = async (confirm: boolean) => {
    await sendPrompt(confirm ? `CONFIRM:\n${JSON.stringify(parsedProposal)}` : "CANCEL proposal");
  };

  const statusBadge = job?.status === "running" ? "RUNNING" : job?.status === "error" ? "ERROR" : "IDLE";
  const records: Qoo10Record[] = qoo10Data?.records || [];
  const reasonOptions: string[] = qoo10Data?.reasonOptions || [];

  const filteredRecords = records
    .filter((r) => {
      if (scopeFilter === "Active") return !r.excluded;
      if (scopeFilter === "Excluded") return !!r.excluded;
      return true;
    })
    .filter((r) => {
      if (statusFilter === "Needs Update") return r.status === "UPDATE_NEEDED";
      if (statusFilter === "Errors") return r.status === "ERROR";
      if (statusFilter === "Registered") return r.status === "REGISTERED";
      if (statusFilter === "Unregistered") return r.status === "UNREGISTERED";
      if (statusFilter === "Incomplete Source") return (r.productName || "").trim() === "" || (r.vendorItemId || "").trim() === "";
      return true;
    })
    .filter((r) => (resultFilter === "Success only" ? r.lastResult.status === "SUCCESS" : resultFilter === "Fail only" ? r.lastResult.status === "FAIL" : true))
    .filter((r) => (reasonFilter.length ? reasonFilter.every((x) => r.updateReasons.includes(x)) : true))
    .filter((r) => {
      if (!r.lastUpdatedAt || timeFilter === "Custom") return true;
      const diff = Date.now() - new Date(r.lastUpdatedAt).getTime();
      const max = timeFilter === "24h" ? 24 * 3600_000 : timeFilter === "7d" ? 7 * 24 * 3600_000 : 30 * 24 * 3600_000;
      return diff <= max;
    })
    .filter((r) => {
      if (!search.trim()) return true;
      const k = `${r.productName} ${r.vendorItemId} ${r.qoo10ItemId || ""} ${r.sellerCode || ""}`.toLowerCase();
      return k.includes(search.toLowerCase());
    })
    .sort((a, b) => {
      const rank = (x: Qoo10Record) => (x.status === "ERROR" ? 0 : x.status === "UPDATE_NEEDED" ? 1 : 2);
      const rd = rank(a) - rank(b);
      if (rd !== 0) return rd;
      const ta = a.lastUpdatedAt ? new Date(a.lastUpdatedAt).getTime() : 0;
      const tb = b.lastUpdatedAt ? new Date(b.lastUpdatedAt).getTime() : 0;
      return ta - tb;
    });

  return (
    <main className="safe-wrap pb-[calc(86px+env(safe-area-inset-bottom))] pt-4 overflow-x-hidden">
      {toast && <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 bg-rose-500 text-white text-sm px-3 py-2 rounded-xl">{toast}</div>}

      <header className="glass rounded-2xl p-4 mb-4">
        <h1 className="text-xl font-semibold">💎 RoughDiamond Dashboard</h1>
        <p className="text-sm text-slate-300">Coupang → Qoo10 Control Room</p>
        <p className="text-[11px] text-slate-400 mt-1 break-all">
          Deploy: {chatConfig?.deploy?.vercelEnv || "local"} | {chatConfig?.deploy?.gitBranch || "-"} | {(chatConfig?.deploy?.gitCommit || "-").slice(0, 8)} | dep:{(chatConfig?.deploy?.deploymentId || "-").slice(0, 12)}
        </p>
        <p className="text-[11px] text-slate-400 mt-1 break-all">
          Session: {sessionStatus?.sessionKey || chatConfig?.session || "-"} | token: {typeof sessionStatus?.usagePercent === "number" ? `${sessionStatus.usagePercent}%` : "-"}
        </p>
      </header>

      <section className="glass rounded-2xl p-4 min-h-[60vh]">
        {tab === "overview" && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Card title="Total Rows" value={String(summary?.rowCount ?? "-")} />
              <Card title="Registered" value={String(summary?.registeredCount ?? "-")} />
              <Card title="Needs Update" value={String(summary?.needsUpdateCount ?? "-")} />
              <Card title="Last Sync" value={formatSeoulDateTime(summary?.lastSyncTime)} />
            </div>

            <div className="glass rounded-xl p-3">
              <div className="text-sm font-semibold mb-2">Project Overview</div>
              <div className="space-y-2">
                {projectOverview.map((p) => {
                  const visibleTasks = p.tasks.filter((task) => !CONTROL_STASH_IDS.has(task.id));
                  const activeTasks = visibleTasks.filter((task) => effectiveTaskStatus(task) !== "DONE");
                  const completedTasks = visibleTasks.filter((task) => effectiveTaskStatus(task) === "DONE");
                  const stashTasks = p.tasks.filter((task) => CONTROL_STASH_IDS.has(task.id));
                  const visibleIssues = (p.issues || []).filter((issue) => !CONTROL_STASH_IDS.has(issue.id));
                  const stashIssues = (p.issues || []).filter((issue) => CONTROL_STASH_IDS.has(issue.id));

                  return (
                  <div key={p.name} className="rounded-lg bg-white/5 p-3 text-xs">
                    <div className="font-semibold text-cyan-300">{p.name}</div>
                    <div className="text-slate-200 mt-1">{p.purpose}</div>
                    <div className="text-slate-400 mt-1 break-all">{p.contextPath}</div>
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(p.contextPath);
                            addLog("INFO", "overview.path.copied", p.contextPath);
                          } catch {
                            addLog("ERROR", "overview.path.copy_failed", p.contextPath);
                          }
                        }}
                        className="px-2 py-1 rounded bg-white/10 text-[11px]"
                      >
                        Copy Path
                      </button>
                      <button
                        onClick={() => {
                          const w = window.open(p.openUrl, "_blank", "noopener,noreferrer");
                          if (!w) addLog("ERROR", "overview.path.open_failed", p.openUrl);
                        }}
                        className="px-2 py-1 rounded bg-white/10 text-[11px]"
                      >
                        Open
                      </button>
                    </div>

                    <details className="mt-3 rounded-md bg-black/20 p-2" open>
                      <summary className="cursor-pointer text-slate-200 font-semibold">Tasks ({activeTasks.length})</summary>
                      <div className="mt-2 space-y-2">
                        {activeTasks.map((task, idx) => (
                          <div key={`${p.name}-${idx}`} className="rounded-md bg-white/5 p-2">
                            <div className="flex items-start justify-between gap-2">
                              <div className="font-semibold text-slate-100">[{task.id}] {task.title}</div>
                            </div>
                            <div className="mt-1 text-slate-300">{task.description}</div>
                            <div className="mt-2 flex flex-wrap gap-1">
                              {(["TODO", "IN_PROGRESS", "DONE", "BLOCKED"] as TaskStatus[]).map((s) => (
                                <button
                                  key={s}
                                  onClick={() => updateProjectTaskStatus(p.name, task, s)}
                                  className={`px-2 py-0.5 rounded text-[10px] border ${effectiveTaskStatus(task) === s ? "bg-cyan-500/40 text-cyan-100 border-cyan-300/50" : "bg-white/5 text-slate-300 border-white/10"}`}
                                >
                                  TAG:{s}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </details>

                    {completedTasks.length ? (
                      <details className="mt-2 rounded-md bg-black/20 p-2">
                        <summary className="cursor-pointer text-slate-300 font-semibold">Completed Tasks ({completedTasks.length})</summary>
                        <div className="mt-2 space-y-2">
                          {completedTasks.map((task, idx) => (
                            <div key={`${p.name}-completed-${idx}`} className="rounded-md bg-white/5 p-2">
                              <div className="flex items-start justify-between gap-2">
                                <div className="font-semibold text-slate-100">[{task.id}] {task.title}</div>
                              </div>
                              <div className="mt-1 text-slate-300">{task.description}</div>
                              <div className="mt-2 flex flex-wrap gap-1">
                                {(["TODO", "IN_PROGRESS", "DONE", "BLOCKED"] as TaskStatus[]).map((s) => (
                                  <button
                                    key={s}
                                    onClick={() => updateProjectTaskStatus(p.name, task, s)}
                                    className={`px-2 py-0.5 rounded text-[10px] border ${effectiveTaskStatus(task) === s ? "bg-cyan-500/40 text-cyan-100 border-cyan-300/50" : "bg-white/5 text-slate-300 border-white/10"}`}
                                  >
                                    TAG:{s}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </details>
                    ) : null}

                    {visibleIssues.length ? (
                      <details className="mt-2 rounded-md bg-black/20 p-2" open>
                        <summary className="cursor-pointer text-slate-200 font-semibold">Issues (tasks와 분리) ({visibleIssues.length})</summary>
                        <div className="mt-2 space-y-2">
                          {visibleIssues.map((issue, i) => (
                            <div key={`${p.name}-issue-${i}`} className="rounded-md bg-white/5 p-2">
                              <div className="flex items-center justify-between gap-2">
                                <div className="font-semibold text-slate-100">[{issue.id}] {issue.title}</div>
                                <span className={`px-2 py-0.5 rounded text-[10px] ${statusClass[effectiveIssueStatus(issue)]}`}>{effectiveIssueStatus(issue)}</span>
                              </div>
                              <div className="mt-1 text-slate-300">{issue.description}</div>
                            </div>
                          ))}
                        </div>
                      </details>
                    ) : null}

                    {stashTasks.length || stashIssues.length ? (
                      <details className="mt-2 rounded-md bg-amber-950/30 p-2" open>
                        <summary className="cursor-pointer text-amber-200 font-semibold">Stash (2차 고도화 이관)</summary>
                        <div className="mt-2 space-y-2">
                          {stashTasks.map((task, i) => (
                            <div key={`${p.name}-stash-task-${i}`} className="rounded-md bg-white/5 p-2">
                              <div className="flex items-start justify-between gap-2">
                                <div className="font-semibold text-slate-100">[{task.id}] {task.title}</div>
                                <span className="px-2 py-1 rounded text-[11px] bg-white/10 text-slate-300">제어 기능은 2차 고도화(stash)</span>
                              </div>
                              <div className="mt-1 text-slate-300">{task.description}</div>
                              <div className="mt-2 flex flex-wrap gap-1">
                                {(["TODO", "IN_PROGRESS", "DONE", "BLOCKED"] as TaskStatus[]).map((s) => (
                                  <button
                                    key={s}
                                    onClick={() => updateProjectTaskStatus(p.name, task, s)}
                                    className={`px-2 py-0.5 rounded text-[10px] border ${effectiveTaskStatus(task) === s ? "bg-cyan-500/40 text-cyan-100 border-cyan-300/50" : "bg-white/5 text-slate-300 border-white/10"}`}
                                  >
                                    TAG:{s}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ))}

                          {stashIssues.map((issue, i) => (
                            <div key={`${p.name}-stash-issue-${i}`} className="rounded-md bg-white/5 p-2">
                              <div className="flex items-center justify-between gap-2">
                                <div className="font-semibold text-slate-100">[{issue.id}] {issue.title}</div>
                                <div className="flex items-center gap-2">
                                  <span className="px-2 py-1 rounded text-[11px] bg-white/10 text-slate-300">제어 기능은 2차 고도화(stash)</span>
                                  <span className={`px-2 py-0.5 rounded text-[10px] ${statusClass[effectiveIssueStatus(issue)]}`}>{effectiveIssueStatus(issue)}</span>
                                </div>
                              </div>
                              <div className="mt-1 text-slate-300">{issue.description}</div>
                            </div>
                          ))}
                        </div>
                      </details>
                    ) : null}
                  </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {tab === "registration" && (
          <div className="space-y-3">
            <div className="sticky top-0 z-10 rounded-xl bg-slate-900/95 border border-white/10 p-3">
              <div className="flex flex-wrap gap-2 text-xs items-center">
                <span className={`px-2 py-1 rounded ${qoo10Data?.run?.status === "FAILED" ? "bg-rose-500/30" : qoo10Data?.run?.status === "WARN" ? "bg-amber-500/30" : qoo10Data?.run?.status === "RUNNING" ? "bg-cyan-500/30" : "bg-emerald-500/30"}`}>Run: {qoo10Data?.run?.status || "-"}</span>
                <span>Last Sync: {formatSeoulDateTime(qoo10Data?.run?.lastSync)}</span>
                <span>runId: {qoo10Data?.run?.runId || "-"}</span>
                <span>duration: {qoo10Data?.run?.durationMs ? `${Math.round(qoo10Data.run.durationMs / 1000)}s` : "-"}</span>
                <span>Coverage: Active {qoo10Data?.coverage?.active ?? "-"} / Excluded {qoo10Data?.coverage?.excluded ?? "-"}</span>
                <span>Source: {qoo10Data?.dataSource || "Sheet: coupang_datas"}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <button onClick={() => setStatusFilter("All")} className="rounded-lg bg-cyan-950/40 p-2 text-left">
                <div className="text-[11px] text-cyan-200">Collected (Extension)</div><div className="font-semibold">{qoo10Data?.ingestion?.collected ?? 0}</div>
              </button>
              <button onClick={() => setStatusFilter("Incomplete Source")} className="rounded-lg bg-cyan-950/40 p-2 text-left">
                <div className="text-[11px] text-cyan-200">Missing Required Fields</div><div className="font-semibold">{qoo10Data?.ingestion?.missingRequired ?? 0}</div>
              </button>
              <div className="rounded-lg bg-cyan-950/40 p-2 text-left"><div className="text-[11px] text-cyan-200">Last Collected At</div><div className="font-semibold">{formatSeoulDateTime(qoo10Data?.ingestion?.lastCollectedAt)}</div></div>
              <div className="rounded-lg bg-cyan-950/40 p-2 text-left"><div className="text-[11px] text-cyan-200">Stale Rows (&gt;24h)</div><div className="font-semibold">{qoo10Data?.ingestion?.staleRows ?? 0}</div></div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <button onClick={() => setStatusFilter("All")} className="glass rounded-xl p-3 text-left"><div className="text-xs text-slate-300">Total Rows</div><div className="text-lg font-semibold">{qoo10Data?.kpi?.totalRows ?? 0}</div></button>
              <button onClick={() => setStatusFilter("Registered")} className="glass rounded-xl p-3 text-left"><div className="text-xs text-slate-300">Registered</div><div className="text-lg font-semibold">{qoo10Data?.kpi?.registered ?? 0}</div></button>
              <button onClick={() => setStatusFilter("Needs Update")} className="glass rounded-xl p-3 text-left"><div className="text-xs text-slate-300">Needs Update</div><div className="text-lg font-semibold">{qoo10Data?.kpi?.needsUpdate ?? 0}</div></button>
              <button onClick={() => setStatusFilter("All")} className="glass rounded-xl p-3 text-left"><div className="text-xs text-slate-300">Last Sync</div><div className="text-sm font-semibold">{formatSeoulDateTime(qoo10Data?.kpi?.lastSync)}</div></button>
            </div>

            <div className="rounded-xl bg-black/20 p-2 grid grid-cols-1 md:grid-cols-6 gap-2 text-xs">
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="bg-white/10 rounded p-2"><option>All</option><option>Needs Update</option><option>Errors</option><option>Registered</option><option>Unregistered</option><option>Incomplete Source</option></select>
              <select value={scopeFilter} onChange={(e) => setScopeFilter(e.target.value)} className="bg-white/10 rounded p-2"><option>Active</option><option>Excluded</option><option>All</option></select>
              <select value={resultFilter} onChange={(e) => setResultFilter(e.target.value)} className="bg-white/10 rounded p-2"><option>All</option><option>Success only</option><option>Fail only</option></select>
              <select value={timeFilter} onChange={(e) => setTimeFilter(e.target.value)} className="bg-white/10 rounded p-2"><option>24h</option><option>7d</option><option>30d</option><option>Custom</option></select>
              <select value={reasonFilter[0] || ""} onChange={(e) => setReasonFilter(e.target.value ? [e.target.value] : [])} className="bg-white/10 rounded p-2"><option value="">Reason (All)</option>{reasonOptions.map((r) => <option key={r}>{r}</option>)}</select>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="search product/vendor/qoo10/seller" className="bg-white/10 rounded p-2" />
            </div>

            <div className="rounded-xl bg-black/20 p-2 overflow-auto max-h-[44vh]">
              <table className="w-full text-xs min-w-[860px]">
                <thead><tr className="text-slate-300"><th className="text-left p-2">Status</th><th className="text-left p-2">Item</th><th className="text-left p-2">Qoo10</th><th className="text-left p-2">Update Reason</th><th className="text-left p-2">Last Result</th><th className="text-left p-2">Last Updated At</th></tr></thead>
                <tbody>
                  {filteredRecords.map((r) => (
                    <tr key={r.id} onClick={() => setSelectedRecord(r)} className="border-t border-white/10 hover:bg-white/5 cursor-pointer">
                      <td className="p-2">{r.status}</td>
                      <td className="p-2"><div>{r.productName || "(no name)"}</div><div className="text-slate-400">{r.vendorItemId || "-"}</div></td>
                      <td className="p-2">{r.qoo10ItemId || "-"}</td>
                      <td className="p-2">{r.updateReasons.join(", ") || "-"}</td>
                      <td className="p-2">{r.lastResult.status} · {r.lastResult.message}</td>
                      <td className="p-2">{formatSeoulDateTime(r.lastUpdatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selectedRecord && (
              <div className="fixed inset-0 z-50 bg-black/50" onClick={() => setSelectedRecord(null)}>
                <div className="absolute right-0 top-0 h-full w-full max-w-xl bg-slate-900 p-4 overflow-auto" onClick={(e) => e.stopPropagation()}>
                  <div className="font-semibold mb-2">{selectedRecord.productName}</div>
                  <div className="text-xs text-slate-300 space-y-1">
                    <div>vendorItemId: {selectedRecord.vendorItemId || "-"}</div>
                    <div>sellerCode: {selectedRecord.sellerCode || "-"}</div>
                    <div>qoo10ItemId: {selectedRecord.qoo10ItemId || "-"}</div>
                    <div>category: {selectedRecord.categorySummary || "-"}</div>
                  </div>
                  <div className="mt-3 text-sm font-semibold">Diff Summary</div>
                  <ul className="text-xs text-slate-300 list-disc pl-4">{(selectedRecord.diff || []).map((d, i) => <li key={i}>{d.field}: {d.oldValue} → {d.newValue}</li>)}</ul>
                  <div className="mt-3 text-sm font-semibold">Last API Results</div>
                  <ul className="text-xs text-slate-300 list-disc pl-4">{(selectedRecord.apiResults || []).map((a, i) => <li key={i}>[{formatSeoulDateTime(a.at)}] {a.code} {a.message}</li>)}</ul>
                  <div className="mt-3 text-sm font-semibold">Logs</div>
                  <pre className="text-[11px] bg-black/30 p-2 rounded">{(selectedRecord.logs || []).slice(0, 20).join("\n")}</pre>
                  <div className="mt-3 text-sm font-semibold">Run History (last 3)</div>
                  <ul className="text-xs text-slate-300 list-disc pl-4">{(selectedRecord.runHistory || []).slice(0, 3).map((h, i) => <li key={i}>{h.runId} · {h.outcome} · {formatSeoulDateTime(h.at)}</li>)}</ul>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "tasks" && <div className="text-sm">- Start registration{"\n"}- Review logs{"\n"}- Confirm next action from Chat</div>}

        {tab === "logs" && (
          <div className="space-y-2">
            {logs.map((l, i) => (
              <div key={i} className="text-xs p-2 rounded bg-white/5">
                <b className={l.level === "ERROR" ? "text-rose-300" : "text-cyan-300"}>{l.level}</b> [{l.ts}] {l.event}
                {l.detail ? <div className="text-slate-300 mt-1 break-all">{l.detail}</div> : null}
              </div>
            ))}
            {!logs.length && <div className="text-sm text-slate-300">No events yet</div>}
          </div>
        )}

        {tab === "chat" && (
          <div className="flex flex-col gap-3 h-[65vh] max-h-[65vh]">
            {/* Mode toggle */}
            <div className="flex gap-1 rounded-xl bg-black/20 p-1">
              {(["judy", "aegis", "group"] as ChatMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setChatMode(m)}
                  className={`flex-1 text-xs py-1.5 rounded-lg font-semibold transition-colors ${chatMode === m ? "bg-cyan-400 text-black" : "bg-white/10 text-slate-300"}`}
                >
                  {m === "judy" ? "💎 Judy" : m === "aegis" ? "🛡️ Aegis" : "👥 Group"}
                </button>
              ))}
            </div>

            {/* Config info (collapsed) */}
            <details className="glass rounded-xl p-2 text-xs">
              <summary className="cursor-pointer text-slate-300">Connection Info</summary>
              <div className="mt-2 space-y-1">
                <div>Judy Base: {chatConfig?.base || "(unset)"} | Session: {chatConfig?.session || "(unset)"}</div>
                <div>Aegis Base: {process.env.NEXT_PUBLIC_AEGIS_BASE_URL || "(set via env)"}</div>
                <div className="mt-1 flex items-center gap-2">
                  <button onClick={runHealth} className="px-3 py-1 rounded-lg bg-white/10">Health Check</button>
                  <span>{chatHealth ? `${chatHealth.ok ? "✅" : "❌"} ${chatHealth.latencyMs}ms` : "-"}</span>
                </div>
              </div>
            </details>

            {/* Group view: side-by-side or interleaved */}
            {chatMode === "group" ? (
              <div className="flex-1 overflow-hidden flex gap-2">
                {/* Judy column */}
                <div className="flex-1 flex flex-col overflow-hidden rounded-xl bg-black/20">
                  <div className="text-xs text-cyan-300 font-semibold px-3 pt-2 pb-1 border-b border-white/10">💎 Judy</div>
                  <div className="flex-1 overflow-y-auto p-2">
                    {history.map((m, i) => (
                      <div key={i} className="mb-2 text-xs">
                        <b className={m.role === "user" ? "text-slate-300" : "text-cyan-300"}>{m.role === "user" ? "you" : "judy"}</b>
                        <div className="whitespace-pre-wrap break-words">{m.text || ""}</div>
                      </div>
                    ))}
                  </div>
                </div>
                {/* Aegis column */}
                <div className="flex-1 flex flex-col overflow-hidden rounded-xl bg-black/20">
                  <div className="text-xs text-amber-300 font-semibold px-3 pt-2 pb-1 border-b border-white/10">🛡️ Aegis</div>
                  <div className="flex-1 overflow-y-auto p-2">
                    {aegisHistory.length === 0 && (
                      <div className="text-xs text-slate-400 p-2">No history (check AEGIS_BASE_URL env)</div>
                    )}
                    {aegisHistory.map((m, i) => (
                      <div key={i} className="mb-2 text-xs">
                        <b className={m.role === "user" ? "text-slate-300" : "text-amber-300"}>{m.role === "user" ? "you" : "aegis"}</b>
                        <div className="whitespace-pre-wrap break-words">{m.text || ""}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              /* Single agent view */
              <div className="flex-1 overflow-y-auto overflow-x-hidden rounded-xl bg-black/20 p-3">
                {(chatMode === "judy" ? history : aegisHistory).map((m, i) => (
                  <div key={i} className="mb-2 text-sm">
                    <b className={m.role === "user" ? "text-slate-300" : chatMode === "judy" ? "text-cyan-300" : "text-amber-300"}>
                      {m.role === "user" ? "you" : chatMode}
                    </b>
                    <div className="whitespace-pre-wrap break-words">{m.text || ""}</div>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
            )}

            {parsedProposal && (
              <div className="glass rounded-xl p-3">
                <div className="text-xs mb-2">Proposed Action</div>
                <pre className="text-xs overflow-auto max-h-32">{JSON.stringify(parsedProposal, null, 2)}</pre>
                <div className="flex gap-2 mt-2">
                  <button onClick={() => confirmProposal(true)} className="flex-1 py-2 rounded bg-emerald-400 text-black font-semibold">Confirm</button>
                  <button onClick={() => confirmProposal(false)} className="flex-1 py-2 rounded bg-rose-400 text-black font-semibold">Cancel</button>
                </div>
              </div>
            )}

            <div className="flex gap-2 sticky bottom-0 pb-[env(safe-area-inset-bottom)]">
              <input
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendPrompt()}
                placeholder={chatMode === "group" ? "Send to both judy & aegis" : `Prompt to ${chatMode}`}
                className="flex-1 rounded-xl px-3 py-3 bg-white/10 outline-none"
              />
              <button
                onClick={() => sendPrompt()}
                disabled={isSending}
                className="px-4 rounded-xl bg-cyan-400 text-black font-bold disabled:opacity-40"
              >
                {isSending ? "..." : "Send"}
              </button>
            </div>
          </div>
        )}
      </section>

      <nav className="fixed left-0 right-0 bottom-0 p-2 z-40 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
        <div className="safe-wrap glass rounded-2xl p-2 grid grid-cols-5 gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`text-xs py-2 rounded-xl ${tab === t.key ? "bg-cyan-400 text-black font-semibold" : "bg-white/10"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </nav>
    </main>
  );
}

function Card({ title, value }: { title: string; value: string }) {
  return (
    <div className="glass rounded-xl p-3 min-h-[86px]">
      <div className="text-xs text-slate-300">{title}</div>
      <div className="text-lg font-semibold mt-2 break-words">{value}</div>
    </div>
  );
}
