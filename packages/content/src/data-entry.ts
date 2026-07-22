import { SeededRandom } from "./seed.js";
import type { DataEntryCategory, Seed } from "./types.js";

export interface DataEntryItem {
  readonly id: string;
  readonly category: DataEntryCategory;
  readonly text: string;
  readonly accessibilityLabel: string;
  readonly fictional: true;
  readonly sourceId: "symtype-original-practice-v1";
}

export const DATA_ENTRY_CATEGORIES: readonly DataEntryCategory[] = Object.freeze([
  "integer",
  "decimal",
  "percentage",
  "date",
  "time",
  "currency",
  "fictional-phone",
  "table"
]);

export interface GenerateDataEntryOptions {
  readonly seed: Seed;
  readonly count: number;
  readonly categories?: readonly DataEntryCategory[];
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

function formatInteger(random: SeededRandom): string {
  const value = random.integer(0, 999_999);
  const sign = random.chance(0.16) ? "-" : "";
  return `${sign}${value.toLocaleString("en-US", { useGrouping: random.chance(0.55) })}`;
}

function formatDecimal(random: SeededRandom): string {
  const whole = random.integer(0, 9_999);
  const precision = random.integer(1, 3);
  const fraction = pad(random.integer(0, 10 ** precision - 1), precision);
  return `${whole}.${fraction}`;
}

function formatPercentage(random: SeededRandom): string {
  const precision = random.chance(0.45) ? 1 : 0;
  const value = random.integer(0, precision === 0 ? 100 : 1_000) / 10 ** precision;
  return `${value.toFixed(precision)}%`;
}

function formatDate(random: SeededRandom): string {
  const year = random.integer(2031, 2049);
  const month = random.integer(1, 12);
  const day = random.integer(1, 28);
  if (random.chance(0.5)) {
    return `${year}-${pad(month)}-${pad(day)}`;
  }
  return `${pad(month)}/${pad(day)}/${year}`;
}

function formatTime(random: SeededRandom): string {
  const minute = pad(random.integer(0, 59));
  if (random.chance(0.5)) {
    return `${pad(random.integer(0, 23))}:${minute}`;
  }
  return `${random.integer(1, 12)}:${minute} ${random.chance(0.5) ? "AM" : "PM"}`;
}

function formatCurrency(random: SeededRandom): string {
  const dollars = random.integer(0, 4_999);
  const cents = pad(random.integer(0, 99));
  return `$${dollars.toLocaleString("en-US")}.${cents}`;
}

/** The +0 prefix is intentionally invalid, so no generated value can be a real phone number. */
function formatFictionalPhone(random: SeededRandom): string {
  return `TEL-FIC +0 (555) 01${pad(random.integer(0, 99))}-${pad(random.integer(0, 9_999), 4)}`;
}

const TABLE_LABELS = [
  "amber-fruit",
  "blue-crate",
  "calm-leaf",
  "mint-box",
  "peach-note",
  "sun-plum"
] as const;

function formatTableRow(random: SeededRandom): string {
  const label = random.pick(TABLE_LABELS);
  const quantity = pad(random.integer(1, 48));
  const price = `$${random.integer(1, 80)}.${pad(random.integer(0, 99))}`;
  return `${label}\t${quantity}\t${price}`;
}

function generateForCategory(category: DataEntryCategory, random: SeededRandom): string {
  switch (category) {
    case "integer":
      return formatInteger(random);
    case "decimal":
      return formatDecimal(random);
    case "percentage":
      return formatPercentage(random);
    case "date":
      return formatDate(random);
    case "time":
      return formatTime(random);
    case "currency":
      return formatCurrency(random);
    case "fictional-phone":
      return formatFictionalPhone(random);
    case "table":
      return formatTableRow(random);
  }
}

export function generateDataEntryItems(
  options: GenerateDataEntryOptions
): readonly DataEntryItem[] {
  if (!Number.isInteger(options.count) || options.count < 1) {
    throw new RangeError("Data-entry item count must be a positive integer.");
  }
  const categories = options.categories ?? DATA_ENTRY_CATEGORIES;
  if (categories.length === 0) {
    throw new RangeError("At least one data-entry category is required.");
  }
  if (categories.some((category) => !DATA_ENTRY_CATEGORIES.includes(category))) {
    throw new RangeError("An unsupported data-entry category was requested.");
  }

  const random = new SeededRandom(options.seed);
  return Array.from({ length: options.count }, (_unused, index) => {
    const category = categories[index % categories.length] ?? random.pick(categories);
    const text = generateForCategory(category, random);
    return {
      id: `data-${String(index + 1).padStart(3, "0")}`,
      category,
      text,
      accessibilityLabel:
        category === "fictional-phone"
          ? "deliberately invalid fictional telephone-style value"
          : `fictional ${category.replaceAll("-", " ")} value`,
      fictional: true,
      sourceId: "symtype-original-practice-v1"
    };
  });
}
