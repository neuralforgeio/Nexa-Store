#!/usr/bin/env python3
"""
v1.13.0 — Full catalog dataset builder (user-supplied price lists).

Builds data/catalog/games.json + products.json from the owner's price list
(transcribed verbatim), preserving the owner-uploaded Free Fire icon.
Run from the project root: python3 scripts/build-catalog-dataset.py
Output is validated afterwards by scripts/validate-catalog.ts (app's own
Zod + integrity validators).
"""
import json

# ─── Order-field templates (copied from the existing catalog conventions) ───
F_RIOT = [{"key": "riotId", "label": "Riot ID", "type": "text", "required": True, "placeholder": "Contoh: PlayerName#1234", "pattern": "^[^#]+#\\w{1,10}$"}]
F_PLAYER_ID = [{"key": "playerId", "label": "Player ID", "type": "number", "required": True, "placeholder": "Contoh: 123456789"}]
F_USER_ID = [{"key": "playerId", "label": "User ID", "type": "number", "required": True, "placeholder": "Contoh: 12345678"}]
F_UID9 = [{"key": "uid", "label": "UID", "type": "number", "required": True, "placeholder": "Contoh: 812345678", "minLength": 9, "maxLength": 9}]
F_UID_FREE = [{"key": "uid", "label": "UID", "type": "number", "required": True, "placeholder": "Contoh: 123456789"}]
F_ML = [
    {"key": "playerId", "label": "User ID", "type": "number", "required": True, "placeholder": "Contoh: 12345678"},
    {"key": "serverId", "label": "Zone / Server", "type": "number", "required": True, "placeholder": "Contoh: 1234"},
]
F_TAG = [{"key": "playerTag", "label": "Player Tag", "type": "text", "required": True, "placeholder": "Contoh: #2ABC123", "maxLength": 15}]
F_AZUR = [
    {"key": "uid", "label": "UID", "type": "number", "required": True, "placeholder": "Contoh: 123456789"},
    {"key": "server", "label": "Server", "type": "text", "required": True, "placeholder": "Contoh: Akagi / Sandy"},
]

# ─── Games (order = storefront order, per the owner's list) ───
# (id, name, description, fields)
GAMES = [
    ("free-fire", "Free Fire", None, F_PLAYER_ID),  # keep owner's description + icon
    ("ff-max", "FF MAX", "Versi Free Fire dengan grafis lebih tinggi untuk perangkat spesifikasi kuat. Akunnya terpisah dari Free Fire biasa.", F_PLAYER_ID),
    ("valorant", "Valorant", "Tactical FPS 5v5 dari Riot Games.", F_RIOT),
    ("genshin-impact", "Genshin Impact", "Action RPG open-world dari HoYoverse.", F_UID9),
    ("honor-of-kings", "Honor of Kings", "MOBA 5v5 dari Level Infinite.", F_PLAYER_ID),
    ("honkai-star-rail", "Honkai: Star Rail", "RPG turn-based petualangan antarbintang dari HoYoverse.", F_UID9),
    ("pubg", "PUBG Mobile", "Battle royale dengan mata uang UC.", F_PLAYER_ID),
    ("mobile-legends", "Mobile Legends", "MOBA 5v5 dengan mode klasik dan ranked.", F_ML),
    ("roblox", "Roblox", "Gift card Robux — kode dikirim lewat WhatsApp, tanpa perlu data akun.", []),
    ("call-of-duty", "Call of Duty: Mobile", "FPS multiplayer dengan mata uang CP.", F_PLAYER_ID),
    ("zenless-zone-zero", "Zenless Zone Zero", "Action RPG urban fantasy dari HoYoverse. Top-up zona Asia.", F_UID_FREE),
    ("point-blank", "Point Blank", "FPS klasik dari Zepetto dengan mata uang PB Cash.", F_PLAYER_ID),
    ("delta-force", "Delta Force — Garena", "Tactical shooter dengan mata uang Delta Coins.", F_PLAYER_ID),
    ("brawl-stars", "Brawl Stars", "Arena battle 3v3 dari Supercell dengan mata uang Gems.", F_TAG),
    ("arena-breakout", "Arena Breakout", "Tactical FPS extraction loot dengan mata uang Bonds.", F_PLAYER_ID),
    ("stumble-guys", "Stumble Guys", "Party battle royale knockout hingga 32 pemain.", F_USER_ID),
    ("modern-warships", "Modern Warships", "Simulasi pertempuran kapal perang modern.", F_USER_ID),
    ("blood-strike", "Blood Strike", "FPS battle royale ringan dari NetEase.", F_PLAYER_ID),
    ("sausage-man", "Sausage Man", "Battle royale bergaya kartun yang ringan dan lucu.", F_USER_ID),
    ("fc-mobile", "FC Mobile", "Sepak bola mobile dari EA.", F_PLAYER_ID),
    ("azur-lane", "Azur Lane", "Shoot-em-up side-scrolling dengan kapal perang antropomorfik.", F_AZUR),
    ("blockman-go", "Blockman Go", "Platform game mini dengan mata uang Gcubes.", F_USER_ID),
]

