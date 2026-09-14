"use client";

import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { navigateTo } from "@/lib/router";
import type {
  Category,
  Game,
  OrderField,
  Product,
  SessionInfo,
  SiteGateState,
  SyncRevision,
  ValidationReport,
} from "@/lib/catalog/types";
import type {
  PublicBanner,
  PublicPromo,
  AnalyticsSummary,
  BannerRecord,
  ConversationSummary,
  PromoEvent,
  ScheduleTask,
} from "@/lib/site-features/types";

/** Public storefront data (enabled records only). */
export type PublicCatalog = {
  store: {
    name: string;
    whatsappNumber: string;
    announcement: string | null;
    maintenanceMode: boolean;
    maintenanceMessage: string | null;
    supportNote: string | null;
    currency: "IDR";
    locale: "id-ID";
  };
  checkoutTemplate: string;
  games: Array<{
    id: string;
    slug: string;
    name: string;
    description: string | null;
    image: string | null;
    orderFields: OrderField[];
    productCount: number;
    categoryIds: string[];
    sortOrder: number;
  }>;
  categories: Category[];
  products: Product[];
  revision: string;
  adapter: "local" | "github";
};

export function useCatalog() {
  return useQuery({
    queryKey: ["catalog"],
    queryFn: () => api.get<PublicCatalog>("/api/catalog"),
    staleTime: 60_000,
  });
}

export function useSession(refreshMs: number | false = false) {
  return useQuery({
    queryKey: ["session"],
    queryFn: () => api.get<SessionInfo>("/api/auth/session"),
    staleTime: 30_000,
    // While inside the dashboard the session is polled so a mid-session
    // Admin block surfaces as the blocking modal within seconds.
    refetchInterval: refreshMs,
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ loggedOut: boolean }>("/api/auth/logout", {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["session"] });
      qc.invalidateQueries({ queryKey: ["mgmt-catalog"] });
      qc.invalidateQueries({ queryKey: ["settings"] });
      navigateTo("/", { replace: true });
    },
  });
}

/** Management snapshot — includes disabled records + revision token. */
export type ManagementCatalog = {
  games: Game[];
  products: Product[];
  categories: Category[];
  revision: string;
  fileShas: Record<string, string>;
  adapter: "local" | "github";
  readAt: string;
};

export function useManagementCatalog(enabled: boolean) {
  return useQuery({
    queryKey: ["mgmt-catalog"],
    queryFn: () => api.get<ManagementCatalog>("/api/management/catalog"),
    enabled,
    staleTime: 0,
  });
}

export type SettingsBundle = {
  settings: {
    storeName: string;
    whatsappNumber: string;
    currency: "IDR";
    locale: "id-ID";
    announcement?: string;
    maintenanceMode: boolean;
    maintenanceMessage?: string;
    supportNote?: string;
  };
  checkoutTemplate: { template: string; updatedAt?: string; updatedBy?: string };
  revision: string;
  fileShas: Record<string, string>;
  readAt: string;
};

export function useSettingsBundle(enabled: boolean) {
  return useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<SettingsBundle>("/api/management/settings"),
    enabled,
  });
}

export type Diagnostics = {
  app: { name: string; version: string };
  runtime: { nodeEnv: string; persistenceMode: "local" | "github" };
  environment: {
    authConfigured: boolean;
    sessionSecretPresent: boolean;
    githubConfigured: boolean;
    githubTarget: string | null;
  };
  repository: {
    health: { adapter: string; ok: boolean; detail: string };
    revision: string | null;
    lastCommit: { message: string; at: string } | null;
  };
  validation: ValidationReport;
};

export function useDiagnostics(enabled: boolean) {
  return useQuery({
    queryKey: ["diagnostics"],
    queryFn: () => api.get<Diagnostics>("/api/developer/diagnostics"),
    enabled,
  });
}

export type GitStatus = {
  adapter: "local" | "github";
  revision: string;
  readAt: string;
  history: Array<{ revision: string; message: string; at: string; author: string }>;
  health: { adapter: string; ok: boolean; detail: string };
};

export function useGitStatus(enabled: boolean) {
  return useQuery({
    queryKey: ["git-status"],
    queryFn: () => api.get<GitStatus>("/api/developer/git?action=status"),
    enabled,
  });
}

