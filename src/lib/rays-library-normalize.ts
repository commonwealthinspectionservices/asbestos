// Canonical material-name normalization for Ray's Library. Materials that
// are the same real-world thing worded differently (word order, punctuation,
// glaze/glazing, a leading color descriptor) should collapse to one entry
// rather than showing up as separate near-duplicate cards. Deliberately does
// NOT merge materials that differ in a meaningful way (interior vs exterior,
// floor vs wall, sheetfloor vs floor tile, etc) — see RENAMES comments.
const COLOR_WORDS = [
  "black", "white", "off white", "off-white", "gray", "grey", "tan", "brown",
  "red", "blue", "green", "yellow", "beige", "cream", "ivory", "dark brown",
  "light brown", "multicolor", "multicolor brown", "gray-brown", "red-gray",
  "black-gray", "red & brown", "brown & gray",
];

const RENAMES: Record<string, string> = {
  "adhesive, floor tile": "Floor Tile Adhesive",
  "mastic": "Floor Tile Mastic",
  "mastic, floor tile": "Floor Tile Mastic",
  "adhesive, assoc. w/ sheetfloor": "Sheetfloor Adhesive",
  "adhesive, sheetfloor": "Sheetfloor Adhesive",
  "floor adhesive": "Sheetfloor Adhesive",
  "adhesive, covebase": "Covebase Adhesive",
  "grout, ceramic wall tile": "Ceramic Wall Tile Grout",
  "ceramic wall tile, grout": "Ceramic Wall Tile Grout",
  "adhesive, ceramic wall tile": "Ceramic Wall Tile Adhesive",
  "ceramic tile adhesive": "Ceramic Wall Tile Adhesive",
  "thinset, ceramic wall tile": "Ceramic Wall Tile Thinset",
  "grout, ceramic floor tile": "Ceramic Floor Tile Grout",
  "ceramic floor tile, grout": "Ceramic Floor Tile Grout",
  "ceramic tile grout": "Ceramic Floor Tile Grout",
  "grout, ceramic tile": "Ceramic Floor Tile Grout",
  "thinset, ceramic floor tile": "Ceramic Floor Tile Thinset",
  "ceramic floor tile, thinset": "Ceramic Floor Tile Thinset",
  "thinset, ceramic tile": "Ceramic Floor Tile Thinset",
  "exterior window glaze": "Exterior Window Glazing",
  "window glazing": "Exterior Window Glazing",
  "flexible window glaze": "Flexible Exterior Window Glazing",
  "window caulking": "Exterior Window Caulking",
  "caulk": "Roof Caulk",
  "adhesive": "Roofing Adhesive",
  "joint compound/patch": "Joint Compound, Patch",
};

/** Strips a leading color descriptor, then applies the known-duplicate rename table. */
export function normalizeMaterialName(raw: string): string {
  let name = raw.trim().replace(/\s+/g, " ");
  for (const color of COLOR_WORDS) {
    const re = new RegExp(`^${color}[\\s/-]+`, "i");
    if (re.test(name)) {
      name = name.replace(re, "");
      break;
    }
  }
  const renamed = RENAMES[name.toLowerCase()];
  return renamed ?? name;
}
