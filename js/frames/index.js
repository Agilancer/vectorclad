// The frames in Hangar 2: what each one is, how it moves and fights, where its
// hardpoints are and what it launches with. The models are in this folder (the
// Vanguard's in mech.js); they all share the rig and gait in mech.js.
import { Vanguard } from '../mech.js';
import { Revenant } from './revenant.js';
import { Kestrel } from './kestrel.js';
import { Locust } from './locust.js';
import { Goliath } from './goliath.js';
import { Bastion } from './bastion.js';

export const CLASSES = { light: 'Light', medium: 'Medium', heavy: 'Heavy' };

const SIX = ['rightHand', 'leftHand', 'shoulderL', 'shoulderR', 'legL', 'legR'];

// Stats, relative to the Vanguard where a number is a multiplier:
//   ap: armor points · walk / dash: top speeds (units/s) · kick: dash ignition shove
//   boost: how long a full gauge lasts · regen: how fast it refills · jump: takeoff speed
//   climb: jump-jet climb rate · weight: footfalls, landings and shake
export const FRAMES = [
  {
    id: 'kestrel', code: 'LT-3', name: 'Kestrel', class: 'light', make: (m, g) => new Kestrel(m, g),
    ap: 640, walk: 9.6, dash: 45, kick: 17, boost: 2.3, regen: 1.6, jump: 16.5, climb: 1.2, weight: 0.55,
    slots: ['rightHand', 'leftHand', 'shoulderL', 'shoulderR'], paint: 'scout',
    blurb: 'Stilt-legged scout with a cockpit pod. The fastest frame in the bay, with the longest boost and the thinnest armor.',
    presets: [
      { name: 'Outrider', slots: { rightHand: ['railgun', 'desert'], leftHand: ['blade', 'desert'], shoulderL: ['vulcanPod', 'desert'], shoulderR: ['missilePod', 'desert'] } },
      { name: 'Skirmisher', slots: { rightHand: ['machineGun', 'gunmetal'], leftHand: ['harpoon', 'gunmetal'], shoulderL: ['drones', 'gunmetal'], shoulderR: ['microPod', 'gunmetal'] } },
      { name: 'Hornet', slots: { rightHand: ['arcCaster', 'hazard'], leftHand: ['shotgun', 'hazard'], shoulderL: ['microPod', 'hazard'], shoulderR: ['microPod', 'hazard'] } },
    ],
  },
  {
    id: 'locust', code: 'RJ-6', name: 'Locust', class: 'light', make: (m, g) => new Locust(m, g),
    ap: 720, walk: 9, dash: 41, kick: 16, boost: 2, regen: 1.45, jump: 23, climb: 1.05, weight: 0.65,
    slots: ['rightHand', 'leftHand', 'legL', 'legR'], paint: 'crimson',
    blurb: 'Reverse-joint hopper. Its legs throw it higher than any other frame can jump. No shoulder mounts: its ordnance rides on its thighs.',
    presets: [
      { name: 'Grasshopper', slots: { rightHand: ['sawLauncher', 'crimson'], leftHand: ['flamer', 'crimson'], legL: ['mines', 'crimson'], legR: ['missilePod', 'crimson'] } },
      { name: 'Cricket', slots: { rightHand: ['beamRifle', 'arctic'], leftHand: ['shield', 'arctic'], legL: ['microPod', 'arctic'], legR: ['microPod', 'arctic'] } },
      { name: 'Mantis', slots: { rightHand: ['blade', 'gunmetal'], leftHand: ['blade', 'gunmetal'], legL: ['missilePod', 'gunmetal'], legR: ['missilePod', 'gunmetal'] } },
    ],
  },
  {
    id: 'vanguard', code: 'FS-07A', name: 'Vanguard', class: 'medium', make: (m, g) => new Vanguard(m, g),
    ap: 1000, walk: 7.5, dash: 36, kick: 14, boost: 1, regen: 1, jump: 15, climb: 1, weight: 1,
    slots: SIX, paint: 'lynx',
    blurb: 'The prototype: a hunched, beast-headed all-rounder on blade knees and talon feet.',
    presets: [
      { name: 'Vanguard', paint: 'lynx', slots: { rightHand: ['beamRifle', 'bronze'], leftHand: ['shield', 'gunmetal'], shoulderL: ['missilePod', 'gunmetal'], shoulderR: ['microPod', 'gunmetal'], legL: ['missilePod', 'gunmetal'], legR: ['missilePod', 'gunmetal'] } },
      { name: 'Full Armor', paint: 'desert', slots: { rightHand: ['machineGun', 'olive'], leftHand: ['shield', 'olive'], shoulderL: ['heavyPod', 'olive'], shoulderR: ['heavyPod', 'olive'], legL: ['microPod', 'olive'], legR: ['microPod', 'olive'] } },
      { name: 'Artillery', paint: 'steel', slots: { rightHand: ['bazooka', 'gunmetal'], leftHand: ['grenade', 'gunmetal'], shoulderL: ['beamCannon', 'gunmetal'], shoulderR: ['missilePod', 'gunmetal'], legL: ['missilePod', 'gunmetal'], legR: ['missilePod', 'gunmetal'] } },
      { name: 'Beam Striker', paint: 'glint', slots: { rightHand: ['beamRifle', 'white'], leftHand: ['beamCannon', 'white'], shoulderL: ['vulcanPod', 'white'], shoulderR: ['vulcanPod', 'white'], legL: [null, 'white'], legR: [null, 'white'] } },
      { name: 'Breacher', paint: 'unsung', slots: { rightHand: ['shotgun', 'hazard'], leftHand: ['machineGun', 'hazard'], shoulderL: ['microPod', 'hazard'], shoulderR: ['microPod', 'hazard'], legL: ['missilePod', 'hazard'], legR: ['missilePod', 'hazard'] } },
      { name: 'Stormcaller', paint: 'glint', slots: { rightHand: ['arcCaster', 'navy'], leftHand: ['shield', 'navy'], shoulderL: ['singularity', 'navy'], shoulderR: ['hydra', 'navy'], legL: ['mines', 'navy'], legR: ['mines', 'navy'] } },
    ],
  },
  {
    id: 'revenant', code: 'KR-11', name: 'Revenant', class: 'medium', make: (m, g) => new Revenant(m, g),
    ap: 1120, walk: 7.2, dash: 35, kick: 14, boost: 0.95, regen: 1, jump: 14.5, climb: 1, weight: 1.1,
    slots: SIX, paint: 'zeus',
    blurb: 'Lancer-pattern duelist: V-fin head, binder shoulders and a winged flight pack. Snipes from range, then closes in and cuts.',
    presets: [
      { name: 'Revenant', slots: { rightHand: ['railgun', 'gunmetal'], leftHand: ['blade', 'gunmetal'], shoulderL: ['drones', 'gunmetal'], shoulderR: ['hydra', 'gunmetal'], legL: ['missilePod', 'gunmetal'], legR: ['missilePod', 'gunmetal'] } },
      { name: 'Executioner', slots: { rightHand: ['blade', 'crimson'], leftHand: ['blade', 'crimson'], shoulderL: ['vulcanPod', 'crimson'], shoulderR: ['vulcanPod', 'crimson'], legL: ['mines', 'crimson'], legR: ['mines', 'crimson'] } },
      { name: 'Inquisitor', slots: { rightHand: ['flamer', 'bronze'], leftHand: ['shield', 'bronze'], shoulderL: ['singularity', 'bronze'], shoulderR: ['beamCannon', 'bronze'], legL: ['microPod', 'bronze'], legR: ['microPod', 'bronze'] } },
    ],
  },
  {
    id: 'goliath', code: 'HV-90', name: 'Goliath', class: 'heavy', make: (m, g) => new Goliath(m, g),
    ap: 1750, walk: 5.8, dash: 29, kick: 11, boost: 0.6, regen: 0.8, jump: 12.5, climb: 0.85, weight: 1.8,
    slots: [...SIX, 'hipL', 'hipR'], paint: 'onyx',
    blurb: 'Hunched brawler in layered plate with a gorilla\'s reach: shoulders above its head, binders on its back and pods on its hips. Carries heavy-class weapons.',
    presets: [
      { name: 'Goliath', slots: { rightHand: ['machineGun', 'navy'], leftHand: ['bazooka', 'navy'], shoulderL: ['artillery', 'navy'], shoulderR: ['heavyPod', 'navy'], legL: ['missilePod', 'navy'], legR: ['missilePod', 'navy'], hipL: ['microPod', 'navy'], hipR: ['microPod', 'navy'] } },
      { name: 'Juggernaut', slots: { rightHand: ['shotgun', 'gunmetal'], leftHand: ['flamer', 'gunmetal'], shoulderL: ['vulcanPod', 'gunmetal'], shoulderR: ['vulcanPod', 'gunmetal'], legL: ['mines', 'gunmetal'], legR: ['mines', 'gunmetal'], hipL: ['missilePod', 'gunmetal'], hipR: ['missilePod', 'gunmetal'] } },
      { name: 'Thunderhead', slots: { rightHand: ['arcCaster', 'hazard'], leftHand: ['shield', 'hazard'], shoulderL: ['orbital', 'hazard'], shoulderR: ['hydra', 'hazard'], legL: ['microPod', 'hazard'], legR: ['microPod', 'hazard'], hipL: ['mines', 'hazard'], hipR: ['mines', 'hazard'] } },
    ],
  },
  {
    id: 'bastion', code: 'TK-40', name: 'Bastion', class: 'heavy', make: (m, g) => new Bastion(m, g),
    ap: 2000, walk: 5.2, dash: 26, kick: 10, boost: 0.55, regen: 0.75, jump: 11.5, climb: 0.8, weight: 2.1,
    slots: [...SIX, 'backC', 'hipL', 'hipR'], paint: 'neozeon',
    blurb: 'Commander-pattern fortress in swollen armor studded with verniers, a mono-eye under its crest and a weapons deck on its back. The slowest and toughest frame; carries heavy-class weapons.',
    presets: [
      { name: 'Bastion', slots: { rightHand: ['railgun', 'gunmetal'], leftHand: ['shield', 'gunmetal'], shoulderL: ['heavyPod', 'gunmetal'], shoulderR: ['heavyPod', 'gunmetal'], legL: ['missilePod', 'gunmetal'], legR: ['missilePod', 'gunmetal'], backC: ['artillery', 'gunmetal'], hipL: ['microPod', 'gunmetal'], hipR: ['microPod', 'gunmetal'] } },
      { name: 'Citadel', slots: { rightHand: ['beamRifle', 'white'], leftHand: ['beamCannon', 'white'], shoulderL: ['drones', 'white'], shoulderR: ['drones', 'white'], legL: ['microPod', 'white'], legR: ['microPod', 'white'], backC: ['orbital', 'white'], hipL: ['mines', 'white'], hipR: ['mines', 'white'] } },
      { name: 'Siegebreaker', slots: { rightHand: ['bazooka', 'olive'], leftHand: ['grenade', 'olive'], shoulderL: ['artillery', 'olive'], shoulderR: ['singularity', 'olive'], legL: ['missilePod', 'olive'], legR: ['missilePod', 'olive'], backC: ['orbital', 'olive'], hipL: ['microPod', 'olive'], hipR: ['microPod', 'olive'] } },
    ],
  },
];

export const frameById = (id) => FRAMES.find((f) => f.id === id) || FRAMES.find((f) => f.id === 'vanguard');

/** A frame's first preset as a fresh loadout */
export function defaultLoadout(frame) {
  const p = frame.presets[0];
  const slots = {};
  for (const id of frame.slots) slots[id] = [...(p.slots[id] || [null, 'gunmetal'])];
  return { paint: p.paint || frame.paint, slots };
}