# ─── Products — (denomination, bonus, name, price, note) per game ───
# bonus/note = None when absent. Numeric denominations normalized to plain digits.
P = {}

P["free-fire"] = [
    ("100", None, "Diamonds", 13000, None), ("200", None, "Diamonds", 26000, None),
    ("350", None, "Diamonds", 45000, None), ("400", None, "Diamonds", 52000, None),
    ("500", None, "Diamonds", 67000, None), ("600", None, "Diamonds", 77000, None),
    ("700", None, "Diamonds", 90000, None), ("800", None, "Diamonds", 102000, None),
    ("900", None, "Diamonds", 114000, None), ("1000", None, "Diamonds", 126000, None),
    ("1500", None, "Diamonds", 187000, None), ("2000", None, "Diamonds", 246000, None),
    ("2500", None, "Diamonds", 307000, None), ("3000", None, "Diamonds", 370000, None),
    ("3500", None, "Diamonds", 430000, None), ("4000", None, "Diamonds", 465000, None),
    ("4500", None, "Diamonds", 553000, None), ("5000", None, "Diamonds", 612000, None),
    ("5500", None, "Diamonds", 677000, None),
    ("Member", None, "Mingguan", 28000, None), ("Member", None, "Bulanan", 84000, None),
]

P["ff-max"] = [
    ("100", None, "Diamonds", 13000, None), ("200", None, "Diamonds", 27000, None),
    ("350", None, "Diamonds", 46000, None), ("400", None, "Diamonds", 52000, None),
    ("500", None, "Diamonds", 67000, None), ("600", None, "Diamonds", 79000, None),
    ("700", None, "Diamonds", 91000, None), ("800", None, "Diamonds", 103000, None),
    ("900", None, "Diamonds", 115000, None), ("1000", None, "Diamonds", 127000, None),
    ("1500", None, "Diamonds", 190000, None), ("2000", None, "Diamonds", 246000, None),
    ("2500", None, "Diamonds", 316000, None), ("3000", None, "Diamonds", 381000, None),
    ("3500", None, "Diamonds", 442000, None), ("4000", None, "Diamonds", 505000, None),
    ("4500", None, "Diamonds", 569000, None), ("5000", None, "Diamonds", 631000, None),
    ("5500", None, "Diamonds", 696000, None),
    ("Member", None, "Mingguan", 28000, None), ("Member", None, "Bulanan", 84000, None),
]

P["valorant"] = [
    ("475", None, "Points", 56000, None), ("1000", None, "Points", 112000, None),
    ("2050", None, "Points", 219000, None), ("3650", None, "Points", 376000, None),
    ("5350", None, "Points", 540000, None), ("11000", None, "Points", 1057000, None),
]

P["genshin-impact"] = [
    ("60", None, "Genesis Crystals", 18000, None),
    ("300", "+ 30", "Genesis Crystals", 82000, None),
    ("980", "+ 110", "Genesis Crystals", 256000, None),
    ("1980", "+ 260", "Genesis Crystals", 485000, None),
    ("3280", "+ 600", "Genesis Crystals", 806000, None),
    ("6480", "+ 1600", "Genesis Crystals", 1710000, None),
]

P["honor-of-kings"] = [
    ("80", None, "Tokens", 16000, None), ("240", None, "Tokens", 47000, None),
    ("400", None, "Tokens", 77000, None), ("560", None, "Tokens", 105000, None),
    ("800", None, "Tokens", 154000, None), ("1200", None, "Tokens", 222000, None),
    ("2400", None, "Tokens", 451000, None), ("4000", None, "Tokens", 700000, None),
    ("8000", None, "Tokens", 1414000, None),
]

