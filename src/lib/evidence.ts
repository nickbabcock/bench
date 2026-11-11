/**
 * One evidence rule for every benchmark: with fewer than this many samples
 * a difference can't be told from noise, so nothing is ranked, crowned or
 * called faster or slower anywhere (headlines, positions, readouts,
 * history, chart notes and exports).
 */
const MIN_SAMPLES_FOR_CLAIMS = 2;

export const isExploratory = (samples: number) => samples < MIN_SAMPLES_FOR_CLAIMS;
