import { z } from "zod";
import type { CanonicalFileKey, ValidationIssue } from "./types";
import { CANONICAL_FILES } from "./types";

/**
 * Zod schemas for canonical data files (PRD §13, §35).
 * Every read from persistence and every proposed mutation passes through here.
 */

const orderFieldSchema = z.object({
  key: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, "Kunci field hanya boleh huruf, angka, underscore"),
  label: z.string().min(1),
  type: z.enum(["text", "number"]),
  required: z.boolean(),
  placeholder: z.string().optional(),
  minLength: z.number().int().min(0).optional(),
  maxLength: z.number().int().min(1).optional(),
  pattern: z.string().optional(),
});

const gameSchema = z.object({
  id: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug harus kebab-case"),
  name: z.string().min(1),
  description: z.string().optional(),
  image: z.string().optional(),
  categoryIds: z.array(z.string().min(1)),
  orderFieldSchema: z.array(orderFieldSchema),
  enabled: z.boolean(),
  sortOrder: z.number().int().min(0),
});

const categorySchema = z.object({
  id: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug harus kebab-case"),
  name: z.string().min(1),
  description: z.string().optional(),
  enabled: z.boolean(),
  sortOrder: z.number().int().min(0),
});

const productSchema = z.object({
  id: z.string().min(1),
  gameId: z.string().min(1),
  categoryId: z.string().min(1).optional(),
  name: z.string().min(1),
  denomination: z.string().min(1),
  bonus: z.string().optional(),
  // Integer IDR only — floats are rejected (PRD §13.3).
  priceIdr: z
    .number()
    .int("Harga harus bilangan bulat Rupiah")
    .min(0, "Harga tidak boleh negatif"),
  currency: z.literal("IDR"),
  enabled: z.boolean(),
  sortOrder: z.number().int().min(0),
  note: z.string().optional(),
});

const storeSettingsSchema = z.object({
  storeName: z.string().min(1),
  whatsappNumber: z.string().min(7),
  currency: z.literal("IDR"),
  locale: z.literal("id-ID"),
  announcement: z.string().optional(),
  maintenanceMode: z.boolean(),
  maintenanceMessage: z.string().optional(),
  supportNote: z.string().optional(),
});

const checkoutTemplateSchema = z.object({
  template: z.string().min(1),
  updatedAt: z.string().optional(),
  updatedBy: z.string().optional(),
});

const siteGateSchema = z.object({
  active: z.boolean(),
  scope: z.enum(["all", "routes"]),
  routes: z.array(z.string()).max(12),
  note: z.string().max(300).optional(),
  updatedAt: z.string().optional(),
  updatedBy: z.string().optional(),
});

const accessControlSchema = z.object({
  adminBlocked: z.boolean(),
  updatedAt: z.string().optional(),
  updatedBy: z.string().optional(),
  reason: z.string().max(300).optional(),
  // Site gates are optional so pre-gate data files keep parsing.
  lockdown: siteGateSchema.optional(),
  maintenance: siteGateSchema.optional(),
});

export const gamesFileSchema = z.object({
  games: z.array(gameSchema),
});
export const productsFileSchema = z.object({
  products: z.array(productSchema),
});
export const categoriesFileSchema = z.object({
  categories: z.array(categorySchema),
});
export const settingsFileSchema = storeSettingsSchema;
export const checkoutTemplateFileSchema = checkoutTemplateSchema;
export const accessControlFileSchema = accessControlSchema;

export const fileSchemas = {
  games: gamesFileSchema,
  products: productsFileSchema,
  categories: categoriesFileSchema,
  settings: settingsFileSchema,
  "checkout-template": checkoutTemplateFileSchema,
  "access-control": accessControlFileSchema,
} as const;

export type GamesFile = z.infer<typeof gamesFileSchema>;
export type ProductsFile = z.infer<typeof productsFileSchema>;
export type CategoriesFile = z.infer<typeof categoriesFileSchema>;
export type SettingsFile = z.infer<typeof settingsFileSchema>;
export type CheckoutTemplateFile = z.infer<typeof checkoutTemplateFileSchema>;
export type AccessControlFile = z.infer<typeof accessControlSchema>;

export type CatalogSnapshot = {
  games: GamesFile["games"];
  products: ProductsFile["products"];
  categories: CategoriesFile["categories"];
  settings: SettingsFile;
  checkoutTemplate: CheckoutTemplateFile;
  accessControl: AccessControlFile;
};

/**
 * Validate one canonical file's raw parsed JSON.
 * Returns issues with file/record/field granularity (PRD §35).
 */
export function validateFile(
  key: CanonicalFileKey,
  data: unknown
): { ok: boolean; issues: ValidationIssue[]; data?: unknown } {
  const schema = fileSchemas[key];
  const parsed = schema.safeParse(data);
  if (parsed.success) {
    return { ok: true, issues: [], data: parsed.data };
  }
  const issues: ValidationIssue[] = [];
  for (const problem of parsed.error.issues) {
    issues.push({
      file: key,
      recordId: recordIdOf(key, data, problem.path),
      field: problem.path.join(".") || undefined,
      reason: problem.message,
      received: safeReceived(problem),
    });
  }
  return { ok: false, issues };
}

function recordIdOf(_key: CanonicalFileKey, data: unknown, path: (string | number | symbol)[]): string | undefined {
  const first = path[0];
  if (typeof first === "number" && Array.isArray(data) && data[first] && typeof data[first] === "object") {
    const candidate = (data[first] as Record<string, unknown>).id;
    if (typeof candidate === "string") return candidate;
  }
  return undefined;
}

function safeReceived(problem: z.ZodIssue): string | undefined {
  const raw = problem as unknown as { received?: unknown };
  if (raw.received === undefined) return undefined;
  const text = String(raw.received);
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

export function filePath(key: CanonicalFileKey): string {
  return CANONICAL_FILES[key];
}