P["honkai-star-rail"] = [
    ("60", None, "Oneiric Shards", 17000, None),
    ("300", "+ 30", "Oneiric Shards", 82000, None),
    ("980", "+ 110", "Oneiric Shards", 248000, None),
    ("1980", "+ 260", "Oneiric Shards", 474000, None),
    ("3280", "+ 600", "Oneiric Shards", 792000, None),
    ("6480", "+ 1600", "Oneiric Shards", 1607000, None),
]

P["pubg"] = [
    ("60", None, "UC", 18000, None), ("325", None, "UC", 82000, None),
    ("660", None, "UC", 159000, None), ("1800", None, "UC", 399000, None),
    ("3850", None, "UC", 788000, None), ("8100", None, "UC", 1540000, None),
]

P["mobile-legends"] = [
    ("100", None, "Diamonds", 34000, None), ("200", None, "Diamonds", 68000, None),
    ("300", None, "Diamonds", 102000, None), ("408", None, "Diamonds", 122000, None),
    ("568", None, "Diamonds", 167000, None), ("875", None, "Diamonds", 253000, None),
    ("966", None, "Diamonds", 282000, None), ("1100", None, "Diamonds", 362000, None),
    ("2010", None, "Diamonds", 546000, None),
    ("Weekly", None, "Diamond Pass", 33000, None),
]

P["roblox"] = [
    ("100", None, "Robux", 33000, None), ("200", None, "Robux", 50000, None),
    ("300", None, "Robux", 66000, None), ("400", None, "Robux", 82000, None),
    ("500", None, "Robux", 99000, None), ("800", None, "Robux", 156000, None),
    ("1000", None, "Robux", 171000, None), ("1500", None, "Robux", 250000, None),
    ("2000", None, "Robux", 340000, None), ("2500", None, "Robux", 418000, None),
    ("3000", None, "Robux", 500000, None), ("3600", None, "Robux", 584000, None),
    ("4000", None, "Robux", 646000, None), ("4500", None, "Robux", 724000, None),
]

P["call-of-duty"] = [
    ("63", None, "CP", 11000, None), ("128", None, "CP", 20000, None),
    ("321", None, "CP", 50000, None), ("645", None, "CP", 100000, None),
    ("1373", None, "CP", 195000, None), ("2060", None, "CP", 330000, None),
    ("3564", None, "CP", 475000, None), ("7656", None, "CP", 945000, None),
]

P["zenless-zone-zero"] = [
    ("60", None, "Monochrome Film", 18000, None),
    ("300", "+ 30", "Monochrome Film", 86000, None),
    ("980", "+ 110", "Monochrome Film", 265000, None),
    ("1980", "+ 260", "Monochrome Film", 510000, None),
    ("3280", "+ 600", "Monochrome Film", 854000, None),
    ("6480", "+ 1600", "Monochrome Film", 1699000, None),
]

P["point-blank"] = [
    ("1200", None, "PB Cash", 10000, None), ("2400", None, "PB Cash", 20000, None),
    ("6000", None, "PB Cash", 50000, None), ("12000", None, "PB Cash", 96000, None),
    ("24000", None, "PB Cash", 190000, None), ("36000", None, "PB Cash", 283000, None),
]

P["delta-force"] = [
    ("18", "+ 1", "Delta Coins", 6000, None), ("30", "+ 2", "Delta Coins", 10000, None),
    ("60", "+ 3", "Delta Coins", 17000, None), ("300", "+ 36", "Delta Coins", 83000, None),
    ("420", "+ 62", "Delta Coins", 114000, None), ("680", "+ 105", "Delta Coins", 163000, None),
    ("1280", "+ 262", "Delta Coins", 310000, None), ("1680", "+ 385", "Delta Coins", 389000, None),
    ("3280", "+ 834", "Delta Coins", 770000, None), ("6480", "+ 1944", "Delta Coins", 1534000, None),
    ("12960", "+ 3888", "Delta Coins", 3000000, None), ("19440", "+ 5832", "Delta Coins", 4700000, None),
]

P["brawl-stars"] = [
    ("30", None, "Gems", 38000, None), ("80", None, "Gems", 86000, None),
    ("170", None, "Gems", 151000, None), ("360", None, "Gems", 300000, None),
    ("950", None, "Gems", 750000, None), ("2000", None, "Gems", 1635000, None),
    ("Brawl Pass", None, "Plus", 225000, None),
    ("Brawl Pass", None, "Standar", 170000, None),
    ("Pro", None, "Pass", 467000, None),
]

