import type { VehicleClass, VehicleDefinition } from './vehicles.ts';

/** Racing classes and the catalogue family each belongs to (masterplan §10.1,
 * CONTENT_PIPELINE.md §1.4). A class decides event eligibility (rulesets list
 * classes); a family groups classes for presentation and for the procedural
 * body generator. Unknown classes (added by another vehicle programme) fall
 * back to a generic entry instead of failing. */
export type VehicleFamily =
  | 'formula'
  | 'historic'
  | 'prototype'
  | 'gt'
  | 'touring'
  | 'club'
  | 'rally'
  | 'rallycross'
  | 'offroad'
  | 'kart'
  | 'road'
  | 'motorcycle'
  | 'other';
export interface VehicleClassInfo {
  name: string;
  family: VehicleFamily;
  /** Menu order (lower first). */
  order: number;
  /** Ruleset a single-class race of this class runs under by default. */
  raceRuleset?: string;
}
export const VEHICLE_CLASSES: Readonly<Partial<Record<VehicleClass, VehicleClassInfo>>> =
  Object.freeze({
    formula: { name: 'Formula', family: 'formula', order: 0, raceRuleset: 'formula-grand-prix' },
    'formula-junior': {
      name: 'Junior formula',
      family: 'formula',
      order: 1,
      raceRuleset: 'junior-formula-sprint',
    },
    historic: {
      name: 'Historic formula',
      family: 'historic',
      order: 2,
      raceRuleset: 'historic-formula',
    },
    hypercar: { name: 'Hypercar', family: 'prototype', order: 3, raceRuleset: 'prototype-sprint' },
    prototype: {
      name: 'Prototype',
      family: 'prototype',
      order: 4,
      raceRuleset: 'prototype-sprint',
    },
    gt: { name: 'GT', family: 'gt', order: 5, raceRuleset: 'gt-sprint' },
    'gt-sport': { name: 'GT Sport', family: 'gt', order: 6, raceRuleset: 'gt-sprint' },
    touring: { name: 'Touring', family: 'touring', order: 7, raceRuleset: 'touring-sprint' },
    club: { name: 'Club', family: 'club', order: 8, raceRuleset: 'club-sprint' },
    rally: { name: 'Rally', family: 'rally', order: 9, raceRuleset: 'rallycross-heat' },
    rallycross: {
      name: 'Rallycross',
      family: 'rallycross',
      order: 10,
      raceRuleset: 'rallycross-heat',
    },
    offroad: { name: 'Off-road', family: 'offroad', order: 11, raceRuleset: 'rallycross-heat' },
    kart: { name: 'Kart', family: 'kart', order: 12, raceRuleset: 'kart-sprint' },
    road: { name: 'Road (open-world)', family: 'road', order: 13 },
    'gp-bike': {
      name: 'GP motorcycle',
      family: 'motorcycle',
      order: 14,
      raceRuleset: 'gp-motorcycle',
    },
    superbike: { name: 'Superbike', family: 'motorcycle', order: 15, raceRuleset: 'gp-motorcycle' },
    motocross: {
      name: 'Motocross',
      family: 'motorcycle',
      order: 16,
      raceRuleset: 'motocross-moto',
    },
    supermoto: {
      name: 'Supermoto',
      family: 'motorcycle',
      order: 17,
      raceRuleset: 'supermoto-moto',
    },
  });
const OTHER: VehicleClassInfo = Object.freeze({ name: 'Other', family: 'other', order: 99 });
export function classInfo(classId: string): VehicleClassInfo {
  return (VEHICLE_CLASSES as Record<string, VehicleClassInfo | undefined>)[classId] ?? OTHER;
}
/** Definitions grouped by class in menu order (registry order inside a class). */
export function vehiclesByClass(definitions: readonly VehicleDefinition[]) {
  const groups = new Map<string, VehicleDefinition[]>();
  for (const def of definitions) {
    const list = groups.get(def.classId);
    if (list) list.push(def);
    else groups.set(def.classId, [def]);
  }
  return [...groups.entries()]
    .map(([classId, vehicles]) => ({ classId, info: classInfo(classId), vehicles }))
    .sort((a, b) => a.info.order - b.info.order);
}
