// Backing data for the /mold-testing/[town] local landing pages — picked as
// 50 of Massachusetts's higher-income towns (real homeowners who can afford
// a discretionary $700-900 air quality test), spread across every region
// the homepage already claims coverage for rather than clustering around
// just MetroWest. `nearby` powers the "we also serve" internal links on
// each page — not exhaustive, just genuinely close towns from the same list
// or otherwise well-known neighbors.
export interface LocalTown {
  slug: string;
  name: string;
  region: string;
  nearby: string[];
}

// Keyed by region — the one genuinely differentiated paragraph per page
// (beyond swapping the town name), since hand-writing 50 unique intros
// isn't realistic and isn't what makes these pages useful anyway; the real
// value is being a real, indexable page for "[town] mold testing" at all.
export const REGION_CONTEXT: Record<string, string> = {
  "Greater Boston":
    "Housing stock in this area tends to be older, and finished basements are common — both are frequent sources of the musty smells and hidden moisture that lead homeowners to test.",
  "North Shore":
    "Coastal humidity and older, shingle-style homes make air quality testing a common step for homeowners near the water.",
  "South Shore":
    "Between older coastal homes and finished basements further inland, moisture-related air quality concerns come up often in this area.",
  MetroWest:
    "Larger, older homes with finished basements and walkout lower levels are common here, which is exactly the kind of space that tends to trap moisture unnoticed.",
  "Central Massachusetts":
    "Older farmhouses and homes on well water are common in this area, and both come with their own moisture and air-quality considerations.",
  "Western Massachusetts":
    "Older homes, basements, and well water are all common in this part of the state, and each is a reasonable prompt to test rather than guess.",
  "Cape Cod":
    "Coastal humidity, older shingle-style homes, and homes that sit closed up for stretches of the year all make air quality testing a common request on the Cape.",
  "Martha's Vineyard + Nantucket":
    "Island humidity and homes that sit closed up for part of the year make air quality testing a common request before opening a house back up.",
};

