// src/lib/ranker.js

// --- defaults for points valuations (cents per point) ---
const CPP_DEFAULTS = {
  UR: 1.25,   // Chase Ultimate Rewards (portal / blended)
  MR: 1.0,    // Amex Membership Rewards (conservative)
  Cap1: 1.0,  // Capital One miles
  TYP: 1.0    // Citi ThankYou (if you use it)
};

// --- utils ---
function clampNum(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function money(n) { return `$${n.toFixed(2)}`; }
function toISOEndOfDay(dateStr) { return `${dateStr}T23:59:59Z`; }
function toISOStartOfDay(dateStr) { return `${dateStr}T00:00:00Z`; }
function isWithin(nowISO, startISO, endISO) {
  if (startISO && nowISO < startISO) return false;
  if (endISO && nowISO > endISO) return false;
  return true;
}

// --- rotating helpers (for cards like Discover it) ---
function activeRotatingWindow(card, categoryId, nowISO, userRotating = {}) {
  const rules = card.rotating_rules;
  if (!Array.isArray(rules) || rules.length === 0) return null;

  for (const r of rules) {
    const start = r.start ? toISOStartOfDay(r.start) : null;
    const end = r.end ? toISOEndOfDay(r.end) : null;
    if (!isWithin(nowISO, start, end)) continue;
    if (!Array.isArray(r.category_ids) || !r.category_ids.includes(categoryId)) continue;

    // user state for this card (activation + remaining cap)
    const u = userRotating[card.id] || {};
    const needsActivation = !!r.activation_required;
    const activated = needsActivation ? !!u.activated : true;

    const capCents = Number.isFinite(r.cap_cents) ? Math.max(0, r.cap_cents) : 0;
    const remainingCapCents = Math.max(0, Number.isFinite(u.remainingCapCents) ? u.remainingCapCents : capCents);

    return {
      active: activated,
      reason: activated ? null : "Activation required",
      boostRatePercent: Number(r.rate) || 0,        // e.g., 5 (%)
      afterRatePercent: Number.isFinite(r.after_rate) ? Number(r.after_rate) : null, // e.g., 1 (%)
      remainingCapCents
    };
  }

  return null;
}

function applyCapSplitPercent({ amountCents, boostPercent, basePercent, remainingCapCents }) {
  const boostCents = Math.min(amountCents, Math.max(0, remainingCapCents));
  const baseCents  = amountCents - boostCents;
  const boostVal   = (boostCents / 100) * (boostPercent / 100);
  const baseVal    = (baseCents  / 100) * (basePercent  / 100);
  return { boostVal, baseVal, boostCents, baseCents };
}

// --- offer helpers ---
export function offerAppliesToCard(off, card) {
  if (!off || !card) return false;
  if (off.card_scope === "all") return true;
  if (Array.isArray(off.card_scope)) return off.card_scope.includes(card.id);
  return false;
}

function offerMatchesCategory(off, categoryId) {
  if (!off) return false;
  if (!off.categories || off.categories.length === 0) return true; // merchant-specific, no category filter
  return off.categories.includes(categoryId);
}

function offerActiveNow(off, nowISO) {
  const startISO = off.start_at || null;
  const endISO = off.end_at || null;
  return isWithin(nowISO, startISO, endISO);
}

// --- core value calculator ---
export function valueFor(
  card,
  {
    amountCents,
    categoryId,
    programOverrides = {},
    nowISO = new Date().toISOString(),
    userRotating = {},
    userEnrolledOfferIds = new Set()
  },
  offersForCard = []
) {
  const amount = amountCents / 100;
  const cpp =
    programOverrides[card.program] ??
    (Number.isFinite(card.cpp_default) ? card.cpp_default : undefined) ??
    CPP_DEFAULTS[card.program] ??
    1.0;

  const type = card.type || "points"; // "cashback" | "points" | "miles" (treat miles like points)
  const cats = card.categories || {};
  const staticMult = Number.isFinite(cats[categoryId]) ? Number(cats[categoryId]) : Number(card.base) || 1;

  let baseValue = 0;   // $ from base earn (includes post-cap residual for rotating)
  let bonusValue = 0;  // $ from boosted portions + offers
  const notes = [];

  // 1) Base earnings (with rotating override if applicable)
  if (type === "cashback") {
    // Check for rotating window (e.g., Discover it)
    const win = activeRotatingWindow(card, categoryId, nowISO, userRotating);

    if (win && win.active) {
      const boostPercent = win.boostRatePercent; // e.g., 5
      const afterPercent = win.afterRatePercent != null ? win.afterRatePercent : staticMult;

      const { boostVal, baseVal, boostCents } = applyCapSplitPercent({
        amountCents,
        boostPercent,
        basePercent: afterPercent,
        remainingCapCents: win.remainingCapCents
      });

      baseValue += baseVal;
      bonusValue += boostVal;
      notes.push(`Rotating ${boostPercent}% applied to ${money(boostCents/100)} (cap remaining)`);
    } else {
      // either no window or not activated → plain static
      const pct = staticMult; // e.g., 3%
      baseValue += amount * (pct / 100);
      if (win && !win.active) notes.push("Activation required for rotating bonus");
    }
  } else {
    // points / miles
    const mult = staticMult;              // e.g., 3x
    baseValue += amount * mult * (cpp / 100);
  }

  // 2) Offers stacking
  for (const off of offersForCard) {
    if (!offerActiveNow(off, nowISO)) continue;
    if (!offerAppliesToCard(off, card)) continue;
    if (!offerMatchesCategory(off, categoryId)) continue;

    // Enrollment gate
    if (off.enrollment_required && !userEnrolledOfferIds.has(off.id)) {
      if (!notes.includes("Offer requires enrollment")) {
        notes.push("Offer requires enrollment");
      }
      continue;
    }

    if (off.offer_type === "statement_credit") {
      const min = Number(off.min_spend_cents) || 0;
      if (amountCents >= min) {
        if (off.value?.fixed_amount) {
          bonusValue += (off.value.fixed_amount / 100);
          notes.push(`${money(off.value.fixed_amount/100)} statement credit`);
        } else if (off.value?.percent) {
          const p = Number(off.value.percent) || 0;
          let offerValue = amount * (p / 100);
          
          // Apply cap if present - check both possible field names
          const maxBackCents = off.value.max_back_cents || off.value.max_amount_cents;
          if (maxBackCents && Number.isFinite(maxBackCents)) {
            const maxBackDollars = maxBackCents / 100;
            offerValue = Math.min(offerValue, maxBackDollars);
            notes.push(`${p}% back (capped at ${money(maxBackDollars)})`);
          } else {
            notes.push(`${p}% back`);
          }
          
          bonusValue += offerValue;
        }
      }
    } else if (off.offer_type === "percent_back") {
      const p = Number(off.value?.percent) || 0;
      let offerValue = amount * (p / 100);
      
      // Apply cap if present - check both possible field names  
      const maxBackCents = off.value?.max_back_cents || off.value?.max_amount_cents;
      if (maxBackCents && Number.isFinite(maxBackCents)) {
        const maxBackDollars = maxBackCents / 100;
        offerValue = Math.min(offerValue, maxBackDollars);
        notes.push(`${p}% back (capped at ${money(maxBackDollars)})`);
      } else {
        notes.push(`${p}% back`);
      }
      
      bonusValue += offerValue;
    } else if (off.offer_type === "points_multiplier") {
      const extraX = Number(off.value?.points_multiplier) || 0;
      if (type === "cashback") {
        // fallback interpretation: treat "+Nx" as +N%
        bonusValue += amount * (extraX / 100);
      } else {
        bonusValue += amount * extraX * (cpp / 100);
      }
      notes.push(`+${extraX}x points`);
    }
  }

  return {
    dollars: baseValue + bonusValue,
    baseValue,
    bonusValue,
    notes
  };
}

// --- public API ---
// cards: array of card objects (already filtered to user-owned in the caller)
// params: { amountCents, categoryId, programOverrides, nowISO, userRotating, userEnrolledOfferIds }
// offersByCard: { [cardId]: Offer[] }
export function rankCards(cards, params, offersByCard = {}) {
  const results = [];
  for (const card of cards) {
    const offers = offersByCard[card.id] || [];
    const v = valueFor(card, params, offers);
    results.push({ card, ...v });
  }
  // sort by total dollar value desc, then by bonus portion desc
  results.sort((a, b) => {
    if (b.dollars !== a.dollars) return b.dollars - a.dollars;
    return b.bonusValue - a.bonusValue;
  });
  return results;
}