export type DataInspector = {
  files: Record<string, unknown>;
  fileShas: Record<string, string>;
  revision: string;
  adapter: "local" | "github";
  validation: ValidationReport;
};

export function useDataInspector(enabled: boolean) {
  return useQuery({
    queryKey: ["data-inspector"],
    queryFn: () => api.get<DataInspector>("/api/developer/data"),
    enabled,
  });
}

export type MutationResult = {
  revision: string;
  commitMessage: string;
  files: string[];
  writtenAt: string;
  diff: { gamesChanged: number; productsChanged: number; categoriesChanged: number; lines: string[] };
};

export function useCatalogMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      baseRevision: string;
      baseFileShas: Record<string, string>;
      operations: unknown[];
    }) => api.post<MutationResult>("/api/management/catalog", input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mgmt-catalog"] });
      qc.invalidateQueries({ queryKey: ["catalog"] });
      qc.invalidateQueries({ queryKey: ["git-status"] });
      qc.invalidateQueries({ queryKey: ["data-inspector"] });
    },
  });
}

export type SyncRevisionInfo = SyncRevision;

/** Admin access control + site gates (developer-only, D8 + site control). */
export type AccessControlInfo = {
  adminBlocked: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
  reason: string | null;
  lockdown: SiteGateState;
  maintenance: SiteGateState;
  revision: string;
  fileShas: Record<string, string>;
  adapter: "local" | "github";
};

export function useAccessControl(enabled: boolean) {
  return useQuery({
    queryKey: ["access-control"],
    queryFn: () => api.get<AccessControlInfo>("/api/developer/access"),
    enabled,
  });
}

export function useAccessControlMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      baseRevision: string;
      baseFileShas: Record<string, string>;
      adminBlocked: boolean;
      reason?: string;
    }) => api.post<{ revision: string }>("/api/developer/access", input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["access-control"] });
    },
  });
}

/** Site gates (lockdown / maintenance) — developer-only writes. */
export function useSiteControlMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      baseRevision: string;
      baseFileShas: Record<string, string>;
      siteControl: {
        lockdown?: SiteGateState;
        maintenance?: SiteGateState;
      };
    }) =>
      api.post<{
        revision: string;
        commitMessage: string;
        lockdown: SiteGateState | null;
        maintenance: SiteGateState | null;
      }>("/api/developer/access", input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["access-control"] });
    },
  });
}