P["arena-breakout"] = [
    ("60", "+ 6", "Bonds", 15000, None), ("310", "+ 25", "Bonds", 79000, None),
    ("630", "+ 45", "Bonds", 155000, None), ("1580", "+ 110", "Bonds", 389000, None),
    ("3200", "+ 200", "Bonds", 750000, None), ("6500", "+ 320", "Bonds", 1567000, None),
    ("Premium", None, "Battle Pass", 71000, None),
    ("Advanced", None, "Battle Pass", 19000, None),
    ("Composite Case", None, "30 Days", 127000, None),
    ("Bulletproof", None, "30 Days", 45000, None),
    ("Beginner Select", None, "Package", 15000, None),
    ("Advanced BP", None, "Aktivasi Bulanan", 18000, None),
    ("Premium BP", None, "Aktivasi Bulanan", 75000, None),
    ("Premium BP", None, "Bundel 3 Bulan", 222000, None),
]

P["stumble-guys"] = [
    ("250", None, "Gems", 13000, "Pile of Gem"),
    ("800", None, "Gems", 18000, "Bag of Gem"),
    ("900", None, "Gems", 25000, None),
    ("1600", None, "Gems", 30000, "Crate of Gems"),
    ("1800", None, "Gems", 42000, None),
    ("5000", None, "Gems", 60000, "Vault of Gems"),
    ("5750", None, "Gems", 75000, None),
    ("15000", None, "Gems", 164000, None),
    ("32000", None, "Gems", 367000, None),
    ("120", None, "Stumble Token", 41000, "Pile of Stumble Token"),
    ("1300", None, "Stumble Token", 287000, "Vault of Stumble Token"),
]

P["modern-warships"] = [
    ("500", None, "Gold", 91000, None), ("1200", None, "Gold", 182000, None),
    ("2500", None, "Gold", 340000, None), ("5500", None, "Gold", 680000, None),
    ("12000", None, "Gold", 1399000, None), ("16000", None, "Gold", 1699000, None),
    ("500000", None, "Dollars", 58000, None), ("1500000", None, "Dollars", 87000, None),
    ("3500000", None, "Dollars", 187000, None), ("8000000", None, "Dollars", 340000, None),
    ("20000000", None, "Dollars", 732000, None), ("30000000", None, "Dollars", 860000, None),
    ("140", None, "Artcoins", 87000, None), ("300", None, "Artcoins", 175000, None),
    ("650", None, "Artcoins", 400000, None), ("1750", None, "Artcoins", 850000, None),
    ("3000", None, "Artcoins", 1400000, None), ("6000", None, "Artcoins", 1800000, None),
    ("4000", None, "Artcoins", 1704000, None), ("8000", None, "Artcoins", 3409000, None),
    ("16000", None, "Artcoins", 6819000, None), ("32000", None, "Artcoins", 13639000, None),
    ("64000", None, "Artcoins", 27279000, None),
    ("Premium Account", None, "7 Days", 60000, None),
    ("Premium Account", None, "30 Days", 172000, None),
]

P["blood-strike"] = [
    ("100", None, "Gold", 14000, None), ("200", None, "Gold", 28000, None),
    ("300", None, "Gold", 41000, None), ("400", None, "Gold", 55000, None),
    ("500", None, "Gold", 68000, None), ("600", None, "Gold", 81000, None),
    ("700", None, "Gold", 95000, None), ("800", None, "Gold", 108000, None),
    ("900", None, "Gold", 121000, None), ("1000", None, "Gold", 134000, None),
    ("2000", None, "Gold", 260000, None), ("3000", None, "Gold", 391000, None),
    ("4000", None, "Gold", 519000, None), ("5000", None, "Gold", 630000, None),
    ("6000", None, "Gold", 721000, None), ("8000", None, "Gold", 967000, None),
    ("9000", None, "Gold", 1090000, None), ("10000", None, "Gold", 1220000, None),
]

P["sausage-man"] = [
    ("180", None, "Candies", 43000, None), ("186", None, "Candies", 30000, None),
    ("316", None, "Candies", 70000, None), ("318", None, "Candies", 50000, None),
    ("686", None, "Candies", 90000, None), ("718", None, "Candies", 151000, None),
    ("1368", None, "Candies", 266000, None), ("1378", None, "Candies", 163000, None),
    ("2118", None, "Candies", 408000, None), ("3548", None, "Candies", 574000, None),
    ("7048", None, "Candies", 1300000, None), ("7108", None, "Candies", 900000, None),
]

