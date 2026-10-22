/** Cuisines du catalogue (liste extensible), regroupees par grande region. */

/** @typedef {'europe' | 'caribbean' | 'africa' | 'middle_east' | 'asia' | 'americas'} Region */

/** @typedef {{ id: string, label: string, region: Region }} Cuisine */

/** @type {{ id: Region, label: string }[]} */
export const REGIONS = [
  { id: 'asia', label: 'Asie' },
  { id: 'caribbean', label: 'Antilles et Guyane' },
  { id: 'europe', label: 'Europe' },
  { id: 'africa', label: 'Afrique' },
  { id: 'middle_east', label: 'Maghreb et Moyen-Orient' },
  { id: 'americas', label: 'Amériques' },
];

/** @type {Cuisine[]} */
export const CUISINES = [
  { id: 'french', label: 'Française', region: 'europe' },
  { id: 'italian', label: 'Italienne', region: 'europe' },
  { id: 'spanish', label: 'Espagnole', region: 'europe' },
  { id: 'portuguese', label: 'Portugaise', region: 'europe' },
  { id: 'mediterranean', label: 'Grecque et méditerranéenne', region: 'europe' },
  { id: 'caribbean', label: 'Antillaise et caribéenne', region: 'caribbean' },
  { id: 'guianese', label: 'Guyanaise', region: 'caribbean' },
  { id: 'african', label: 'Africaine', region: 'africa' },
  { id: 'maghreb', label: 'Maghrébine', region: 'middle_east' },
  { id: 'middle_eastern', label: 'Moyen-orientale', region: 'middle_east' },
  { id: 'indian', label: 'Indienne', region: 'asia' },
  { id: 'pakistani', label: 'Pakistanaise', region: 'asia' },
  { id: 'thai', label: 'Thaïlandaise', region: 'asia' },
  { id: 'vietnamese', label: 'Vietnamienne', region: 'asia' },
  { id: 'japanese', label: 'Japonaise', region: 'asia' },
  { id: 'korean', label: 'Coréenne', region: 'asia' },
  { id: 'chinese', label: 'Chinoise', region: 'asia' },
  { id: 'indonesian', label: 'Indonésienne et malaisienne', region: 'asia' },
  { id: 'filipino', label: 'Philippine', region: 'asia' },
  { id: 'american', label: 'Américaine', region: 'americas' },
  { id: 'mexican', label: 'Mexicaine', region: 'americas' },
  { id: 'brazilian', label: 'Brésilienne', region: 'americas' },
  { id: 'latin_american', label: 'Latino-américaine', region: 'americas' },
];