export function useSettingsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      baseRevision: string;
      baseFileShas: Record<string, string>;
      settings: SettingsBundle["settings"];
      checkoutTemplate: SettingsBundle["checkoutTemplate"];
    }) =>
      api.post<{ revision: string; commitMessage: string; writtenAt: string }>(
        "/api/management/settings",
        input
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["catalog"] });
      qc.invalidateQueries({ queryKey: ["git-status"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Site features (v1.3.0): banner, promo, analitik, obrolan, tugas terjadwal.
// ---------------------------------------------------------------------------

export type SiteFeaturesStatus = {
  banners: PublicBanner[];
  promos: PublicPromo[];
  liveVisitors: number;
};

/** Data publik fitur situs — banner aktif + ringkasan promo + live count. */
export function useSiteFeatures(enabled = true) {
  return useQuery({
    queryKey: ["site-features"],
    queryFn: () => api.get<SiteFeaturesStatus>("/api/site-features"),
    enabled,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

export function usePromos(enabled: boolean) {
  return useQuery({
    queryKey: ["dev-promos"],
    queryFn: () => api.get<{ promos: PromoEvent[] }>("/api/developer/promos"),
    enabled,
  });
}

export function usePromoMutation() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, { action: "create"; body: Record<string, unknown> } | { action: "patch"; body: Record<string, unknown> } | { action: "delete"; id: string }>({
    mutationFn: (input:
      | { action: "create"; body: Record<string, unknown> }
      | { action: "patch"; body: Record<string, unknown> }
      | { action: "delete"; id: string }) =>
      input.action === "create"
        ? api.post<{ promo: PromoEvent }>("/api/developer/promos", input.body)
        : input.action === "patch"
          ? api.patch<{ ok: boolean }>("/api/developer/promos", input.body)
          : api.delete<{ ok: boolean }>(`/api/developer/promos?id=${encodeURIComponent(input.id)}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dev-promos"] });
      qc.invalidateQueries({ queryKey: ["site-features"] });
    },
  });
}

export function useBanners(enabled: boolean) {
  return useQuery({
    queryKey: ["dev-banners"],
    queryFn: () => api.get<{ banners: BannerRecord[] }>("/api/developer/banners"),
    enabled,
  });
}

export function useBannerMutation() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, { action: "create"; body: Record<string, unknown> } | { action: "patch"; body: Record<string, unknown> } | { action: "delete"; id: string }>({
    mutationFn: (input:
      | { action: "create"; body: Record<string, unknown> }
      | { action: "patch"; body: Record<string, unknown> }
      | { action: "delete"; id: string }) =>
      input.action === "create"
        ? api.post<{ banner: BannerRecord }>("/api/developer/banners", input.body)
        : input.action === "patch"
          ? api.patch<{ ok: boolean }>("/api/developer/banners", input.body)
          : api.delete<{ ok: boolean }>(`/api/developer/banners?id=${encodeURIComponent(input.id)}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dev-banners"] });
      qc.invalidateQueries({ queryKey: ["site-features"] });
    },
  });
}

export function useSchedules(enabled: boolean) {
  return useQuery({
    queryKey: ["dev-schedules"],
    queryFn: () => api.get<{ tasks: ScheduleTask[] }>("/api/developer/schedules"),
    enabled,
    refetchInterval: 30_000,
  });
}

export function useScheduleMutation() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, { action: "create"; body: Record<string, unknown> } | { action: "patch"; body: Record<string, unknown> } | { action: "delete"; id: string }>({
    mutationFn: (input:
      | { action: "create"; body: Record<string, unknown> }
      | { action: "patch"; body: Record<string, unknown> }
      | { action: "delete"; id: string }) =>
      input.action === "create"
        ? api.post<{ task: ScheduleTask }>("/api/developer/schedules", input.body)
        : input.action === "patch"
          ? api.patch<{ ok: boolean }>("/api/developer/schedules", input.body)
          : api.delete<{ ok: boolean }>(`/api/developer/schedules?id=${encodeURIComponent(input.id)}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dev-schedules"] });
    },
  });
}

export type ChatConsoleData = {
  conversations: Array<ConversationSummary & { messages: Array<{ id: string; from: "user" | "owner"; text: string; at: string }> }>;
  unreadTotal: number;
};

export function useChatConsole(enabled: boolean, refetchMs: number | false = 8_000) {
  return useQuery({
    queryKey: ["dev-chat"],
    queryFn: () => api.get<ChatConsoleData>("/api/developer/chat"),
    enabled,
    refetchInterval: refetchMs,
  });
}

export function useChatOwnerMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      conversationId?: string;
      text?: string;
      action: "reply" | "markRead" | "clearOne" | "clearAll";
    }) => api.post<{ ok: boolean; clearedCount?: number }>("/api/developer/chat", input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dev-chat"] });
    },
  });
}

export type ReportRecordView = {
  id: string;
  type: "bug" | "feature" | "other";
  name: string | null;
  text: string;
  media: {
    kind: "image" | "video";
    mime: string;
    size: number;
    fileName: string;
    storedAt?: string;
  } | null;
  createdAt: string;
};

export function useReportsConsole(enabled: boolean) {
  return useQuery({
    queryKey: ["dev-reports"],
    queryFn: () => api.get<{ reports: ReportRecordView[] }>("/api/developer/reports"),
    enabled,
    refetchInterval: 30_000,
  });
}

export function useReportsOwnerMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { action: "delete" | "clearAll"; id?: string }) =>
      api.post<{ ok: boolean }>("/api/developer/reports", input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dev-reports"] });
    },
  });
}

export function useAnalytics(enabled: boolean) {
  return useQuery({
    queryKey: ["dev-analytics"],
    queryFn: () => api.get<AnalyticsSummary>("/api/developer/analytics"),
    enabled,
    refetchInterval: 30_000,
  });
}
