import React, { useMemo, useState, useEffect, useCallback } from "react";
import cardsCatalog from "../data/cards.json";          // root/data/cards.json
import offers from "./data/offers.demo.json";           // src/data/offers.demo.json
import { rankCards } from "./lib/ranker";               // src/lib/ranker

/* ---------- tiny inline localStorage hook ---------- */
function useLocalStorage(key, initialValue) {
  const [storedValue, setStoredValue] = useState(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch {
      return initialValue;
    }
  });
  useEffect(() => {
    try { window.localStorage.setItem(key, JSON.stringify(storedValue)); } catch {}
  }, [key, storedValue]);
  return [storedValue, setStoredValue];
}

/* ---------- UI categories ---------- */
const CATEGORIES = [
  { id: "grocery", label: "Groceries" },
  { id: "dining", label: "Dining" },
  { id: "gas", label: "Gas" },
  { id: "transit", label: "Transit/Rideshare" },
  { id: "drugstore", label: "Drugstore" },
  { id: "travel", label: "Travel" },
  { id: "online", label: "Online Retail" },
  { id: "warehouse", label: "Warehouse Clubs" },
  { id: "department_store", label: "Department Store" },
  { id: "utilities", label: "Utilities" },
  { id: "ev_charging", label: "EV Charging" },
  { id: "home_improve", label: "Home Improvement" },
  { id: "streaming", label: "Streaming Services" },
  { id: "other", label: "Everything Else" }
];

/* ---------- BoA CCP 3% choices ---------- */
const BOA_CCP_CHOICES = [
  { id: "online",        label: "Online shopping",                 inject: { online: 3 } },
  { id: "dining",        label: "Dining",                          inject: { dining: 3 } },
  { id: "drugstore",     label: "Drug stores",                     inject: { drugstore: 3 } },
  { id: "gas_ev",        label: "Gas & EV charging",               inject: { gas: 3, ev_charging: 3 } },
  { id: "home_improve",  label: "Home improvement & furnishing",   inject: { home_improve: 3 } },
  { id: "travel",        label: "Travel",                          inject: { travel: 3 } }
];

/* ---------- Citi Custom Cash 5% choices ---------- */
const CITI_CUSTOM_CASH_CHOICES = [
  { id: "grocery", label: "Grocery stores", inject: { grocery: 5 } },
  { id: "gas", label: "Gas stations", inject: { gas: 5 } },
  { id: "dining", label: "Restaurants", inject: { dining: 5 } },
  { id: "travel", label: "Travel", inject: { travel: 5 } },
  { id: "transit", label: "Transit", inject: { transit: 5 } },
  { id: "drugstore", label: "Drugstores", inject: { drugstore: 5 } },
  { id: "home_improve", label: "Home improvement stores", inject: { home_improve: 5 } },
  { id: "entertainment", label: "Entertainment", inject: { entertainment: 5 } }
];

