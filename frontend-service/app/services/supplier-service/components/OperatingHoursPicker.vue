<!-- AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-09-30.
Scope: Operating hours input for the add-supplier form, with preset schedules and a
day-by-day custom editor. Author review: Pending.
Claude Code (Opus 5.5), 2026-10-01. Scope: Starting from existing hours in the edit form.
Author review: Pending. -->
<script setup lang="ts">
import type { OperatingPeriod } from "#shared/services/supplier-service/types";

interface DayRow {
  open: boolean;
  allDay: boolean;
  periods: { openingHrs: string; closingHrs: string }[];
}

// idPrefix keeps ids unique between forms. preselect starts from the model's current
// hours (the matching preset, or custom) instead of an empty selection.
const props = defineProps<{ idPrefix: string; preselect?: boolean }>();
const model = defineModel<OperatingPeriod[]>({ required: true });

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
// Days are stored with 0 as Sunday, but listed from Monday.
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [1, 2, 3, 4, 5];

function on(days: number[], openingHrs: string, closingHrs: string): OperatingPeriod[] {
  return days.map(day => ({ day, openingHrs, closingHrs }));
}

const presets = [
  { id: "always", label: "Open 24/7", periods: on(EVERY_DAY, "00:00", "24:00") },
  { id: "daily-9-5", label: "Every day, 9am – 5pm", periods: on(EVERY_DAY, "09:00", "17:00") },
  { id: "weekdays-9-5", label: "Monday – Friday, 9am – 5pm", periods: on(WEEKDAYS, "09:00", "17:00") },
  { id: "daily-8-10", label: "Every day, 8am – 10pm", periods: on(EVERY_DAY, "08:00", "22:00") },
  { id: "none", label: "No hours yet (shows as closed)", periods: [] },
];

function key(periods: OperatingPeriod[]): string {
  return periods.map(period => `${period.day} ${period.openingHrs}-${period.closingHrs}`).sort().join();
}

const initial = props.preselect ? model.value : [];
const selected = ref(props.preselect ? presets.find(preset => key(preset.periods) === key(initial))?.id ?? "custom" : "");
const days = ref<DayRow[]>(toRows(initial));

function toRows(periods: OperatingPeriod[]): DayRow[] {
  return EVERY_DAY.map((day) => {
    const own = periods.filter(period => period.day === day);
    const allDay = own.length === 1 && own[0]!.openingHrs === "00:00" && own[0]!.closingHrs === "24:00";
    return {
      open: own.length > 0,
      allDay,
      periods: allDay || own.length === 0
        ? [{ openingHrs: "09:00", closingHrs: "17:00" }]
        // A time input cannot show 24:00; closing at 00:00 also ends the day at midnight.
        : own.map(({ openingHrs, closingHrs }) => ({ openingHrs, closingHrs: closingHrs === "24:00" ? "00:00" : closingHrs })),
    };
  });
}

function fromRows(rows: DayRow[]): OperatingPeriod[] {
  return rows.flatMap((row, day) => {
    if (!row.open) return [];
    if (row.allDay) return [{ day, openingHrs: "00:00", closingHrs: "24:00" }];
    return row.periods.map(period => ({ day, ...period }));
  });
}

// Custom starts from the previously chosen preset, so it can be tweaked.
watch(selected, (id, previous) => {
  const preset = presets.find(preset => preset.id === previous);
  if (id === "custom" && preset) days.value = toRows(preset.periods);
});

watchEffect(() => {
  model.value = selected.value === "custom"
    ? fromRows(days.value)
    : presets.find(preset => preset.id === selected.value)?.periods ?? [];
});

function addPeriod(row: DayRow) {
  const last = row.periods.at(-1);
  row.periods.push({ openingHrs: last?.closingHrs ?? "09:00", closingHrs: "" });
}

function copyToAll(source: DayRow) {
  days.value = days.value.map(() => ({ open: source.open, allDay: source.allDay, periods: source.periods.map(period => ({ ...period })) }));
}

const input = "w-full rounded-lg border border-[#cfd5da] bg-white px-3 py-2 text-sm text-[#25313c] focus:border-[#064784] focus:outline-none focus:ring-2 focus:ring-[#064784]/20";
const time = "rounded-lg border border-[#cfd5da] bg-white px-2 py-1 text-sm text-[#25313c] focus:border-[#064784] focus:outline-none focus:ring-2 focus:ring-[#064784]/20";
const link = "text-xs font-medium text-[#064784] hover:underline";
</script>

<template>
  <div>
    <label :for="`${idPrefix}-hours`" class="mb-1 block text-xs font-medium text-[#5b6570]">Operating hours</label>
    <select :id="`${idPrefix}-hours`" v-model="selected" required :class="input">
      <option value="" disabled>Select operating hours</option>
      <option v-for="preset in presets" :key="preset.id" :value="preset.id">{{ preset.label }}</option>
      <option value="custom">Custom (set each day)</option>
    </select>

    <fieldset v-if="selected === 'custom'" class="mt-3 rounded-lg border border-[#e3e7eb]">
      <legend class="sr-only">Custom operating hours</legend>
      <div v-for="day in DISPLAY_ORDER" :key="day" class="border-b border-[#e3e7eb] px-3 py-2 last:border-b-0">
        <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
          <label class="flex w-28 items-center gap-2 text-sm font-medium">
            <input v-model="days[day]!.open" type="checkbox" class="accent-[#064784]">
            {{ DAY_NAMES[day] }}
          </label>
          <template v-if="days[day]!.open">
            <label class="flex items-center gap-2 text-xs text-[#5b6570]">
              <input v-model="days[day]!.allDay" type="checkbox" class="accent-[#064784]">
              24 hours
            </label>
            <button type="button" :class="[link, 'ml-auto']" @click="copyToAll(days[day]!)">Copy to all days</button>
          </template>
          <span v-else class="text-xs text-[#5b6570]">Closed</span>
        </div>

        <div v-if="days[day]!.open && !days[day]!.allDay" class="mt-2 space-y-2 sm:pl-8">
          <div v-for="(period, index) in days[day]!.periods" :key="index" class="flex flex-wrap items-center gap-2">
            <label :for="`${idPrefix}-hours-${day}-${index}-open`" class="sr-only">{{ DAY_NAMES[day] }} opening time {{ index + 1 }}</label>
            <input :id="`${idPrefix}-hours-${day}-${index}-open`" v-model="period.openingHrs" type="time" required :class="time">
            <span class="text-xs text-[#5b6570]">to</span>
            <label :for="`${idPrefix}-hours-${day}-${index}-close`" class="sr-only">{{ DAY_NAMES[day] }} closing time {{ index + 1 }}</label>
            <input :id="`${idPrefix}-hours-${day}-${index}-close`" v-model="period.closingHrs" type="time" required :class="time">
            <span v-if="period.closingHrs && period.closingHrs <= period.openingHrs" class="text-xs text-[#5b6570]">(next day)</span>
            <button
              v-if="days[day]!.periods.length > 1"
              type="button"
              class="text-xs font-medium text-red-700 hover:underline"
              @click="days[day]!.periods.splice(index, 1)"
            >
              Remove
            </button>
          </div>
          <button type="button" :class="link" @click="addPeriod(days[day]!)">+ Add hours</button>
        </div>
      </div>
    </fieldset>
    <p v-if="selected === 'custom'" class="mt-1 text-xs text-[#5b6570]">
      A closing time at or before the opening time runs past midnight into the next day.
    </p>
  </div>
</template>