P["fc-mobile"] = [
    ("100", None, "FC Points", 17000, None), ("200", None, "FC Points", 34000, None),
    ("300", None, "FC Points", 50000, None), ("400", None, "FC Points", 66000, None),
    ("500", None, "FC Points", 81000, None), ("600", None, "FC Points", 96000, None),
    ("700", None, "FC Points", 112000, None), ("800", None, "FC Points", 128000, None),
    ("900", None, "FC Points", 146000, None), ("1000", None, "FC Points", 160000, None),
    ("2000", None, "FC Points", 320000, None), ("3000", None, "FC Points", 478000, None),
    ("4000", None, "FC Points", 634000, None), ("5000", None, "FC Points", 799000, None),
]

P["azur-lane"] = [
    ("60", None, "Gems", 17000, "Handful of Gems"),
    ("300", None, "Gems", 78000, "Pile of Gems"),
    ("600", None, "Gems", 151000, "Sack of Gems"),
    ("1200", None, "Gems", 316000, "Box of Gems"),
    ("2400", None, "Gems", 645000, "Chest of Gems"),
    ("4900", None, "Gems", 1199000, "Ship of Gems"),
]

P["blockman-go"] = [
    ("60", None, "Gcubes", 20000, None), ("120", None, "Gcubes", 39000, None),
    ("300", None, "Gcubes", 93000, None), ("600", None, "Gcubes", 185000, None),
    ("1200", None, "Gcubes", 375000, None), ("1650", None, "Gcubes", 460000, None),
    ("3600", None, "Gcubes", 918000, None), ("8400", None, "Gcubes", 1800000, None),
]


def slugify(text: str) -> str:
    return "".join(c if c.isalnum() else "-" for c in text.lower()).strip("-")


def main() -> None:
    # Preserve the owner's uploaded Free Fire icon (and their description).
    prod_games = {g["id"]: g for g in json.load(open("/tmp/prod-data/games.json"))["games"]}

    games = []
    for order, (gid, name, description, fields) in enumerate(GAMES, start=1):
        keep = prod_games.get(gid)
        game = {
            "id": gid,
            "slug": gid,
            "name": name,
            "description": description if description is not None else (keep or {}).get("description"),
            "categoryIds": [],
            "orderFieldSchema": fields,
            "enabled": True,
            "sortOrder": order * 10,
        }
        # Schema wants image absent (not null) when there is none.
        if (keep or {}).get("image"):
            game["image"] = keep["image"]
        games.append(game)

    products = []
    seen_ids = set()
    for gid, items in P.items():
        for denomination, bonus, name, price, note in items:
            pid = f"{gid}-{slugify(denomination)}"
            if pid in seen_ids:  # e.g. two Brawl Pass variants
                pid = f"{gid}-{slugify(denomination)}-{slugify(name)}"
            assert pid not in seen_ids, f"duplicate product id {pid}"
            seen_ids.add(pid)
            record = {
                "id": pid,
                "gameId": gid,
                "name": name,
                "denomination": denomination,
                "priceIdr": price,
                "currency": "IDR",
                "enabled": True,
                "sortOrder": price,
            }
            if bonus:
                record_ordered = {"id": pid, "gameId": gid, "name": name, "denomination": denomination, "bonus": bonus, "priceIdr": price, "currency": "IDR", "enabled": True, "sortOrder": price}
            else:
                record_ordered = record
            if note:
                record_ordered["note"] = note
            products.append(record_ordered)

    # Stable ordering in the files: game order, then price ascending.
    game_order = {g["id"]: g["sortOrder"] for g in games}
    products.sort(key=lambda p: (game_order[p["gameId"]], p["sortOrder"]))

    with open("data/catalog/games.json", "w") as f:
        f.write(json.dumps({"games": games}, ensure_ascii=False, indent=2) + "\n")
    with open("data/catalog/products.json", "w") as f:
        f.write(json.dumps({"products": products}, ensure_ascii=False, indent=2) + "\n")

    print(f"games: {len(games)} | products: {len(products)}")
    per_game = {}
    for p in products:
        per_game[p["gameId"]] = per_game.get(p["gameId"], 0) + 1
    print("per game:", per_game)


if __name__ == "__main__":
    main()
