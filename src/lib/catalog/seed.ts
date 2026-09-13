import type { CatalogSnapshot } from "./schema";

/**
 * Canonical seed data — PRD §14 values, copied verbatim.
 * GUARD: tests/unit/seed-parity.test.ts asserts these against the PRD tables.
 * Never "correct" commercial values (PRD §53).
 */

const playerId = (label = "Player ID", type: "text" | "number" = "number") => ({
  key: "playerId",
  label,
  type,
  required: true,
  placeholder: "Contoh: 123456789",
});

export const SEED: CatalogSnapshot = {
  games: [
    {
      id: "valorant",
      slug: "valorant",
      image: "/game-icons/valorant.png",
      name: "Valorant",
      description: "Tactical FPS 5v5 dari Riot Games.",
      categoryIds: [],
      orderFieldSchema: [
        {
          key: "riotId",
          label: "Riot ID",
          type: "text",
          required: true,
          placeholder: "Contoh: PlayerName#1234",
          pattern: "^[^#]+#\\w{1,10}$",
        },
      ],
      enabled: true,
      sortOrder: 1,
    },
    {
      id: "pubg",
      slug: "pubg",
      image: "/game-icons/pubg.png",
      name: "PUBG",
      description: "Battle royale dengan mata uang UC.",
      categoryIds: [],
      orderFieldSchema: [playerId()],
      enabled: true,
      sortOrder: 2,
    },
    {
      id: "genshin-impact",
      slug: "genshin-impact",
      image: "/game-icons/genshin-impact.png",
      name: "Genshin Impact",
      description: "Action RPG open-world dari HoYoverse.",
      categoryIds: [],
      orderFieldSchema: [
        {
          key: "uid",
          label: "UID",
          type: "number",
          required: true,
          placeholder: "Contoh: 812345678",
          minLength: 9,
          maxLength: 9,
        },
      ],
      enabled: true,
      sortOrder: 3,
    },
    {
      id: "blood-strike",
      slug: "blood-strike",
      image: "/game-icons/blood-strike.png",
      name: "Blood Strike",
      description: "FPS battle royale ringan dari NetEase.",
      categoryIds: [],
      orderFieldSchema: [playerId()],
      enabled: true,
      sortOrder: 4,
    },
    {
      id: "honor-of-kings",
      slug: "honor-of-kings",
      image: "/game-icons/honor-of-kings.png",
      name: "Honor of Kings",
      description: "MOBA 5v5 dari Level Infinite.",
      categoryIds: [],
      orderFieldSchema: [playerId()],
      enabled: true,
      sortOrder: 5,
    },
    {
      id: "delta-force",
      slug: "delta-force",
      image: "/game-icons/delta-force.png",
      name: "Delta Force — Garena",
      description: "Tactical shooter dengan mata uang Delta Coins.",
      categoryIds: [],
      orderFieldSchema: [playerId()],
      enabled: true,
      sortOrder: 6,
    },
    {
      id: "mobile-legends",
      slug: "mobile-legends",
      image: "/game-icons/mobile-legends.png",
      name: "Mobile Legends",
      description: "MOBA 5v5 dengan mode klasik dan ranked.",
      categoryIds: [],
      orderFieldSchema: [
        { key: "playerId", label: "User ID", type: "number", required: true, placeholder: "Contoh: 12345678" },
        { key: "serverId", label: "Zone / Server", type: "number", required: true, placeholder: "Contoh: 1234" },
      ],
      enabled: true,
      sortOrder: 7,
    },
    {
      id: "fc-mobile",
      slug: "fc-mobile",
      image: "/game-icons/fc-mobile.png",
      name: "FC Mobile",
      description: "Sepak bola mobile dari EA.",
      categoryIds: [],
      orderFieldSchema: [playerId()],
      enabled: true,
      sortOrder: 8,
    },
  ],

  categories: [],

  products: [
    // — Valorant (PRD §14.1)
    p("valorant-475", "valorant", "Points", "475", 56000),
    p("valorant-1000", "valorant", "Points", "1000", 112000),
    p("valorant-2050", "valorant", "Points", "2050", 220000),
    p("valorant-3650", "valorant", "Points", "3650", 380000),
    p("valorant-5350", "valorant", "Points", "5350", 550000),
    p("valorant-11000", "valorant", "Points", "11000", 1200000),

    // — PUBG (PRD §14.2)
    p("pubg-60", "pubg", "UC", "60", 18000),
    p("pubg-325", "pubg", "UC", "325", 80000),
    p("pubg-660", "pubg", "UC", "660", 161000),
    p("pubg-1800", "pubg", "UC", "1800", 405000),
    p("pubg-3850", "pubg", "UC", "3850", 799000),
    p("pubg-8100", "pubg", "UC", "8100", 1613000),

    // — Genshin Impact (PRD §14.3)
    p("genshin-60", "genshin-impact", "Genesis Crystals", "60", 19000),
    p("genshin-300", "genshin-impact", "Genesis Crystals", "300", 86000, "+ 30"),
    p("genshin-980", "genshin-impact", "Genesis Crystals", "980", 270000, "+ 110"),
    p("genshin-1980", "genshin-impact", "Genesis Crystals", "1980", 520000, "+ 260"),
    p("genshin-3280", "genshin-impact", "Genesis Crystals", "3280", 850000, "+ 600"),
    p("genshin-6480", "genshin-impact", "Genesis Crystals", "6480", 1735000, "+ 1600"),

    // — Blood Strike (PRD §14.4)
    p("blood-strike-100", "blood-strike", "Gold", "100", 15000, "+ 5"),
    p("blood-strike-300", "blood-strike", "Gold", "300", 46000, "+ 20"),
    p("blood-strike-500", "blood-strike", "Gold", "500", 74000, "+ 40"),
    p("blood-strike-1000", "blood-strike", "Gold", "1000", 143000, "+ 100"),
    p("blood-strike-2000", "blood-strike", "Gold", "2000", 280000, "+ 260"),
    p("blood-strike-5000", "blood-strike", "Gold", "5000", 711000, "+ 800"),

    // — Honor of Kings (PRD §14.5)
    p("hok-16", "honor-of-kings", "Tokens", "16", 4000),
    p("hok-80", "honor-of-kings", "Tokens", "80", 18000),
    p("hok-240", "honor-of-kings", "Tokens", "240", 50000),
    p("hok-400", "honor-of-kings", "Tokens", "400", 86000),
    p("hok-560", "honor-of-kings", "Tokens", "560", 118000),
    p("hok-800", "honor-of-kings", "Tokens", "800", 169000, "+ 30"),
    p("hok-1200", "honor-of-kings", "Tokens", "1200", 250000, "+ 45"),
    p("hok-2400", "honor-of-kings", "Tokens", "2400", 492000, "+ 108"),
    p("hok-4000", "honor-of-kings", "Tokens", "4000", 820000, "+ 180"),
    p("hok-8000", "honor-of-kings", "Tokens", "8000", 1635000, "+ 360"),

    // — Delta Force — Garena (PRD §14.6)
    p("delta-18", "delta-force", "Delta Coins", "18", 6000, "+ 1"),
    p("delta-30", "delta-force", "Delta Coins", "30", 10000, "+ 2"),
    p("delta-60", "delta-force", "Delta Coins", "60", 17000, "+ 3"),
    p("delta-300", "delta-force", "Delta Coins", "300", 83000, "+ 36"),
    p("delta-420", "delta-force", "Delta Coins", "420", 114000, "+ 62"),
    p("delta-680", "delta-force", "Delta Coins", "680", 163000, "+ 105"),
    p("delta-1280", "delta-force", "Delta Coins", "1280", 310000, "+ 262"),
    p("delta-1680", "delta-force", "Delta Coins", "1680", 389000, "+ 385"),
    p("delta-3280", "delta-force", "Delta Coins", "3280", 770000, "+ 834"),
    p("delta-6480", "delta-force", "Delta Coins", "6480", 1534000, "+ 1944"),
    p("delta-12960", "delta-force", "Delta Coins", "12960", 3000000, "+ 3888"),
    p("delta-19440", "delta-force", "Delta Coins", "19440", 4700000, "+ 5832"),

    // — Mobile Legends (PRD §14.7)
    p("ml-59", "mobile-legends", "Diamonds", "59", 17000),
    p("ml-74", "mobile-legends", "Diamonds", "74", 21000),
    p("ml-170", "mobile-legends", "Diamonds", "170", 44000),
    p("ml-222", "mobile-legends", "Diamonds", "222", 58000),
    p("ml-240", "mobile-legends", "Diamonds", "240", 62000),
    p("ml-296", "mobile-legends", "Diamonds", "296", 77000),
    p("ml-370", "mobile-legends", "Diamonds", "370", 99000),
    p("ml-408", "mobile-legends", "Diamonds", "408", 104000),

    // — FC Mobile (PRD §14.8)
    p("fcm-40", "fc-mobile", "FC Points", "40", 8000),
    p("fcm-100", "fc-mobile", "FC Points", "100", 18000),
    p("fcm-520", "fc-mobile", "FC Points", "520", 78000),
    p("fcm-1070", "fc-mobile", "FC Points", "1070", 160000),
    p("fcm-2200", "fc-mobile", "FC Points", "2200", 330000),
    p("fcm-5750", "fc-mobile", "FC Points", "5750", 790000),
    p("fcm-12000", "fc-mobile", "FC Points", "12000", 1600000),
  ],

  settings: {
    storeName: "Nexa Store",
    whatsappNumber: "+62 888-6567-888",
    currency: "IDR",
    locale: "id-ID",
    maintenanceMode: false,
    maintenanceMessage: "",
    supportNote:
      "Pesanan diproses melalui WhatsApp pada jam operasional. Setelah pesan terkirim, tim store akan mengonfirmasi ketersediaan dan pembayaran.",
  },

  checkoutTemplate: {
    // Placeholders valid: lihat lib/whatsapp/template.ts (A9 untuk {orderDetails} dan {timestamp}).
    template: [
      "Halo {storeName}, saya ingin melakukan pemesanan.",
      "",
      "Produk: {productName}",
      "Game: {gameName}",
      "Harga: {price}",
      "",
      "Nama: {customerName}",
      "{orderDetails}",
      "",
      "Catatan:",
      "{note}",
    ].join("\n"),
  },
  accessControl: {
    adminBlocked: false,
  },
};

function p(
  id: string,
  gameId: string,
  name: string,
  denomination: string,
  priceIdr: number,
  bonus?: string
) {
  return {
    id,
    gameId,
    name,
    denomination,
    ...(bonus ? { bonus } : {}),
    priceIdr,
    currency: "IDR" as const,
    enabled: true,
    sortOrder: priceIdr,
  };
}
