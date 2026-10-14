// Product metrics constants (PCRM-177). Like the rest of businessRules, they
// change several figures at once and belong in the technical manual
// (CLAUDE.md 5.8); none of them lives in the database.

/** Windows of "no movement", in days, counted back from the end of the range. */
export const NO_MOVEMENT_WINDOWS_DAYS = [30, 60, 90] as const;
