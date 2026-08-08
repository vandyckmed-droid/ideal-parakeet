// The peer-family taxonomy: FMP's fine-grained industry labels consolidated
// into 38 groups large enough to mean something.
//
// How it was derived (2026-08-08, two years of daily data): each industry's
// equal-weight return series was regressed on SPY and the residuals - what
// the market does not explain - were correlated pairwise. Industries were
// merged when the residual correlation was high AND the businesses are
// actually related; high correlation alone was not enough, because defensive
// styles mimic kinship (Waste Management <-> Insurance at 0.54, Tobacco <->
// Regulated Electric at 0.48 - both vetoed). Orphan industries below five
// members were adopted into the family they demonstrably trade with, or
// combined into new families where they trade with each other (Housing at
// 0.71, Electrical & Construction at 0.62-0.69).
//
// Industries not mapped here stay outside the family system on purpose:
// either no family wanted them (autos, railroads, airlines, tobacco, waste)
// or the correlation was a style artifact. Do not add a mapping without both
// the number and the economic argument.

const FAMILY_OF = new Map([
  // --- merged same-business groups -----------------------------------------
  ['Banks - Diversified', 'Banks'],
  ['Banks - Regional', 'Banks'],

  ['Insurance - Property & Casualty', 'Insurance'],
  ['Insurance - Brokers', 'Insurance'],
  ['Insurance - Diversified', 'Insurance'],
  ['Insurance - Life', 'Insurance'],
  ['Insurance - Reinsurance', 'Insurance'],
  ['Insurance - Specialty', 'Insurance'],

  ['REIT - Retail', 'REITs'],
  ['REIT - Residential', 'REITs'],
  ['REIT - Industrial', 'REITs'],
  ['REIT - Healthcare Facilities', 'REITs'],
  ['REIT - Office', 'REITs'],
  ['REIT - Diversified', 'REITs'],

  ['Communication Equipment', 'Communications Hardware'],
  ['Hardware, Equipment & Parts', 'Communications Hardware'],

  ['Oil & Gas Exploration & Production', 'Oil & Gas'],
  ['Oil & Gas Integrated', 'Oil & Gas'],
  ['Oil & Gas Equipment & Services', 'Oil & Gas'],
  ['Oil & Gas Midstream', 'Oil & Gas'],
  ['Oil & Gas Refining & Marketing', 'Oil & Gas'],

  ['Regulated Electric', 'Regulated Utilities'],
  ['Regulated Gas', 'Regulated Utilities'],
  ['Regulated Water', 'Regulated Utilities'],

  ['Industrial - Machinery', 'Machinery'],
  ['Manufacturing - Tools & Accessories', 'Machinery'],
  ['Agricultural - Machinery', 'Machinery'],
  ['Industrial - Distribution', 'Machinery'],

  ['Packaged Foods', 'Food & Beverage'],
  ['Food Confectioners', 'Food & Beverage'],
  ['Beverages - Non-Alcoholic', 'Food & Beverage'],
  ['Beverages - Alcoholic', 'Food & Beverage'],

  ['Information Technology Services', 'IT Services'],
  ['Staffing & Employment Services', 'IT Services'],
  ['Consulting Services', 'IT Services'],

  ['Chemicals - Specialty', 'Chemicals'],
  ['Chemicals', 'Chemicals'],

  ['Integrated Freight & Logistics', 'Freight & Logistics'],
  ['Trucking', 'Freight & Logistics'],

  ['Packaging & Containers', 'Packaging & Containers'],
  ['Paper, Lumber & Forest Products', 'Packaging & Containers'],

  ['Financial - Capital Markets', 'Capital Markets'],
  ['Investment - Banking & Investment Services', 'Capital Markets'],

  // --- new families found in the orphan-vs-orphan pass ----------------------
  ['Residential Construction', 'Housing'],
  ['Home Improvement', 'Housing'],

  ['Electrical Equipment & Parts', 'Electrical & Construction'],
  ['Engineering & Construction', 'Electrical & Construction'],
  ['Renewable Utilities', 'Electrical & Construction'],

  // --- industries that already are a family (>=5 members on their own) ------
  ['Semiconductors', 'Semiconductors'],
  ['Software - Infrastructure', 'Software - Infrastructure'],
  ['Software - Application', 'Software - Application'],
  ['Aerospace & Defense', 'Aerospace & Defense'],
  ['Asset Management', 'Asset Management'],
  ['Medical - Diagnostics & Research', 'Medical Diagnostics'],
  ['Specialty Retail', 'Specialty Retail'],
  ['Drug Manufacturers - General', 'Drug Manufacturers'],
  ['Medical - Devices', 'Medical Devices'],
  ['Computer Hardware', 'Computer Hardware'],
  ['Financial - Data & Stock Exchanges', 'Exchanges & Data'],
  ['Entertainment', 'Entertainment'],
  ['Financial - Credit Services', 'Credit Services'],
  ['Household & Personal Products', 'Household Products'],
  ['REIT - Specialty', 'REIT - Specialty'],
  ['Medical - Healthcare Plans', 'Healthcare Plans'],
  ['Telecommunications Services', 'Telecom'],
  ['Restaurants', 'Restaurants'],
  ['Travel Services', 'Travel Services'],
  ['Medical - Instruments & Supplies', 'Medical Instruments'],
  ['Construction Materials', 'Construction Materials'],
  ['Discount Stores', 'Discount Stores'],
  ['Biotechnology', 'Biotechnology'],
]);

/** Family for an FMP industry label, or null when the industry is unmapped. */
export function familyForIndustry(industry) {
  return FAMILY_OF.get(industry) ?? null;
}

/** Every family name, deterministic order. */
export function allFamilies() {
  return [...new Set(FAMILY_OF.values())];
}