/* ---------- merchant helpers (auto-build from offers) ---------- */
function prettyMerchantLabel(id) {
  if (!id) return "";
  return id.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

// Smart search keywords for AI-powered merchant discovery
const SEARCH_KEYWORDS = {
  // Food & Dining
  "coffee": ["starbucks", "dunkin"],
  "burger": ["shake_shack", "mcdonalds"],
  "food": ["shake_shack", "CrackerBarrel", "Cinnabon", "JerseyMikes"],
  "restaurant": ["shake_shack", "CrackerBarrel", "JerseyMikes"],
  "sandwich": ["JerseyMikes"],
  "breakfast": ["CrackerBarrel", "Cinnabon"],
  "dining": ["shake_shack", "CrackerBarrel", "Cinnabon", "JerseyMikes"],
  
  // Shopping & Retail
  "clothes": ["levis", "Anthropologie", "mizzen_main", "nordstrom"],
  "clothing": ["levis", "Anthropologie", "mizzen_main", "nordstrom"],
  "fashion": ["levis", "Anthropologie", "mizzen_main", "nordstrom"],
  "jeans": ["levis"],
  "dress": ["Anthropologie", "nordstrom"],
  "shirt": ["mizzen_main", "levis"],
  "shoes": ["crocs", "on_running", "nordstrom"],
  "sneakers": ["on_running"],
  "running": ["on_running", "fanatics"],
  "sports": ["fanatics", "on_running"],
  
  // Beauty & Personal Care
  "makeup": ["glossier"],
  "beauty": ["glossier"],
  "skincare": ["glossier"],
  
  // Tech & Electronics  
  "computer": ["logitech", "LG"],
  "mouse": ["logitech"],
  "keyboard": ["logitech"],
  "monitor": ["LG"],
  "tv": ["LG"],
  "vacuum": ["dyson"],
  "tech": ["logitech", "LG", "dyson"],
  "electronics": ["logitech", "LG", "dyson"],
  
  // Travel
  "flight": ["SouthwestAirlines"],
  "airline": ["SouthwestAirlines"],
  "travel": ["SouthwestAirlines"],
  
  // Learning
  "language": ["pimsleur"],
  "learning": ["pimsleur"],
  "education": ["pimsleur"]
};

function smartMerchantSearch(query, allMerchants) {
  if (!query || query.length < 2) return allMerchants;
  
  const lowerQuery = query.toLowerCase().trim();
  const results = [];
  const seen = new Set();
  
  // 1. Exact merchant name matches (highest priority)
  for (const merchant of allMerchants) {
    if (merchant.id && merchant.label.toLowerCase().includes(lowerQuery)) {
      results.push(merchant);
      seen.add(merchant.id);
    }
  }
  
  // 2. Keyword matches (AI-powered suggestions)
  for (const [keyword, merchantIds] of Object.entries(SEARCH_KEYWORDS)) {
    if (keyword.includes(lowerQuery) || lowerQuery.includes(keyword)) {
      for (const merchantId of merchantIds) {
        if (!seen.has(merchantId)) {
          const merchant = allMerchants.find(m => m.id === merchantId);
          if (merchant) {
            results.push({
              ...merchant,
              matchReason: `Related to "${keyword}"`
            });
            seen.add(merchantId);
          }
        }
      }
    }
  }
  
  // 3. Partial matches in merchant IDs
  for (const merchant of allMerchants) {
    if (merchant.id && !seen.has(merchant.id) && merchant.id.toLowerCase().includes(lowerQuery)) {
      results.push(merchant);
      seen.add(merchant.id);
    }
  }
  
  return results.slice(0, 10); // Limit results
}

// Fallback category mapping for merchants that don't have categories in offers
const MERCHANT_CATEGORY_FALLBACKS = {
  // Clothing/Fashion
  "levis": "online",
  "Anthropologie": "online",  // Note: Capital A to match the JSON
  "mizzen_main": "online",
  
  // Beauty/Personal Care
  "glossier": "online",
  
  // Tech/Electronics
  "logitech": "online",
  "dyson": "online",
  "LG": "online",
  
  // Footwear
  "crocs": "online",
  "on_running": "online",
  
  // Sports/Fanatics
  "fanatics": "online",
  
  // Food/Restaurants
  "shake_shack": "dining",
  "CrackerBarrel": "dining",
  "Cinnabon": "dining",
  "JerseyMikes": "dining",
  
  // Department Stores
  "nordstrom": "department_store",
  
  // Travel
  "SouthwestAirlines": "travel",
  
  // Education/Services
  "pimsleur": "online"
};

function pickCategoryFromOffers(offersForMerchant, merchantId) {
  // First try to get category from offers
  const counts = {};
  for (const o of offersForMerchant) {
    const cats = Array.isArray(o.categories) ? o.categories : [];
    for (const c of cats) counts[c] = (counts[c] || 0) + 1;
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  
  if (top) return top[0]; // Found category in offers
  
  // Fall back to our manual mapping
  return MERCHANT_CATEGORY_FALLBACKS[merchantId] || null;
}

/* ---------- helpers ---------- */
const money = (n) => n.toLocaleString(undefined, { style: "currency", currency: "USD" });
function categoryIdSafe(currentCategory, merchantId, categoryUsed) {
  return merchantId ? categoryUsed : currentCategory;
}

/* =============================================================== */
/*                        CARD VISUAL SYSTEM                      */
/* =============================================================== */

// Card visual data mapping
const CARD_VISUALS = {
  // Chase Cards
  "csp": {
    gradient: "linear-gradient(135deg, #1e3a8a 0%, #3b82f6 50%, #60a5fa 100%)",
    accent: "#ffffff",
    pattern: "sapphirepreferred",
    textColor: "#ffffff"
  },
  "csr": {
    gradient: "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)",
    accent: "#fbbf24",
    pattern: "reserve",
    textColor: "#ffffff"
  },
  "cff": {
  gradient: "linear-gradient(135deg, #0f4c75 0%, #13a4dd 50%, #5bc0de 100%)",
  accent: "#ffffff", 
  pattern: "freedom",
  textColor: "#ffffff"
},
  "cfu": {
  gradient: "linear-gradient(135deg, #1f528e 0%, #151933 100%)",
  accent: "#ffffff",
  pattern: "freedom", 
  textColor: "#ffffff"
},
  "amazon_prime_visa": {
  gradient: "linear-gradient(135deg, #0a1a2d 0%, #0f223d 50%, #1a3456 100%)",
  accent: "#199efe",
  pattern: "amazon",
  textColor: "#ffffff"
},
  "amazon-prime-store": {
    gradient: "linear-gradient(135deg, #232f3e 0%, #37475a 50%, #566573 100%)",
    accent: "#ff9900",
    pattern: "simple",
    textColor: "#ffffff"
  },
  "chase_united_explorer": {
  gradient: "linear-gradient(270deg, #15253e 0%, #0d3a7c 100%)",
  accent: "#ffffff",
  pattern: "airline",
  textColor: "#ffffff"
},
  "chase_southwest_priority": {
  gradient: "linear-gradient(135deg, #1a2452 0%, #273a6d 50%, #3b4f8a 100%)",
  accent: "#ffffff",
  pattern: "southwest",
  textColor: "#ffffff"
},
  "chase_marriott_boundless": {
    gradient: "linear-gradient(135deg, #7c2d12 0%, #dc2626 50%, #ef4444 100%)",
    accent: "#fbbf24",
    pattern: "hotel",
    textColor: "#ffffff"
  },
  "chase_marriott_bold": {
    gradient: "linear-gradient(135deg, #7c2d12 0%, #dc2626 50%, #ef4444 100%)",
    accent: "#ffffff",
    pattern: "simple",
    textColor: "#ffffff"
  },
  "chase_ihg_premier": {
    gradient: "linear-gradient(135deg, #166534 0%, #16a34a 50%, #4ade80 100%)",
    accent: "#ffffff",
    pattern: "hotel",
    textColor: "#ffffff"
  },
  "chase_hyatt": {
    gradient: "linear-gradient(135deg, #7c2d12 0%, #a16207 50%, #ca8a04 100%)",
    accent: "#ffffff",
    pattern: "hotel",
    textColor: "#ffffff"
  },
  "chase_british_airways": {
    gradient: "linear-gradient(135deg, #1e40af 0%, #dc2626 50%, #ef4444 100%)",
    accent: "#ffffff",
    pattern: "airline",
    textColor: "#ffffff"
  },
  // Amex Cards
  "amex_plat": {
    gradient: "linear-gradient(135deg, #8e9aaf 0%, #cfd2da 30%, #e8eaed 70%, #f5f5f5 100%)",
    accent: "#000000",
    pattern: "platinum_outline",
    textColor: "#000000"
  },
  "amex_gold": {
    gradient: "linear-gradient(135deg, #b8860b 0%, #daa520 30%, #ffd700 70%, #ffed4e 100%)",
    accent: "#000000",
    pattern: "gold_outline",
    textColor: "#000000"
  },
  "amex_everyday": {
    gradient: "linear-gradient(135deg, #1e3a8a 0%, #3b82f6 50%, #60a5fa 100%)",
    accent: "#ffffff",
    pattern: "simple",
    textColor: "#ffffff"
  },
  "amex_bcp": {
    gradient: "linear-gradient(135deg, #1e40af 0%, #3b82f6 50%, #60a5fa 100%)",
    accent: "#ffffff",
    pattern: "circle",
    textColor: "#ffffff"
  },
  "amex_bce": {
    gradient: "linear-gradient(135deg, #1e40af 0%, #3b82f6 50%, #60a5fa 100%)",
    accent: "#ffffff",
    pattern: "simple",
    textColor: "#ffffff"
  },
  "amex_bread": {
    gradient: "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #475569 100%)",
    accent: "#ffffff",
    pattern: "simple",
    textColor: "#ffffff"
  },
  "schwab_investor": {
    gradient: "linear-gradient(135deg, #1e40af 0%, #3b82f6 50%, #60a5fa 100%)",
    accent: "#ffffff",
    pattern: "simple",
    textColor: "#ffffff"
  },
  "amex_delta_gold": {
    gradient: "linear-gradient(135deg, #dc2626 0%, #ef4444 50%, #f87171 100%)",
    accent: "#ffffff",
    pattern: "airline",
    textColor: "#ffffff"
  },
  "amex_delta_platinum": {
    gradient: "linear-gradient(135deg, #4c1d95 0%, #7c3aed 50%, #a855f7 100%)",
    accent: "#ffffff",
    pattern: "airline",
    textColor: "#ffffff"
  },
  "amex_hilton_honors": {
    gradient: "linear-gradient(135deg, #1e40af 0%, #3b82f6 50%, #60a5fa 100%)",
    accent: "#ffffff",
    pattern: "hotel",
    textColor: "#ffffff"
  },
  "amex_hilton_surpass": {
    gradient: "linear-gradient(135deg, #6b7280 0%, #9ca3af 50%, #d1d5db 100%)",
    accent: "#1f2937",
    pattern: "hotel",
    textColor: "#1f2937"
  },
  "amex_hilton_aspire": {
    gradient: "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)",
    accent: "#fbbf24",
    pattern: "hotel",
    textColor: "#ffffff"
  },
  // Citi Cards
  "double_cash": {
    gradient: "linear-gradient(180deg, #1e40af 0%, #1e40af 50%, #059669 50%, #059669 100%)",
    accent: "#ffffff",
    pattern: "circle",
    textColor: "#ffffff"
  },
  "citi_custom_cash": {
    gradient: "linear-gradient(135deg, #059669 0%, #10b981 50%, #34d399 100%)",
    accent: "#ffffff",
    pattern: "circle",
    textColor: "#ffffff"
  },
  "citi_rewards_plus": {
    gradient: "linear-gradient(135deg, #6b7280 0%, #9ca3af 50%, #d1d5db 100%)",
    accent: "#1f2937",
    pattern: "simple",
    textColor: "#1f2937"
  },
  "citi-advantage-plat-select": {
    gradient: "linear-gradient(135deg, #6b7280 0%, #9ca3af 50%, #d1d5db 100%)",
    accent: "#dc2626",
    pattern: "airline",
    textColor: "#1f2937"
  },
  "citi_aadvantage_exec": {
    gradient: "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)",
    accent: "#dc2626",
    pattern: "airline",
    textColor: "#ffffff"
  },
  // Discover Cards
  "discover_it": {
  gradient: "linear-gradient(135deg, #ff6000 0%, #ff8c00 50%, #ffa500 100%)",
  accent: "#000000",  // Changed this line
  pattern: "discover",
  textColor: "#ffffff"
},
"discover_it_miles": {
  gradient: "linear-gradient(135deg, #ff6000 0%, #ff8c00 50%, #ffa500 100%)",
  accent: "#000000",  // Changed this line  
  pattern: "simple",
  textColor: "#ffffff"
},
  // Capital One Cards
  "cap1_venturex": {
  gradient: "linear-gradient(135deg, #0c1935 0%, #1e2746 50%, #2d3748 100%)",
  accent: "#ff0000",
  pattern: "venturex",
  textColor: "#ffffff"
},
  "capital_one_venture": {
    gradient: "linear-gradient(135deg, #1f2937 0%, #374151 50%, #6b7280 100%)",
    accent: "#dc2626",
    pattern: "simple",
    textColor: "#ffffff"
  },
  "capital_one_savor": {
    gradient: "linear-gradient(135deg, #dc2626 0%, #ef4444 50%, #f87171 100%)",
    accent: "#ffffff",
    pattern: "circle",
    textColor: "#ffffff"
  },
  "capital_one_savorone": {
    gradient: "linear-gradient(135deg, #dc2626 0%, #ef4444 50%, #f87171 100%)",
    accent: "#ffffff",
    pattern: "simple",
    textColor: "#ffffff"
  },
  "capital_one_quicksilver": {
    gradient: "linear-gradient(135deg, #6b7280 0%, #9ca3af 50%, #d1d5db 100%)",
    accent: "#1f2937",
    pattern: "simple",
    textColor: "#1f2937"
  },
  // Bank of America Cards
  "boa_ccp": {
    gradient: "linear-gradient(135deg, #dc2626 0%, #ef4444 50%, #f87171 100%)",
    accent: "#ffffff",
    pattern: "circle",
    textColor: "#ffffff"
  },
  "boa_ucr": {
    gradient: "linear-gradient(135deg, #95969a 0%, #9c9ca0 50%, #b1b1b3 100%)",
    accent: "#ffffff",
    pattern: "simple",
    textColor: "#ffffff"
  },
  "boa_premium_rewards": {
    gradient: "linear-gradient(135deg, #0f172a 0%, #dc2626 50%, #ef4444 100%)",
    accent: "#fbbf24",
    pattern: "circle",
    textColor: "#ffffff"
  },
  "boa_alaska": {
    gradient: "linear-gradient(135deg, #1e40af 0%, #3b82f6 50%, #60a5fa 100%)",
    accent: "#ffffff",
    pattern: "airline",
    textColor: "#ffffff"
  },
  // Wells Fargo Cards
  "wells_active": {
    gradient: "linear-gradient(135deg, #fbbf24 0%, #f59e0b 50%, #d97706 100%)",
    accent: "#92400e",
    pattern: "activecash",
    textColor: "#92400e"
  },
  "wells_fargo_propel": {
    gradient: "linear-gradient(135deg, #dc2626 0%, #ef4444 50%, #f87171 100%)",
    accent: "#ffffff",
    pattern: "circle",
    textColor: "#ffffff"
  },
  // U.S. Bank Cards
  "usbank_cash_plus": {
    gradient: "linear-gradient(135deg, #1e40af 0%, #3b82f6 50%, #60a5fa 100%)",
    accent: "#ffffff",
    pattern: "circle",
    textColor: "#ffffff"
  },
  "usbank_altitude_reserve": {
    gradient: "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)",
    accent: "#fbbf24",
    pattern: "simple",
    textColor: "#ffffff"
  },
  "usbank_shopper_cash": {
    gradient: "linear-gradient(135deg, #dc2626 0%, #ef4444 50%, #f87171 100%)",
    accent: "#ffffff",
    pattern: "simple",
    textColor: "#ffffff"
  },
  // Other Cards
  "pnc_cash_unlimited": {
    gradient: "linear-gradient(135deg, #1e40af 0%, #3b82f6 50%, #60a5fa 100%)",
    accent: "#ffffff",
    pattern: "simple",
    textColor: "#ffffff"
  },
  "fidelity_rewards": {
    gradient: "linear-gradient(135deg, #059669 0%, #10b981 50%, #34d399 100%)",
    accent: "#ffffff",
    pattern: "simple",
    textColor: "#ffffff"
  },
  "sofi_credit_card": {
    gradient: "linear-gradient(135deg, #1e40af 0%, #3b82f6 50%, #60a5fa 100%)",
    accent: "#ffffff",
    pattern: "simple",
    textColor: "#ffffff"
  },
  "apple_card": {
    gradient: "linear-gradient(135deg, #ffffff 0%, #f8fafc 50%, #e2e8f0 100%)",
    accent: "#000000",
    pattern: "apple",
    textColor: "#000000"
  },
  // Barclays Cards
  "barclays_aa_red": {
    gradient: "linear-gradient(135deg, #dc2626 0%, #ef4444 50%, #f87171 100%)",
    accent: "#ffffff",
    pattern: "airline",
    textColor: "#ffffff"
  },
  "barclays_hawaiian": {
    gradient: "linear-gradient(135deg, #059669 0%, #10b981 50%, #34d399 100%)",
    accent: "#fbbf24",
    pattern: "airline",
    textColor: "#ffffff"
  },
  "barclays_wyndham": {
    gradient: "linear-gradient(135deg, #1e40af 0%, #3b82f6 50%, #60a5fa 100%)",
    accent: "#ffffff",
    pattern: "hotel",
    textColor: "#ffffff"
  }
};

// Pattern components
const CardPatterns = {
unlimited: (accent) => (
    <div className="absolute inset-0 opacity-25">
      <div className="absolute top-4 right-4 w-8 h-8 border-2 rounded-lg" style={{borderColor: accent}}></div>
      <div className="absolute bottom-4 left-4 w-4 h-1" style={{backgroundColor: accent}}></div>
    </div>
  ),
  amazon: (accent) => (
    <div className="absolute inset-0">
      <div className="absolute bottom-6 right-2 text-xs font-bold opacity-90" style={{color: accent}}>prime</div>
    </div>
  ),
  airline: (accent) => (
    <div className="absolute inset-0 opacity-30">
      <div className="absolute top-4 right-4 w-6 h-2" style={{backgroundColor: accent, borderRadius: '1px'}}></div>
      <div className="absolute bottom-4 left-4 w-3 h-3 rounded-full border" style={{borderColor: accent}}></div>
    </div>
  ),
  southwest: (accent) => (
  <div className="absolute inset-0 opacity-80">
    <div className="absolute top-4 right-4 text-3xl font-bold" style={{color: '#c0c0c0'}}>♥</div>
    <div className="absolute bottom-4 left-4 w-3 h-3 rounded-full border" style={{borderColor: accent}}></div>
  </div>
),
  hotel: (accent) => (
    <div className="absolute inset-0 opacity-25">
      <div className="absolute top-4 left-4 w-2 h-6 border-l-2 border-t-2 border-r-2" style={{borderColor: accent}}></div>
      <div className="absolute bottom-4 right-4 w-4 h-1" style={{backgroundColor: accent}}></div>
    </div>
  ),
  apple: (accent) => (
    <div className="absolute inset-0 opacity-30">
      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
        <div className="w-6 h-6 rounded-full border-2" style={{borderColor: accent}}></div>
        <div className="absolute top-1 left-2 w-2 h-2 rounded-sm" style={{backgroundColor: accent}}></div>
      </div>
    </div>
  ),
  circle: (accent) => (
  <div className="absolute inset-0 opacity-20">
    <div className="absolute bottom-3 right-4 w-6 h-6 rounded-full border" style={{borderColor: accent}}></div>
  </div>
),
  sapphire: (accent) => (
    <div className="absolute inset-0 opacity-20">
      <div className="absolute top-4 right-4 w-8 h-8 border-2 rounded-full" style={{borderColor: accent}}></div>
      <div className="absolute bottom-4 left-4 w-6 h-6 border border-white rounded-sm opacity-60"></div>
    </div>
  ),
  reserve: (accent) => (
    <div className="absolute inset-0">
      <div className="absolute top-4 right-4 w-10 h-6" style={{backgroundColor: accent, borderRadius: '2px'}}></div>
      <div className="absolute bottom-6 left-4 w-3 h-3 rounded-full" style={{backgroundColor: accent}}></div>
    </div>
  ),
  platinum_outline: (accent) => (
  <div className="absolute inset-0">
    {/* Metallic shine overlay */}
    <div className="absolute top-0 left-0 w-full h-1/3 bg-gradient-to-b from-white to-transparent opacity-30"></div>
    
    {/* Black outline that leaves bottom open */}
    <div className="absolute top-1 left-1 right-1 bottom-4 border-2 rounded-t-lg border-black" style={{borderBottomWidth: 0}}></div>
    
    {/* Smaller oval in the middle */}
    <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
      <div className="w-4 h-6 rounded-full border-2 border-black"></div>
    </div>
  </div>
),
  gold_outline: (accent) => (
  <div className="absolute inset-0">
    {/* Shiny overlay effect */}
    <div className="absolute top-0 left-0 w-full h-1/3 bg-gradient-to-b from-white to-transparent opacity-20"></div>
    
    {/* Black outline that leaves bottom open */}
    <div className="absolute top-1 left-1 right-1 bottom-4 border-2 rounded-t-lg border-black" style={{borderBottomWidth: 0}}></div>
    
    {/* Smaller oval in the middle */}
    <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
      <div className="w-4 h-6 rounded-full border-2 border-black"></div>
    </div>
  </div>
),
  freedom: (accent) => (
    <div className="absolute inset-0 opacity-30">
      <div className="absolute top-4 right-4 w-8 h-1" style={{backgroundColor: accent}}></div>
      <div className="absolute top-6 right-4 w-6 h-1" style={{backgroundColor: accent}}></div>
      <div className="absolute top-8 right-4 w-4 h-1" style={{backgroundColor: accent}}></div>
    </div>
  ),
  simple: (accent) => (
    <div className="absolute inset-0 opacity-20">
      <div className="absolute bottom-4 right-4 w-6 h-4 rounded-sm border" style={{borderColor: accent}}></div>
    </div>
  ),
  discover: (accent) => (
  <div className="absolute inset-0 overflow-hidden">
    <div
      className="absolute right-0"
      style={{
        top: '25%',
        height: '25%',
        aspectRatio: '1 / 1',
        borderRadius: '9999px',
        background:
          'radial-gradient(circle at 35% 50%, rgba(255,255,255,0.35), transparent 70%)',
        transform: 'translateX(50%)',
        border: `2px solid black`,   // <-- black border
        boxShadow: `inset 0 0 0 2px ${accent}`, // accent stroke inside
      }}
    />
  </div>
),

activecash: (accent) => (
  <div
    className="absolute inset-0 rounded-xl overflow-hidden"
    style={{
      background: `linear-gradient(
        to bottom,
        #e0e0e0 0%,   /* light gray top */
        #cfcfcf 100%  /* darker gray bottom */
      )`,
    }}
  >
    {/* diagonal stripe */}
    <div
      className="absolute inset-0"
      style={{
        background: `linear-gradient(
          135deg,
          #c0c0c0 0%,    /* gray start */
          #c0c0c0 20%,   /* stay gray at bottom-left */
          #b5121b 60%,   /* active cash red mid stripe */
          #7a0014 100%   /* deep maroon top-right */
        )`,
        clipPath: "polygon(0% 100%, 0% 70%, 100% 0%, 100% 30%)",
      }}
    />
  </div>
),

sapphirepreferred: (accent) => (
  <div
    className="absolute inset-0 rounded-xl overflow-hidden"
    style={{
      background: `radial-gradient(
        circle at 40% 50%,
        #1a4d8f 0%,
        #0a1c33 70%,
        #061223 100%
      )`,
    }}
  >
    {/* bright diagonal lines, vertically inverted */}
    <div
      className="absolute h-[2px] w-[200%]"
      style={{
        top: "20%",
        left: "-50%",
        background:
          "linear-gradient(to right, transparent, #6ec6ff, transparent)",
        transform: "rotate(-45deg)",
      }}
    />
    <div
      className="absolute h-[2px] w-[200%]"
      style={{
        top: "50%",
        left: "-50%",
        background:
          "linear-gradient(to right, transparent, #6ec6ff, transparent)",
        transform: "rotate(-45deg)",
      }}
    />
    <div
      className="absolute h-[2px] w-[200%]"
      style={{
        top: "75%",
        left: "-50%",
        background:
          "linear-gradient(to right, transparent, #6ec6ff, transparent)",
        transform: "rotate(-45deg)",
      }}
    />
  </div>
),





venturex: (accent) => (
  <div
    className="absolute inset-0 rounded-xl"
    style={{
      background: `linear-gradient(
        135deg,
        #0a1a2f 0%,   /* deep navy */
        #0f2d4a 40%,  /* mid navy */
        #112f56 70%,  /* lighter highlight */
        #0a1a2f 100%  /* back to deep navy */
      )`,
    }}
  >
    {/* optional subtle star/texture effect */}
    <div
      className="absolute inset-0"
      style={{
        backgroundImage:
          "radial-gradient(rgba(255,255,255,0.08) 1px, transparent 1px)",
        backgroundSize: "12px 12px",
      }}
    />
  </div>
),

  venture: (accent) => (
    <div className="absolute inset-0 opacity-40">
      <div className="absolute top-4 left-4 w-6 h-6 transform rotate-45 border-2" style={{borderColor: accent}}></div>
    </div>
  )
};

// Card visual component
function CreditCardVisual({ cardId, size = "md" }) {
  const visual = CARD_VISUALS[cardId] || {
    gradient: "linear-gradient(135deg, #6b7280 0%, #9ca3af 100%)",
    accent: "#ffffff",
    pattern: "simple",
    textColor: "#ffffff"
  };

  const sizeClasses = {
    sm: "w-16 h-10",
    md: "w-20 h-12", 
    lg: "w-24 h-15",
    xl: "w-32 h-20"
  };

  const Pattern = CardPatterns[visual.pattern] || CardPatterns.simple;

  return (
    <div 
      className={`${sizeClasses[size]} relative rounded-lg shadow-md overflow-hidden`}
      style={{ 
        background: visual.gradient,
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'
      }}
    >
      <Pattern accent={visual.accent} />
      
      {/* Card number dots (bottom left) */}
      <div className="absolute bottom-2 left-2 flex space-x-1 opacity-60">
        {[...Array(4)].map((_, i) => (
          <div 
            key={i} 
            className="w-1 h-1 rounded-full" 
            style={{backgroundColor: visual.textColor}}
          />
        ))}
      </div>
    </div>
  );
}

/* =============================================================== */
/*                        CARD SELECTION STEP                     */
/* =============================================================== */

function CardSelectionStep({ selectedCards, setSelectedCards, maxCards, cardsCatalog }) {
  const [selectedIssuer, setSelectedIssuer] = useState(null);

  // Define popular cards (based on your current data)
  const popularCardIds = ["csp", "amex_gold", "double_cash", "discover_it", "cap1_venturex", "wells_active"];

  // Define issuer groups with colors
  const issuerGroups = {
    "Chase": { name: "Chase", color: "blue" },
    "Amex": { name: "American Express", color: "blue" },
    "Citi": { name: "Citi", color: "red" },
    "Capital One": { name: "Capital One", color: "red" },
    "Bank of America": { name: "Bank of America", color: "red" },
    "Discover": { name: "Discover", color: "orange" },
    "Wells Fargo": { name: "Wells Fargo", color: "red" },
    "U.S. Bank": { name: "U.S. Bank", color: "blue" },
    "Barclays": { name: "Barclays", color: "blue" },
    "Goldman Sachs": { name: "Goldman Sachs", color: "gray" },
    "Fidelity": { name: "Fidelity", color: "green" },
    "SoFi": { name: "SoFi", color: "blue" },
    "PNC Bank": { name: "PNC Bank", color: "yellow" }
  };

  // Get cards by issuer
  const cardsByIssuer = useMemo(() => {
    const groups = {};
    cardsCatalog.forEach(card => {
      if (!groups[card.issuer]) {
        groups[card.issuer] = [];
      }
      groups[card.issuer].push(card);
    });
    return groups;
  }, [cardsCatalog]);

  // Get popular cards
  const popularCards = useMemo(() => {
    return cardsCatalog.filter(card => popularCardIds.includes(card.id));
  }, [cardsCatalog]);

  // Get cards to display
  const cardsToDisplay = selectedIssuer 
    ? cardsByIssuer[selectedIssuer] || []
    : popularCards;

  const toggleCard = useCallback((cardId) => {
  setSelectedCards(prev => {
    if (prev.includes(cardId)) {
      return prev.filter(id => id !== cardId);
    } else {
      return [...prev, cardId];
    }
  });
}, [setSelectedCards]);

const CardComponent = ({ card }) => {
    const isSelected = selectedCards.includes(card.id);
    const isDisabled = !isSelected && selectedCards.length >= maxCards;
    const categoryText = Object.entries(card.categories || {})
      .map(([cat, mult]) => `${mult}x ${cat}`)
      .join(', ');

    return (
      <button
        key={card.id}
        onClick={() => !isDisabled && toggleCard(card.id)}
        disabled={isDisabled}
        className={`text-left p-4 rounded-xl border-2 transition-all ${
          isSelected
            ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200"
            : isDisabled
            ? "border-slate-200 bg-slate-50 opacity-50 cursor-not-allowed"
            : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
        }`}
      >
        <div className="flex items-start gap-3">
          <CreditCardVisual cardId={card.id} size="md" />
          
          <div className="flex-1">
            <div className="font-medium">{card.name}</div>
            <div className="text-sm text-slate-500 mt-1">
              {card.type === "cashback" ? `${card.base}% base` : `${card.base}x base`}
              {card.program && ` • ${card.program}`}
            </div>
            {categoryText && (
              <div className="text-sm text-green-600 mt-1">{categoryText}</div>
            )}
            <div className="text-xs text-slate-400 mt-2 line-clamp-2">
              {card.notes?.slice(0, 2).join(' • ')}
            </div>
          </div>
          
          {isSelected && (
            <div className="text-blue-500">✓</div>
          )}
        </div>
      </button>
    );
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg sm:text-xl font-semibold mb-2">
          {selectedIssuer ? `${selectedIssuer} Cards` : 'Select your credit cards'}
        </h3>
        <p className="text-slate-600">
          {selectedIssuer 
            ? `Choose from ${selectedIssuer} cards (${selectedCards.length}/${maxCards} selected)` 
            : `Start with popular cards below, or browse by issuer (${selectedCards.length}/${maxCards} selected)`
          }
        </p>
      </div>

      {/* Back button when viewing specific issuer */}
      {selectedIssuer && (
        <button
          onClick={() => setSelectedIssuer(null)}
          className="flex items-center text-blue-600 hover:text-blue-800 text-sm"
        >
          ← Back to popular cards
        </button>
      )}

      {/* Cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-80 overflow-y-auto">
        {cardsToDisplay.map(card => (
          <CardComponent key={card.id} card={card} />
        ))}
      </div>

      {/* Issuer selection (only show when not viewing specific issuer) */}
      {!selectedIssuer && (
        <div className="border-t pt-4">
          <h4 className="text-lg font-medium text-slate-900 mb-3">Browse by Issuer</h4>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {Object.entries(cardsByIssuer).map(([issuer, cards]) => {
              const issuerInfo = issuerGroups[issuer] || { name: issuer, color: "gray" };
              return (
                <button
                  key={issuer}
                  onClick={() => setSelectedIssuer(issuer)}
                  className="p-3 rounded-lg border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-left transition-all"
                >
                  <div className="font-medium text-slate-900 text-sm">{issuerInfo.name}</div>
                  <div className="text-xs text-slate-500">{cards.length} cards</div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// Add this component to your existing app
// Uses your existing CATEGORIES, cardsCatalog, ownedIds state

function MyStrategy({ ownedIds, cardsCatalog, boaCcpChoice, citiCustomChoice }) {
  // Get user's actual cards with any custom category selections applied
  const ownedCards = useMemo(() => {
    let cards = cardsCatalog.filter(c => ownedIds.includes(c.id));
    
    // Handle BoA CCP custom category
    if (ownedIds.includes("boa_ccp")) {
      const choice = BOA_CCP_CHOICES.find(x => x.id === boaCcpChoice) || BOA_CCP_CHOICES[0];
      cards = cards.map(c => {
        if (c.id !== "boa_ccp") return c;
        return {
          ...c,
          categories: { ...c.categories, ...choice.inject }
        };
      });
    }
    
    // Handle Citi Custom Cash
    if (ownedIds.includes("citi_custom_cash")) {
      const choice = CITI_CUSTOM_CASH_CHOICES.find(x => x.id === citiCustomChoice) || CITI_CUSTOM_CASH_CHOICES[0];
      cards = cards.map(c => {
        if (c.id !== "citi_custom_cash") return c;
        return {
          ...c,
          categories: { ...choice.inject }
        };
      });
    }
    
    return cards;
  }, [cardsCatalog, ownedIds, boaCcpChoice, citiCustomChoice]);

  // Calculate best card for each category
  const strategy = useMemo(() => {
    const result = {};
    
    for (const cat of CATEGORIES) {
      let bestCard = null;
      let bestValue = 0;
      
      for (const card of ownedCards) {
        const mult = card.categories?.[cat.id] || card.base || 1;
        const value = card.type === "cashback" ? mult : mult * 1.25;
        
        if (value > bestValue) {
          bestValue = value;
          bestCard = card;
        }
      }
      
      if (bestCard && bestValue > 1) {
        const mult = bestCard.categories?.[cat.id] || bestCard.base || 1;
        result[cat.id] = {
          card: bestCard,
          multiplier: mult,
          type: bestCard.type
        };
      }
    }
    
    return result;
  }, [ownedCards]);

  if (ownedCards.length === 0) {
    return (
      <div className="text-center py-12">
        <h2 className="text-2xl font-bold text-slate-900 mb-4">No Cards Added Yet</h2>
        <p className="text-slate-600 mb-6">Add your credit cards to see your optimal strategy</p>
        <button className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600">
          Add Cards
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 mb-2">My Card Strategy</h1>
        <p className="text-slate-600">Your optimal card for each spending category</p>
      </div>

      <div className="grid gap-3">
        {CATEGORIES.map(category => {
          const categoryStrategy = strategy[category.id];
          
          if (!categoryStrategy) {
            return (
              <div key={category.id} className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-900">{category.label}</span>
                  <span className="text-sm text-slate-500">Use any card (1x)</span>
                </div>
              </div>
            );
          }

          const { card, multiplier, type } = categoryStrategy;
          const rewardText = type === "cashback" ? `${multiplier}%` : `${multiplier}x`;

          return (
            <div key={category.id} className="p-4 bg-white rounded-lg border border-slate-200 hover:border-slate-300 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="font-medium text-slate-900">{category.label}</span>
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <div className="w-2 h-2 rounded bg-blue-500" />
                    {card.name}
                  </div>
                </div>
                <div className="text-lg font-semibold text-green-600">
                  {rewardText}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-8 p-4 bg-blue-50 rounded-lg border border-blue-200">
        <h3 className="font-semibold text-blue-900 mb-2">💡 Quick Tips</h3>
        <ul className="text-sm text-blue-800 space-y-1">
          <li>• This strategy maximizes your rewards based on your current cards</li>
          <li>• Consider getting cards that fill gaps in your strategy</li>
          <li>• Check for rotating categories that might beat these rates</li>
        </ul>
      </div>
    </div>
  );
}

/* =============================================================== */
/*                        ONBOARDING WIZARD                       */
/* =============================================================== */

function OnboardingWizard({ onComplete }) {
  const [step, setStep] = useState(1);
  const [selectedCards, setSelectedCards] = useState([]);
  const [boaChoice, setBoaChoice] = useState("online");

  const maxCards = 5;
  const totalSteps = 3;

  function nextStep() {
    if (step < totalSteps) setStep(step + 1);
  }

  function prevStep() {
    if (step > 1) setStep(step - 1);
  }

  function finish() {
    onComplete(selectedCards, boaChoice);
  }

  // Get card recommendations based on selected cards
  const getCardStrategy = () => {
    const strategy = {};
    const cards = cardsCatalog.filter(c => selectedCards.includes(c.id));
    
    // Apply BoA CCP choice if selected
    const processedCards = cards.map(c => {
      if (c.id === "boa_ccp") {
        const choice = BOA_CCP_CHOICES.find(x => x.id === boaChoice) || BOA_CCP_CHOICES[0];
        return {
          ...c,
          categories: { ...c.categories, ...choice.inject }
        };
      }
      return c;
    });

    // Find best card for each category
    for (const cat of CATEGORIES) {
      let bestCard = null;
      let bestValue = 0;

      for (const card of processedCards) {
        const mult = card.categories?.[cat.id] || card.base || 1;
        const value = card.type === "cashback" ? mult : mult * 1.25; // Rough CPP estimate
        
        if (value > bestValue) {
          bestValue = value;
          bestCard = card;
        }
      }

      if (bestCard && bestValue > 1) {
        const mult = bestCard.categories?.[cat.id] || bestCard.base || 1;
        strategy[cat.id] = {
          card: bestCard,
          multiplier: mult,
          type: bestCard.type
        };
      }
    }

    return strategy;
  };

  const cardStrategy = step === 3 ? getCardStrategy() : {};

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-6 border-b border-slate-200">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold">Welcome to Best Card Picker!</h2>
              <p className="text-sm text-slate-600 mt-1">Step {step} of {totalSteps}</p>
            </div>
            <div className="flex space-x-2">
              {Array.from({ length: totalSteps }, (_, i) => (
                <div
                  key={i}
                  className={`w-3 h-3 rounded-full ${
                    i + 1 <= step ? 'bg-blue-500' : 'bg-slate-200'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Step Content */}
        <div className="p-6">
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg sm:text-xl font-semibold mb-2">Let's get you set up!</h3>
                <p className="text-slate-600">
                  We'll help you pick the best credit card for every purchase. This takes less than a minute.
                </p>
              </div>
              
              <div className="bg-blue-50 rounded-lg p-4">
                <h4 className="font-medium text-blue-900">What we'll do:</h4>
                <ul className="mt-2 text-sm text-blue-800 space-y-1">
                  <li>• Select your credit cards (up to 5)</li>
                  <li>• Configure any special settings</li>
                  <li>• Show you the optimal card for each category</li>
                </ul>
              </div>

              <div className="bg-green-50 rounded-lg p-4">
                <h4 className="font-medium text-green-900">Why this helps:</h4>
                <p className="mt-1 text-sm text-green-800">
                  Most people leave 2-5% cash back on the table by using the wrong card. 
                  We'll make sure you always use your best option!
                </p>
              </div>
            </div>
          )}

          {step === 2 && (
            <CardSelectionStep
              selectedCards={selectedCards}
              setSelectedCards={setSelectedCards}
              maxCards={maxCards}
              cardsCatalog={cardsCatalog}
            />
          )}

          {selectedCards.includes("boa_ccp") && step === 2 && (
            <div className="bg-orange-50 rounded-lg p-4 mt-4">
              <h4 className="font-medium text-orange-900 mb-2">BoA Customized Cash Setup</h4>
              <p className="text-sm text-orange-800 mb-3">Choose your 3% category:</p>
              <select
                value={boaChoice}
                onChange={(e) => setBoaChoice(e.target.value)}
                className="w-full rounded-lg border border-orange-200 p-2"
              >
                {BOA_CCP_CHOICES.map((choice) => (
                  <option key={choice.id} value={choice.id}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg sm:text-xl font-semibold mb-2">Your Personalized Card Strategy</h3>
                <p className="text-slate-600">
                  Based on your {selectedCards.length} cards, here's which card to use for each category:
                </p>
              </div>

              <div className="space-y-3 max-h-96 overflow-y-auto">
                {Object.entries(cardStrategy).map(([categoryId, info]) => {
                  const categoryLabel = CATEGORIES.find(c => c.id === categoryId)?.label || categoryId;
                  return (
                    <div key={categoryId} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                      <div>
                        <div className="font-medium">{categoryLabel}</div>
                        <div className="text-sm text-slate-500">{info.card.name}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-medium text-green-600">
                          {info.type === "cashback" ? `${info.multiplier}%` : `${info.multiplier}x`}
                        </div>
                      </div>
                    </div>
                  );
                })}
                
                {Object.keys(cardStrategy).length === 0 && (
                  <div className="text-center py-8 text-slate-500">
                    <p>Select some cards in the previous step to see your strategy!</p>
                  </div>
                )}
              </div>

              <div className="bg-blue-50 rounded-lg p-4">
                <p className="text-sm text-blue-800">
                  💡 <strong>Pro tip:</strong> You can always add more cards later or re-run this setup from the main page!
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-slate-200 flex justify-between">
          <button
            onClick={prevStep}
            disabled={step === 1}
            className="px-4 py-2 text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Back
          </button>
          
          <div className="flex space-x-3">
            {step < totalSteps ? (
              <button
                onClick={nextStep}
                disabled={step === 2 && selectedCards.length === 0}
                className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {step === 1 ? "Get Started" : "Continue"}
              </button>
            ) : (
              <button
                onClick={finish}
                className="px-6 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600"
              >
                Complete Setup
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* =============================================================== */

export default function CardPickerMVP() {
  // Persisted user state
  const [ownedIds, setOwnedIds] = useLocalStorage("ownedIds", []);
  const [boaCcpChoice, setBoaCcpChoice] = useLocalStorage("boaCcpChoice", "online");
  const [discoverActivated, setDiscoverActivated] = useLocalStorage("discoverActivated", true);
  const [discoverCapRemaining, setDiscoverCapRemaining] = useLocalStorage("discoverCapRemaining", 1500); // dollars
  const [enrolledOfferIds, setEnrolledOfferIds] = useLocalStorage("enrolledOfferIds", []); // array of offer ids
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useLocalStorage("hasCompletedOnboarding", false);
const [citiCustomChoice, setCitiCustomChoice] = useLocalStorage("tapthat_citiCustomChoice", "grocery");

  // Session state
  const [category, setCategory] = useState("dining");
  const [amount, setAmount] = useState(50);
  const [merchantId, setMerchantId] = useState("");
  const [merchantSearch, setMerchantSearch] = useState("");
  const [showMerchantResults, setShowMerchantResults] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(!hasCompletedOnboarding);
  const [currentView, setCurrentView] = useState("recommendation");

// --- Offers browser state ---
const [offerTab, setOfferTab] = useLocalStorage("offerTab", "online");

// offer eligibility: show an offer if user's wallet includes ANY of the offer's card_scope
function offerIsEligible(offer, ownedIds) {
  const scope = Array.isArray(offer.card_scope) ? offer.card_scope : [];
  if (scope.length === 0) return true; // some are issuer-wide
  return scope.some((id) => ownedIds.includes(id));
}

// pretty merchant label (already defined above, reuse if present)
// function prettyMerchantLabel(id) { ... }

// Build quick map for category label lookup
const CAT_LABEL = useMemo(() => Object.fromEntries(CATEGORIES.map(c => [c.id, c.label])), []);


  /* --- build merchant dropdown dynamically from offers --- */
  const merchants = useMemo(() => {
    const map = new Map();
    for (const o of offers) {
      if (!o.merchant_id) continue;
      if (!map.has(o.merchant_id)) map.set(o.merchant_id, []);
      map.get(o.merchant_id).push(o);
    }
    const rows = Array.from(map.entries()).map(([id, list]) => ({
      id,
      label: prettyMerchantLabel(id),
      category: pickCategoryFromOffers(list, id) // Now passes merchantId for fallback lookup
    }));
    return [
      { id: "", label: "— None (no merchant-specific offer) —", category: null },
      ...rows.sort((a, b) => a.label.localeCompare(b.label))
    ];
  }, []);

  // Smart search results
  const searchResults = useMemo(() => {
    return smartMerchantSearch(merchantSearch, merchants);
  }, [merchantSearch, merchants]);

  // Handle merchant selection
  const selectMerchant = (merchant) => {
    setMerchantId(merchant.id);
    setMerchantSearch(merchant.id ? merchant.label : "");
    setShowMerchantResults(false);
  };

  // Merchant → category lock
  const merchantMeta = merchants.find((m) => m.id === merchantId) || merchants[0];
  const categoryUsed = merchantMeta.category ?? category;

  // Owned cards (with BoA CCP 3% injection if owned)
  const ownedCards = useMemo(() => {
  let cards = cardsCatalog.filter((c) => ownedIds.includes(c.id));
  
  // Handle BoA CCP
  if (ownedIds.includes("boa_ccp")) {
    const choice = BOA_CCP_CHOICES.find((x) => x.id === boaCcpChoice) || BOA_CCP_CHOICES[0];
    cards = cards.map((c) => {
      if (c.id !== "boa_ccp") return c;
      const orig = c.categories || {};
      const noChosen = Object.fromEntries(Object.entries(orig).filter(([k]) => k !== "chosen"));
      return {
        ...c,
        categories: { ...noChosen, ...choice.inject },
        notes: [ ...(c.notes || []), `3% category selected: ${choice.label}` ]
      };
    });
  }

  // Handle Citi Custom Cash
  if (ownedIds.includes("citi_custom_cash")) {
    const choice = CITI_CUSTOM_CASH_CHOICES.find((x) => x.id === citiCustomChoice) || CITI_CUSTOM_CASH_CHOICES[0];
    cards = cards.map((c) => {
      if (c.id !== "citi_custom_cash") return c;
      return {
        ...c,
        categories: { ...choice.inject },
        notes: [ ...(c.notes || []), `5% category selected: ${choice.label}` ]
      };
    });
  }

  return cards;
}, [cardsCatalog, ownedIds, boaCcpChoice, citiCustomChoice]);

  // Offers relevant to current merchant, mapped by card id
  const offersByCard = useMemo(() => {
    const now = new Date().toISOString();
    const rel = merchantId
      ? offers.filter(
          (o) =>
            o.merchant_id === merchantId &&
            (!o.start_at || o.start_at <= now) &&
            (!o.end_at || o.end_at >= now)
        )
      : [];
    const map = {};
    for (const c of ownedCards) map[c.id] = rel;
    return map;
  }, [ownedCards, merchantId]);

  // Rotating payload (only if Discover is owned)
  const userRotating = useMemo(() => {
    if (!ownedIds.includes("discover_it")) return {};
    return {
      discover_it: {
        activated: !!discoverActivated,
        remainingCapCents: Math.max(0, Math.round((Number(discoverCapRemaining) || 0) * 100))
      }
    };
  }, [ownedIds, discoverActivated, discoverCapRemaining]);

// All live offers (by time) filtered to the cards the user actually owns, grouped by category
const offersGrouped = useMemo(() => {
  const now = new Date().toISOString();
  const live = offers.filter((o) =>
    (!o.start_at || o.start_at <= now) &&
    (!o.end_at || o.end_at >= now) &&
    offerIsEligible(o, ownedIds)
  );

  // Put “uncategorized” into a sane bucket (e.g., "online") or "other" if no category
  const buckets = new Map(); // catId -> array
  for (const o of live) {
    const cats = Array.isArray(o.categories) && o.categories.length ? o.categories : ["other"];
    for (const c of cats) {
      if (!buckets.has(c)) buckets.set(c, []);
      buckets.get(c).push(o);
    }
  }

  // Sort within each category by earliest end date, then by min spend ASC
  for (const [c, arr] of buckets) {
    arr.sort((a, b) => {
      const aEnd = a.end_at || "9999-12-31";
      const bEnd = b.end_at || "9999-12-31";
      if (aEnd !== bEnd) return aEnd.localeCompare(bEnd);
      const aMin = a.min_spend_cents || 0, bMin = b.min_spend_cents || 0;
      return aMin - bMin;
    });
  }

  return buckets; // Map<string, Offer[]>
}, [offers, ownedIds]);


  const userEnrolledOfferIds = useMemo(() => new Set(enrolledOfferIds), [enrolledOfferIds]);

  // Compute recommendations
  const recommendations = useMemo(() => {
    const amt = Number(amount) || 0;
    return rankCards(
      ownedCards,
      {
        amountCents: Math.round(amt * 100),
        categoryId: categoryUsed,
        programOverrides: {},
        nowISO: new Date().toISOString(),
        userRotating,
        userEnrolledOfferIds
      },
      offersByCard
    );
  }, [ownedCards, categoryUsed, amount, offersByCard, userRotating, userEnrolledOfferIds]);

  const top = recommendations[0];

  // toggle enrollment
  function toggleEnrollment(offerId, on) {
    setEnrolledOfferIds((prev) => {
      const s = new Set(prev);
      if (on) s.add(offerId);
      else s.delete(offerId);
      return Array.from(s);
    });
  }

// New Wallet Section Component - Replace the existing wallet section

function WalletSection({ ownedIds, setOwnedIds, cardsCatalog }) {
  const [showAddCards, setShowAddCards] = useState(false);
  const [selectedIssuer, setSelectedIssuer] = useState(null);

  // Get owned cards
  const ownedCards = cardsCatalog.filter(card => ownedIds.includes(card.id));

  // Define issuer groups (same as in setup wizard)
  const issuerGroups = {
    "Chase": { name: "Chase", color: "blue" },
    "Amex": { name: "American Express", color: "blue" },
    "Citi": { name: "Citi", color: "red" },
    "Capital One": { name: "Capital One", color: "red" },
    "Bank of America": { name: "Bank of America", color: "red" },
    "Discover": { name: "Discover", color: "orange" },
    "Wells Fargo": { name: "Wells Fargo", color: "red" },
    "U.S. Bank": { name: "U.S. Bank", color: "blue" },
    "Barclays": { name: "Barclays", color: "blue" },
    "Goldman Sachs": { name: "Goldman Sachs", color: "gray" },
    "Fidelity": { name: "Fidelity", color: "green" },
    "SoFi": { name: "SoFi", color: "blue" },
    "PNC Bank": { name: "PNC Bank", color: "yellow" }
  };

  // Get cards by issuer
  const cardsByIssuer = useMemo(() => {
    const groups = {};
    cardsCatalog.forEach(card => {
      if (!groups[card.issuer]) {
        groups[card.issuer] = [];
      }
      groups[card.issuer].push(card);
    });
    return groups;
  }, [cardsCatalog]);

  // Get cards to display in add modal
  const cardsToDisplay = selectedIssuer 
    ? cardsByIssuer[selectedIssuer] || []
    : [];

  const toggleCard = (cardId) => {
    setOwnedIds(prev => {
      if (prev.includes(cardId)) {
        return prev.filter(id => id !== cardId);
      } else {
        return [...prev, cardId];
      }
    });
  };

  const removeCard = (cardId) => {
    setOwnedIds(prev => prev.filter(id => id !== cardId));
  };

  const CardComponent = ({ card, isInWallet = false }) => {
    const isSelected = ownedIds.includes(card.id);
    const categoryText = Object.entries(card.categories || {})
      .map(([cat, mult]) => `${mult}x ${cat}`)
      .join(', ');

    return (
      <div className={`p-4 rounded-xl border-2 transition-all ${
        isSelected && !isInWallet
          ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200"
          : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
      }`}>
        <div className="flex items-start gap-3">
          <CreditCardVisual cardId={card.id} size="md" />
          
          <div className="flex-1">
            <div className="font-medium">{card.name}</div>
            <div className="text-sm text-slate-500 mt-1">
              {card.type === "cashback" ? `${card.base}% base` : `${card.base}x base`}
              {card.program && ` • ${card.program}`}
            </div>
            {categoryText && (
              <div className="text-sm text-green-600 mt-1">{categoryText}</div>
            )}
            <div className="text-xs text-slate-400 mt-2 line-clamp-2">
              {card.notes?.slice(0, 2).join(' • ')}
            </div>
          </div>
          
          {isInWallet ? (
            <button
              onClick={() => removeCard(card.id)}
              className="text-red-500 hover:text-red-700 p-1"
              title="Remove from wallet"
            >
              ✕
            </button>
          ) : (
            <button
              onClick={() => toggleCard(card.id)}
              className={`p-2 rounded-lg transition-all ${
                isSelected 
                  ? "text-blue-500 bg-blue-50" 
                  : "text-slate-400 hover:text-slate-600 hover:bg-slate-50"
              }`}
            >
              {isSelected ? "✓" : "+"}
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Your Wallet Section */}
      <section className="md:col-span-2 bg-white/90 backdrop-blur rounded-2xl shadow-lg ring-1 ring-black/5 p-4 sm:p-5 md:p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg sm:text-xl font-semibold">Your Wallet</h2>
          <button
            onClick={() => setShowAddCards(true)}
            className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-all font-medium"
          >
            + Add Cards
          </button>
        </div>

        {ownedCards.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {ownedCards.map(card => (
              <CardComponent key={card.id} card={card} isInWallet={true} />
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-slate-500">
            <p className="mb-4">No cards in your wallet yet!</p>
            <button
              onClick={() => setShowAddCards(true)}
              className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-all font-medium"
            >
              Add Your First Card
            </button>
          </div>
        )}
      </section>

      {/* Add Cards Modal */}
      {showAddCards && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="p-6 border-b border-slate-200">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold">
                    {selectedIssuer ? `${selectedIssuer} Cards` : 'Add Cards to Your Wallet'}
                  </h2>
                  <p className="text-sm text-slate-600 mt-1">
                    {selectedIssuer 
                      ? `Choose from ${selectedIssuer} cards` 
                      : 'Browse cards by issuer'
                    }
                  </p>
                </div>
                <button
                  onClick={() => {
                    setShowAddCards(false);
                    setSelectedIssuer(null);
                  }}
                  className="text-slate-400 hover:text-slate-600 text-2xl"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="p-6">
              {/* Back button when viewing specific issuer */}
              {selectedIssuer && (
                <button
                  onClick={() => setSelectedIssuer(null)}
                  className="flex items-center text-blue-600 hover:text-blue-800 text-sm mb-4"
                >
                  ← Back to issuers
                </button>
              )}

              {selectedIssuer ? (
                /* Cards grid for selected issuer */
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {cardsToDisplay.map(card => (
                    <CardComponent key={card.id} card={card} />
                  ))}
                </div>
              ) : (
                /* Issuer selection grid */
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {Object.entries(cardsByIssuer).map(([issuer, cards]) => {
                    const issuerInfo = issuerGroups[issuer] || { name: issuer, color: "gray" };
                    return (
                      <button
                        key={issuer}
                        onClick={() => setSelectedIssuer(issuer)}
                        className="p-4 rounded-lg border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-left transition-all"
                      >
                        <div className="font-medium text-slate-900">{issuerInfo.name}</div>
                        <div className="text-sm text-slate-500">{cards.length} cards</div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}



  // Complete onboarding
  function completeOnboarding(selectedCardIds, boaChoice) {
    setOwnedIds(selectedCardIds);
    if (selectedCardIds.includes("boa_ccp")) {
      setBoaCcpChoice(boaChoice);
    }
    setHasCompletedOnboarding(true);
    setShowOnboarding(false);
  }

  // Show onboarding if not completed
  if (showOnboarding) {
    return <OnboardingWizard onComplete={completeOnboarding} />;
  }

  return (
  <div className="min-h-dvh flex flex-col bg-gradient-to-br from-slate-50 to-slate-100 text-slate-900">
    <div className="wrapper flex-1 space-y-10">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur rounded-2xl shadow-sm ring-1 ring-black/5 p-6 text-center">
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
💳 TapThat</h1>
          <p className="mt-2 text-sm text-slate-600">
            Select your cards, merchant (optional), amount — category locks automatically when a merchant is chosen.
          </p>
          <button 
            onClick={() => setShowOnboarding(true)}
            className="mt-3 text-xs text-blue-600 hover:text-blue-800 underline"
          >
            Re-run setup wizard
          </button>
        </header>

        {/* Purchase */}
        <section className="bg-white/90 backdrop-blur rounded-2xl shadow-lg ring-1 ring-black/5 p-4 sm:p-5 md:p-6 space-y-4">
          <h2 className="text-lg sm:text-xl font-semibold mb-2">Purchase</h2>

          {/* Smart Merchant Search */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Merchant (optional)</label>
            <div className="relative">
              <input
                type="text"
                className="w-full rounded-xl border border-slate-300 h-11 px-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
                placeholder="Search merchants... (try 'coffee', 'clothes', 'burger')"
                value={merchantSearch}
                onChange={(e) => {
                  setMerchantSearch(e.target.value);
                  setShowMerchantResults(true);
                  if (!e.target.value) {
                    setMerchantId("");
                  }
                }}
                onFocus={() => setShowMerchantResults(true)}
              />
              
              {/* Search Results Dropdown */}
              {showMerchantResults && merchantSearch && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-64 overflow-y-auto">
                  {searchResults.length > 0 ? (
                    searchResults.map((merchant) => (
                      <button
                        key={merchant.id || "none"}
                        className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b last:border-0 focus:outline-none focus:bg-blue-50"
                        onClick={() => selectMerchant(merchant)}
                      >
                        <div className="font-medium">{merchant.label}</div>
                        {merchant.matchReason && (
                          <div className="text-xs text-slate-500">{merchant.matchReason}</div>
                        )}
                        {merchant.category && (
                          <div className="text-xs text-blue-600">
                            �+' {CATEGORIES.find(c => c.id === merchant.category)?.label || merchant.category}
                          </div>
                        )}
                      </button>
                    ))
                  ) : (
                    <div className="px-3 py-2 text-sm text-slate-500">No merchants found</div>
                  )}
                </div>
              )}
              
              {/* Click outside to close */}
              {showMerchantResults && (
                <div 
                  className="fixed inset-0 z-5" 
                  onClick={() => setShowMerchantResults(false)}
                />
              )}
            </div>
            
            {merchantId && (
              <p className="text-xs text-slate-500">
                Category is locked to{" "}
                <span className="font-medium">
                  {CATEGORIES.find((c) => c.id === categoryUsed)?.label || categoryUsed || "�?""}
                </span>{" "}
                for this merchant.
              </p>
            )}
          </div>

          {/* Category (auto-locked if merchant selected) */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Category</label>
            <select
                className="w-full rounded-xl border border-slate-300 h-11 px-3 text-base disabled:bg-slate-100 disabled:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
              value={categoryIdSafe(category, merchantId, categoryUsed)}
              onChange={(e) => setCategory(e.target.value)}
              disabled={!!merchantId}
            >
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          {/* Amount */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Amount</label>
            <input
                className="w-full rounded-xl border border-slate-300 h-11 px-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
              type="number"
              min={0}
              step={0.01}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          {/* BoA CCP chosen category (only if owned) */}
          {ownedIds.includes("boa_ccp") && (
            <div className="space-y-2">
              <label className="text-sm font-medium">BoA Customized Cash �?" choose your 3% category</label>
              <select
                  className="w-full rounded-xl border border-slate-300 h-11 px-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
                value={boaCcpChoice}
                onChange={(e) => setBoaCcpChoice(e.target.value)}
              >
                {BOA_CCP_CHOICES.map((opt) => (
                  <option key={opt.id} value={opt.id}>{opt.label}</option>
                ))}
              </select>
              <p className="text-xs text-slate-500">
                Only one 3% category can be active at a time.
              </p>
            </div>
          )}

{/* Citi Custom Cash chosen category (only if owned) */}
{ownedIds.includes("citi_custom_cash") && (
  <div className="space-y-2">
    <label className="text-sm font-medium">Citi Custom Cash �?" choose your 5% category</label>
    <select
      className="w-full rounded-xl border border-slate-300 p-2"
      value={citiCustomChoice}
      onChange={(e) => setCitiCustomChoice(e.target.value)}
    >
      {CITI_CUSTOM_CASH_CHOICES.map((opt) => (
        <option key={opt.id} value={opt.id}>{opt.label}</option>
      ))}
    </select>
    <p className="text-xs text-slate-500">
      5% back up to $500 in purchases per billing cycle in your chosen category.
    </p>
  </div>
)}

          {/* Discover rotating controls (only if owned) */}
          {ownedIds.includes("discover_it") && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Discover it �?" 5% rotating (this quarter)</label>
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-2 text-sm sm:text-base">
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={discoverActivated}
                    onChange={e => setDiscoverActivated(e.target.checked)}
                  />
                  Activated
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-sm">Cap remaining</span>
                  <input
                      className="w-28 rounded-xl border border-slate-300 h-11 px-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
                    type="number"
                    min={0}
                    step={1}
                    value={discoverCapRemaining}
                    onChange={e => setDiscoverCapRemaining(e.target.value)}
                  />
                  <span className="text-sm">$</span>
                </div>
              </div>
              <p className="text-xs text-slate-500">
                5% applies up to $1,500 per quarter after activation; the rest earns 1%.
              </p>
            </div>
          )}

          {/* Merchant offers list (shows when a merchant is selected) */}
          {merchantId && (
            <div className="space-y-2">
              <div className="text-sm font-medium">Offers for this merchant</div>
              <div className="rounded-xl border border-slate-200 bg-white/70 p-3">
                {offers
                  .filter(o => o.merchant_id === merchantId)
                  .map(o => {
                    const requires = !!o.enrollment_required;
                    const enrolled = enrolledOfferIds.includes(o.id);
                    return (
                      <div key={o.id} className="flex items-start justify-between gap-3 py-2 border-b last:border-0">
                        <div>
                          <div className="text-sm font-medium">{o.title}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                            {requires && (
                              <span className={`inline-flex items-center rounded-full px-2 py-0.5 ring-1 ${enrolled ? "bg-green-50 text-green-700 ring-green-200" : "bg-amber-50 text-amber-700 ring-amber-200"}`}>
                                {enrolled ? "Enrolled" : "Enrollment required"}
                              </span>
                            )}
                            {o.min_spend_cents ? <span className="text-slate-500">Min spend ${(o.min_spend_cents/100).toFixed(0)}</span> : null}
                            {o.end_at ? <span className="text-slate-500">Ends {o.end_at.slice(0,10)}</span> : null}
                          </div>
                        </div>
                        {requires && (
                          <label className="inline-flex items-center gap-2 text-xs">
                            <input
                              type="checkbox"
                              checked={enrolled}
                              onChange={e => toggleEnrollment(o.id, e.target.checked)}
                            />
                            I've enrolled
                          </label>
                        )}
                      </div>
                    );
                  })}
                {offers.filter(o => o.merchant_id === merchantId).length === 0 && (
                  <div className="text-sm text-slate-500">No coded offers for this merchant.</div>
                )}
              </div>
              <p className="text-xs text-slate-500">
                Some issuer offers are targeted and require activation in your card app. Mark "I've enrolled" for ones you've activated so the math includes them.
              </p>
            </div>
          )}
        </section>

{/* Recommendation */}
        {currentView === "recommendation" && (
          <section className="bg-gradient-to-br from-blue-50 to-white rounded-2xl shadow-lg ring-1 ring-blue-100 p-4 sm:p-5 md:p-6">
            <h2 className="text-lg sm:text-xl font-semibold mb-4">Recommended Card</h2>
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
              <div className="flex-1">
                <div className="text-2xl font-bold text-blue-600">{top.card.name}</div>
                <div className="mt-1 text-sm text-slate-600">
                  Using category:{" "}
                  <span className="font-medium">
                    {CATEGORIES.find((c) => c.id === categoryUsed)?.label || categoryUsed || "—"}
                  </span>
                  {merchantId ? " (locked by merchant)" : ""}
                </div>

                <RecommendationNotes top={top} cards={ownedCards} />
              </div>

              <div className="text-right">
                <div className="text-sm text-slate-500">Estimated Rewards</div>
                <div className="text-3xl font-extrabold text-green-600">{money(top.dollars)}</div>
                <div className="text-xs text-slate-400">
                  Base: {money(top.baseValue)} · Bonus: {money(top.bonusValue)}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Wallet + Inputs (moved): Inputs moved above, Wallet moved below offers */}
        {/* Removed grid wrapper here */}

            {/* Smart Merchant Search */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Merchant (optional)</label>
              <div className="relative">
                <input
                  type="text"
                  className="w-full rounded-xl border border-slate-300 h-11 px-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
                  placeholder="Search merchants... (try 'coffee', 'clothes', 'burger')"
                  value={merchantSearch}
                  onChange={(e) => {
                    setMerchantSearch(e.target.value);
                    setShowMerchantResults(true);
                    if (!e.target.value) {
                      setMerchantId("");
                    }
                  }}
                  onFocus={() => setShowMerchantResults(true)}
                />
                
                {/* Search Results Dropdown */}
                {showMerchantResults && merchantSearch && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-64 overflow-y-auto">
                    {searchResults.length > 0 ? (
                      searchResults.map((merchant) => (
                        <button
                          key={merchant.id || "none"}
                          className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b last:border-0 focus:outline-none focus:bg-blue-50"
                          onClick={() => selectMerchant(merchant)}
                        >
                          <div className="font-medium">{merchant.label}</div>
                          {merchant.matchReason && (
                            <div className="text-xs text-slate-500">{merchant.matchReason}</div>
                          )}
                          {merchant.category && (
                            <div className="text-xs text-blue-600">
                              → {CATEGORIES.find(c => c.id === merchant.category)?.label || merchant.category}
                            </div>
                          )}
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-2 text-sm text-slate-500">No merchants found</div>
                    )}
                  </div>
                )}
                
                {/* Click outside to close */}
                {showMerchantResults && (
                  <div 
                    className="fixed inset-0 z-5" 
                    onClick={() => setShowMerchantResults(false)}
                  />
                )}
              </div>
              
              {merchantId && (
                <p className="text-xs text-slate-500">
                  Category is locked to{" "}
                  <span className="font-medium">
                    {CATEGORIES.find((c) => c.id === categoryUsed)?.label || categoryUsed || "—"}
                  </span>{" "}
                  for this merchant.
                </p>
              )}
            </div>

            {/* Category (auto-locked if merchant selected) */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Category</label>
              <select
                  className="w-full rounded-xl border border-slate-300 h-11 px-3 text-base disabled:bg-slate-100 disabled:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
                value={categoryIdSafe(category, merchantId, categoryUsed)}
                onChange={(e) => setCategory(e.target.value)}
                disabled={!!merchantId}
              >
                {CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Amount */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Amount</label>
              <input
                  className="w-full rounded-xl border border-slate-300 h-11 px-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
                type="number"
                min={0}
                step={0.01}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>

            {/* BoA CCP chosen category (only if owned) */}
            {ownedIds.includes("boa_ccp") && (
              <div className="space-y-2">
                <label className="text-sm font-medium">BoA Customized Cash — choose your 3% category</label>
                <select
                    className="w-full rounded-xl border border-slate-300 h-11 px-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
                  value={boaCcpChoice}
                  onChange={(e) => setBoaCcpChoice(e.target.value)}
                >
                  {BOA_CCP_CHOICES.map((opt) => (
                    <option key={opt.id} value={opt.id}>{opt.label}</option>
                  ))}
                </select>
                <p className="text-xs text-slate-500">
                  Only one 3% category can be active at a time.
                </p>
              </div>
            )}

{/* Citi Custom Cash chosen category (only if owned) */}
{ownedIds.includes("citi_custom_cash") && (
  <div className="space-y-2">
    <label className="text-sm font-medium">Citi Custom Cash — choose your 5% category</label>
    <select
      className="w-full rounded-xl border border-slate-300 p-2"
      value={citiCustomChoice}
      onChange={(e) => setCitiCustomChoice(e.target.value)}
    >
      {CITI_CUSTOM_CASH_CHOICES.map((opt) => (
        <option key={opt.id} value={opt.id}>{opt.label}</option>
      ))}
    </select>
    <p className="text-xs text-slate-500">
      5% back up to $500 in purchases per billing cycle in your chosen category.
    </p>
  </div>
)}

            {/* Discover rotating controls (only if owned) */}
            {ownedIds.includes("discover_it") && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Discover it — 5% rotating (this quarter)</label>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="inline-flex items-center gap-2 text-sm sm:text-base">
                    <input
                      type="checkbox"
                      className="h-5 w-5"
                      checked={discoverActivated}
                      onChange={e => setDiscoverActivated(e.target.checked)}
                    />
                    Activated
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-sm">Cap remaining</span>
                    <input
                        className="w-28 rounded-xl border border-slate-300 h-11 px-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
                      type="number"
                      min={0}
                      step={1}
                      value={discoverCapRemaining}
                      onChange={e => setDiscoverCapRemaining(e.target.value)}
                    />
                    <span className="text-sm">$</span>
                  </div>
                </div>
                <p className="text-xs text-slate-500">
                  5% applies up to $1,500 per quarter after activation; the rest earns 1%.
                </p>
              </div>
            )}

            {/* Merchant offers list (shows when a merchant is selected) */}
            {merchantId && (
              <div className="space-y-2">
                <div className="text-sm font-medium">Offers for this merchant</div>
                <div className="rounded-xl border border-slate-200 bg-white/70 p-3">
                  {offers
                    .filter(o => o.merchant_id === merchantId)
                    .map(o => {
                      const requires = !!o.enrollment_required;
                      const enrolled = enrolledOfferIds.includes(o.id);
                      return (
                        <div key={o.id} className="flex items-start justify-between gap-3 py-2 border-b last:border-0">
                          <div>
                            <div className="text-sm font-medium">{o.title}</div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                              {requires && (
                                <span className={`inline-flex items-center rounded-full px-2 py-0.5 ring-1 ${enrolled ? "bg-green-50 text-green-700 ring-green-200" : "bg-amber-50 text-amber-700 ring-amber-200"}`}>
                                  {enrolled ? "Enrolled" : "Enrollment required"}
                                </span>
                              )}
                              {o.min_spend_cents ? <span className="text-slate-500">Min spend ${(o.min_spend_cents/100).toFixed(0)}</span> : null}
                              {o.end_at ? <span className="text-slate-500">Ends {o.end_at.slice(0,10)}</span> : null}
                            </div>
                          </div>
                          {requires && (
                            <label className="inline-flex items-center gap-2 text-xs">
                              <input
                                type="checkbox"
                                checked={enrolled}
                                onChange={e => toggleEnrollment(o.id, e.target.checked)}
                              />
                              I've enrolled
                            </label>
                          )}
                        </div>
                      );
                    })}
                  {offers.filter(o => o.merchant_id === merchantId).length === 0 && (
                    <div className="text-sm text-slate-500">No coded offers for this merchant.</div>
                  )}
                </div>
                <p className="text-xs text-slate-500">
                  Some issuer offers are targeted and require activation in your card app. Mark "I've enrolled" for ones you've activated so the math includes them.
                </p>
              </div>
            )}
          </section>
        </div>

{/* ============================================================
    OFFERS BROWSER — Scrollable, sorted by category
============================================================ */}
<section className="bg-white/90 backdrop-blur rounded-2xl shadow-lg ring-1 ring-black/5 p-4 sm:p-5 md:p-6 space-y-4">
  <div className="flex items-center justify-between gap-3">
    <h2 className="text-lg sm:text-xl font-semibold">Browse Offers by Category</h2>
    <div className="text-xs text-slate-500">Only showing offers you’re eligible for based on your wallet</div>
  </div>

  {/* Category tabs (h-scroll) */}
  <div className="relative -mx-2 px-2 overflow-x-auto scroll-pt-2 snap-x snap-mandatory touch-pan-x">
    <div className="flex items-center gap-2 pb-2 min-w-max">
      {CATEGORIES.map((c) => {
        const has = offersGrouped.has(c.id);
        // dim tabs that currently have zero offers
        const active = offerTab === c.id;
        const cls = [
          "whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition",
          active ? "bg-blue-600 text-white border-blue-600" : "border-slate-300",
          has ? "opacity-100" : "opacity-40"
        ].join(" ");
        return (
          <button
            key={c.id}
            className={cls}
            onClick={() => setOfferTab(c.id)}
            title={CAT_LABEL[c.id] || c.id}
          >
            {CAT_LABEL[c.id] || c.id}
            {offersGrouped.get(c.id)?.length ? (
              <span className={`ml-2 rounded-full ${active ? "bg-white/20" : "bg-slate-100"} px-1.5`}>
                {offersGrouped.get(c.id).length}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  </div>

  {/* Offers carousel for selected tab */}
  <div className="relative -mx-2 px-2 overflow-x-auto scroll-pt-2 snap-x snap-mandatory touch-pan-x">
    <div className="flex gap-4 pb-2">
      {(offersGrouped.get(offerTab) || []).map((o) => {
        const requires = !!o.enrollment_required;
        const enrolled = enrolledOfferIds.includes(o.id);
        const canEnrollHere = requires && enrolledOfferIds;
        const ends = o.end_at ? o.end_at.slice(0,10) : null;
        const minSpend = typeof o.min_spend_cents === "number" ? (o.min_spend_cents/100).toFixed(0) : null;

        return (
          <div
            key={o.id}
            className="min-w-[280px] max-w-xs rounded-2xl border border-slate-200 bg-white shadow-sm p-4 flex flex-col justify-between"
          >
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">
                {o.issuer} • {o.card_scope?.length ? `${o.card_scope.length} card${o.card_scope.length>1?"s":""}` : "Any eligible"}
              </div>
              <div className="font-medium leading-snug">{o.title}</div>
              <div className="mt-2 text-xs text-slate-600 space-y-1">
                {o.merchant_id ? (
                  <div>
                    Merchant: <span className="font-medium">{prettyMerchantLabel(o.merchant_id)}</span>
                  </div>
                ) : null}
                {minSpend ? <div>Min spend: ${minSpend}</div> : null}
                {ends ? <div>Ends: {ends}</div> : <div>Ends: —</div>}
                {Array.isArray(o.categories) && o.categories.length ? (
                  <div>Category: {o.categories.map((c) => CAT_LABEL[c] || c).join(", ")}</div>
                ) : null}
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between">
              {requires ? (
                <label className="inline-flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={enrolled}
                    onChange={(e) => toggleEnrollment(o.id, e.target.checked)}
                  />
                  {enrolled ? "Enrolled" : "Enrollment required"}
                </label>
              ) : (
                <span className="text-xs text-green-600">Auto-applies</span>
              )}

              {o.merchant_id && (
                <button
                  className="text-xs rounded-lg border border-slate-300 px-2 py-1 hover:bg-slate-50"
                  onClick={() => {
                    // Quick-jump: set the merchant so category locks and the recs update
                    setMerchantId(o.merchant_id);
                  }}
                >
                  Jump to merchant
                </button>
              )}
            </div>
          </div>
        );
      })}

      {/* Empty state if no offers in this tab */}
      {!(offersGrouped.get(offerTab) || []).length && (
        <div className="text-sm text-slate-500 p-4">
          No live offers in <span className="font-medium">{CAT_LABEL[offerTab] || offerTab}</span> for your current wallet.
        </div>
      )}
    </div>
    {top && (
  <div className="md:hidden fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur px-4 py-3">
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm text-slate-500">Recommended</div>
        <div className="truncate font-semibold">{top.card.name}</div>
        <div className="text-xs text-slate-500">Est. {money(top.dollars)}</div>
      </div>
      <button
        className="shrink-0 rounded-xl bg-blue-600 text-white px-4 py-2 text-sm font-semibold active:scale-[.99]"
        onClick={() => {/* hook up your log/track action here if desired */}}
      >
        Use this card
      </button>
    </div>
  </div>
)}

  </div>
</section>

        {/* Wallet */}
        <WalletSection 
          ownedIds={ownedIds}
          setOwnedIds={setOwnedIds}
          cardsCatalog={cardsCatalog}
        />

        {/* All options - COMMENTED OUT FOR NOW */}
{/* 
<section className="bg-white/90 backdrop-blur rounded-2xl shadow-lg ring-1 ring-black/5 p-4 sm:p-5 md:p-6">
  <h2 className="text-lg sm:text-xl font-semibold mb-4">All Cards (sorted)</h2>
  <div className="overflow-x-auto">
    <table className="min-w-full text-sm">
      <thead>
        <tr className="text-left border-b bg-slate-50">
          <th className="py-2 px-3">Card</th>
          <th className="py-2 px-3">Base</th>
          <th className="py-2 px-3">Bonus</th>
          <th className="py-2 px-3">Total</th>
          <th className="py-2 px-3">Notes</th>
        </tr>
      </thead>
      <tbody>
        {recommendations.map((r) => (
          <tr key={r.card.id} className="border-b last:border-0 hover:bg-slate-50 even:bg-slate-50">
            <td className="py-2 px-3 font-medium">{r.card.name}</td>
            <td className="py-2 px-3">{money(r.baseValue)}</td>
            <td className="py-2 px-3">{money(r.bonusValue)}</td>
            <td className="py-2 px-3 font-semibold">{money(r.dollars)}</td>
            <td className="py-2 px-3 text-xs text-slate-500">
              {r.notes?.length ? r.notes.join(" • ") : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
  {merchantId && (
    <p className="mt-2 text-xs text-slate-500">
      Some issuer offers may be targeted/enrollment required—always check your card app.
    </p>
  )}
</section>
*/}
      {currentView === "strategy" && (
        <MyStrategy 
          ownedIds={ownedIds}
          cardsCatalog={cardsCatalog}
          boaCcpChoice={boaCcpChoice}
          citiCustomChoice={citiCustomChoice}
        />
      )}

      {currentView === "offers" && (
        <div className="bg-white/90 backdrop-blur rounded-2xl shadow-lg ring-1 ring-black/5 p-6 text-center">
          <h2 className="text-2xl font-bold text-slate-900 mb-4">Offers Coming Soon</h2>
          <p className="text-slate-600">We're working on bringing you the best credit card offers!</p>
        </div>
      )}
      </div>
    </div>
  );
}

/* ---------- components ---------- */

function RecommendationNotes({ top, cards }) {
  const full = cards.find((c) => c.id === top.card.id);
  const staticNotes = full?.notes || [];
  const bonusNotes = top.notes || [];

  if (!staticNotes.length && !bonusNotes.length) return null;

  return (
    <div className="mt-4 space-y-2">
      {staticNotes.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Card perks</div>
          <div className="flex flex-wrap gap-2">
            {staticNotes.map((n, i) => (
              <span key={`static-${i}`} className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
                {n}
              </span>
            ))}
          </div>
        </div>
      )}
      {bonusNotes.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">This purchase bonuses</div>
          <div className="flex flex-wrap gap-2">
            {bonusNotes.map((n, i) => (
              <span key={`bonus-${i}`} className="inline-flex items-center rounded-full bg-blue-100 px-3 py-1 text-xs text-blue-700">
                {n}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