export const localTowns: LocalTown[] = [
  // Greater Boston
  { slug: "weston", name: "Weston", region: "Greater Boston", nearby: ["Wayland", "Wellesley", "Lincoln"] },
  { slug: "wellesley", name: "Wellesley", region: "Greater Boston", nearby: ["Weston", "Needham", "Dover"] },
  { slug: "newton", name: "Newton", region: "Greater Boston", nearby: ["Brookline", "Wellesley", "Needham"] },
  { slug: "brookline", name: "Brookline", region: "Greater Boston", nearby: ["Newton", "Boston", "Belmont"] },
  { slug: "lexington", name: "Lexington", region: "Greater Boston", nearby: ["Winchester", "Belmont", "Concord"] },
  { slug: "winchester", name: "Winchester", region: "Greater Boston", nearby: ["Lexington", "Belmont", "Arlington"] },
  { slug: "belmont", name: "Belmont", region: "Greater Boston", nearby: ["Lexington", "Winchester", "Brookline"] },
  { slug: "concord", name: "Concord", region: "Greater Boston", nearby: ["Lincoln", "Lexington", "Sudbury"] },
  { slug: "lincoln", name: "Lincoln", region: "Greater Boston", nearby: ["Concord", "Weston", "Sudbury"] },
  { slug: "needham", name: "Needham", region: "Greater Boston", nearby: ["Wellesley", "Newton", "Dover"] },

  // North Shore
  { slug: "manchester-by-the-sea", name: "Manchester-by-the-Sea", region: "North Shore", nearby: ["Hamilton", "Wenham", "Marblehead"] },
  { slug: "marblehead", name: "Marblehead", region: "North Shore", nearby: ["Swampscott", "Salem", "Manchester-by-the-Sea"] },
  { slug: "hamilton", name: "Hamilton", region: "North Shore", nearby: ["Wenham", "Topsfield", "Manchester-by-the-Sea"] },
  { slug: "wenham", name: "Wenham", region: "North Shore", nearby: ["Hamilton", "Topsfield", "Beverly"] },
  { slug: "topsfield", name: "Topsfield", region: "North Shore", nearby: ["Boxford", "Wenham", "Hamilton"] },
  { slug: "boxford", name: "Boxford", region: "North Shore", nearby: ["Topsfield", "North Andover", "Andover"] },
  { slug: "north-andover", name: "North Andover", region: "North Shore", nearby: ["Andover", "Boxford", "Topsfield"] },
  { slug: "andover", name: "Andover", region: "North Shore", nearby: ["North Andover", "Boxford", "Lexington"] },

  // South Shore
  { slug: "cohasset", name: "Cohasset", region: "South Shore", nearby: ["Hingham", "Scituate", "Norwell"] },
  { slug: "hingham", name: "Hingham", region: "South Shore", nearby: ["Cohasset", "Norwell", "Hull"] },
  { slug: "duxbury", name: "Duxbury", region: "South Shore", nearby: ["Marshfield", "Norwell", "Hanover"] },
  { slug: "norwell", name: "Norwell", region: "South Shore", nearby: ["Hingham", "Cohasset", "Hanover"] },
  { slug: "milton", name: "Milton", region: "South Shore", nearby: ["Quincy", "Canton", "Hingham"] },
  { slug: "scituate", name: "Scituate", region: "South Shore", nearby: ["Cohasset", "Hingham", "Marshfield"] },
  { slug: "marshfield", name: "Marshfield", region: "South Shore", nearby: ["Duxbury", "Scituate", "Hanover"] },
  { slug: "hanover", name: "Hanover", region: "South Shore", nearby: ["Norwell", "Duxbury", "Marshfield"] },

  // MetroWest
  { slug: "sudbury", name: "Sudbury", region: "MetroWest", nearby: ["Wayland", "Concord", "Lincoln"] },
  { slug: "wayland", name: "Wayland", region: "MetroWest", nearby: ["Sudbury", "Weston", "Lincoln"] },
  { slug: "dover", name: "Dover", region: "MetroWest", nearby: ["Sherborn", "Needham", "Wellesley"] },
  { slug: "sherborn", name: "Sherborn", region: "MetroWest", nearby: ["Dover", "Holliston", "Medfield"] },
  { slug: "southborough", name: "Southborough", region: "MetroWest", nearby: ["Hopkinton", "Westborough", "Sudbury"] },
  { slug: "hopkinton", name: "Hopkinton", region: "MetroWest", nearby: ["Southborough", "Holliston", "Ashland"] },
  { slug: "holliston", name: "Holliston", region: "MetroWest", nearby: ["Hopkinton", "Sherborn", "Medfield"] },
  { slug: "medfield", name: "Medfield", region: "MetroWest", nearby: ["Dover", "Sherborn", "Holliston"] },

  // Central Massachusetts
  { slug: "harvard", name: "Harvard", region: "Central Massachusetts", nearby: ["Bolton", "Boxborough", "Sterling"] },
  { slug: "bolton", name: "Bolton", region: "Central Massachusetts", nearby: ["Harvard", "Stow", "Sterling"] },
  { slug: "sterling", name: "Sterling", region: "Central Massachusetts", nearby: ["Boylston", "Bolton", "Harvard"] },
  { slug: "boylston", name: "Boylston", region: "Central Massachusetts", nearby: ["Sterling", "Berlin", "West Boylston"] },

  // Western Massachusetts
  { slug: "longmeadow", name: "Longmeadow", region: "Western Massachusetts", nearby: ["East Longmeadow", "Springfield"] },
  { slug: "williamstown", name: "Williamstown", region: "Western Massachusetts", nearby: ["Lenox", "North Adams"] },
  { slug: "lenox", name: "Lenox", region: "Western Massachusetts", nearby: ["Williamstown", "Great Barrington", "Stockbridge"] },
  { slug: "great-barrington", name: "Great Barrington", region: "Western Massachusetts", nearby: ["Lenox", "Stockbridge"] },

  // Cape Cod
  { slug: "chatham", name: "Chatham", region: "Cape Cod", nearby: ["Orleans", "Brewster", "Harwich"] },
  { slug: "falmouth", name: "Falmouth", region: "Cape Cod", nearby: ["Barnstable", "Sandwich", "Mashpee"] },
  { slug: "orleans", name: "Orleans", region: "Cape Cod", nearby: ["Chatham", "Brewster", "Eastham"] },
  { slug: "brewster", name: "Brewster", region: "Cape Cod", nearby: ["Orleans", "Chatham", "Dennis"] },
  { slug: "dennis", name: "Dennis", region: "Cape Cod", nearby: ["Brewster", "Yarmouth", "Harwich"] },
  { slug: "yarmouth", name: "Yarmouth", region: "Cape Cod", nearby: ["Dennis", "Barnstable", "Brewster"] },

  // Martha's Vineyard + Nantucket
  { slug: "nantucket", name: "Nantucket", region: "Martha's Vineyard + Nantucket", nearby: ["Edgartown"] },
  { slug: "edgartown", name: "Edgartown", region: "Martha's Vineyard + Nantucket", nearby: ["West Tisbury", "Nantucket"] },
];
