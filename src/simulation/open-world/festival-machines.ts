import { isDirtBike } from '../offroad/dirt-bikes.ts';
import { VEHICLES, type VehicleDefinition } from '../vehicles.ts';

/** Which registry machines the festival admits, and in what order (pure
 * functions over the vehicle registry, so the career, the HUD and the
 * session read the same list without loading the simulation). */

/** Festival order of vehicle classes: road cars, then GT and club cars,
 * then saloon and loose-surface machines, then prototypes and single-seaters
 * (any car class not listed comes next, motorcycles last). */
const FESTIVAL_CLASS_ORDER: readonly (readonly string[])[] = [
  ['road', 'street'],
  ['gt', 'gt-sport', 'club'],
  ['touring', 'rally', 'rallycross', 'offroad'],
  ['hypercar', 'prototype'],
];
/** Classes the festival does not offer: karts have no ground clearance or
 * road-going steering for public roads, kerbs and junction crowns. */
export const FESTIVAL_EXCLUDED_CLASSES: readonly string[] = Object.freeze(['kart']);
/** Off-road motorcycle classes the festival admits: the supermoto runs
 * treaded road tyres on the motocross chassis. Knobby motocross machines
 * stay on the dirt venues (their tyres and gearing are not for public roads). */
export const FESTIVAL_OFFROAD_BIKE_CLASSES: readonly string[] = Object.freeze(['supermoto']);

/** Can this definition run in the festival? Every four-wheel definition
 * except karts; every road motorcycle (the bike adapter on the open-world
 * surface) and the supermoto. */
export function festivalAdmits(d: Pick<VehicleDefinition, 'dynamicsKind' | 'classId' | 'bike'>) {
  const c = String(d.classId);
  if (FESTIVAL_EXCLUDED_CLASSES.includes(c)) return false;
  if (d.dynamicsKind === 'four-wheel') return true;
  if (d.dynamicsKind !== 'bike' || !d.bike) return false;
  return !isDirtBike(d) || FESTIVAL_OFFROAD_BIKE_CLASSES.includes(c);
}
/** Vehicles that can run in the festival, road cars first and motorcycles
 * after every car (data-driven: definitions added to vehicles.ts appear
 * here without code changes). */
export function festivalVehicles(): VehicleDefinition[] {
  const rank = (d: VehicleDefinition) => {
    if (d.dynamicsKind === 'bike') return FESTIVAL_CLASS_ORDER.length + 1;
    const c = String(d.classId),
      i = FESTIVAL_CLASS_ORDER.findIndex((group) => group.includes(c));
    return i < 0 ? FESTIVAL_CLASS_ORDER.length : i;
  };
  return Object.values(VEHICLES)
    .filter(festivalAdmits)
    .sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
}
/** Four-wheel festival machines only (rival pools and the showcase pace car). */
export function festivalCars() {
  return festivalVehicles().filter((d) => d.dynamicsKind === 'four-wheel');
}
/** Default festival machine: the first road/GT-class car, else the first
 * non-Formula car, else whatever the registry holds first. */
export function festivalDefaultVehicle() {
  const list = festivalCars();
  return (list.find((d) => d.classId !== 'formula') ?? list[0]).id;
}
/** Machine classes the festival admits (career venue admission). */
export function festivalClasses() {
  return [...new Set(festivalVehicles().map((d) => String(d.classId)))];
}
