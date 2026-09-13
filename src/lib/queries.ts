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
