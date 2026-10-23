# VECTORCLAD

A three.js tech demo for VECTORCLAD: FS-07A Vanguard, an Armored Core-style mech
loose in a Lower Manhattan overrun by spider-frames, six-legged machines that
climb the towers and swarm in growing waves, and scorpion-frames that dig up out
of the streets to claw and sting at it. The mech walks, boost-dashes, jump-jets,
and fires beam rifles, cannons and full missile salvos. Everything is procedural
geometry: the mech and its weapons are textured from two sheets in `textures/`,
the city from twelve more in `textures/city-src/`, and the spiders and scorpions
from ten in `textures/spider-src/`. There is no build step.

## Run it

Serve the repository root with any static server and open it in a browser:

```sh
npx http-server -p 8080 .
# then visit http://localhost:8080/
```

three.js 0.170.0 loads from jsDelivr, so the first load needs a network connection.

Add `?wave=N` to the URL to start the fight at wave N, with every kind that has
joined by then (every spider and scorpion is in by wave 6).

## Deploy

`.github/workflows/pages.yml` publishes the game to GitHub Pages on every push to `main`.
To turn it on, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
The game is then served at `https://agilancer.github.io/vectorclad/`.

## Title screen

The game opens on a title screen with the live 3D VECTORCLAD logo (from the
`vectorclad-brand` kit) while textures and the city load behind it. A tap, click or any
key fades it out and hands over to the loading screen or, once loading is done, the
intro card. The game doesn't start rendering until the title is gone, so the two never
compete for the GPU.

On phones held upright, a "Rotate your phone" overlay covers the screen until the phone
is turned sideways. Tapping start on a phone also asks for fullscreen and a landscape
lock, which Android browsers honor and iOS ignores.

The logo files live in `js/title/`. `logo.js` and `wordmark-data.js` are copied from the
brand kit; regenerate them there rather than editing them here. The title's three.js
add-ons (bloom, post-processing) load through the import map in `index.html`, which
points `three` at the same 0.170.0 build as `js/three.js`; keep the two versions in sync.

## Controls

| Action | Keyboard / mouse | Touch |
| --- | --- | --- |
| Move | `W` `A` `S` `D` | Left thumb stick |
| Aim | Mouse (click to capture), arrow keys | Drag the right side |
| Lock on / switch target (press again to release) | `T` | LOCK |
| Right-hand weapon | Left mouse | FIRE |
| Left-hand weapon / raise shield | Right mouse | L |
| Shoulder cannons (vulcan, beam cannon) | `F` or middle mouse | CNN |
| Single missile | `Q` | MSL |
| Full missile salvo | `E` | SALVO |
| Jump (hold to jet upward) | `Space` | JUMP |
| Boost dash | `Shift` | DASH |
| Reload | `R` | Reload |
| Hangar / pause | `Tab`, `M`, or `Esc` | Hangar |
| Camera zoom | Mouse wheel | |

The lock-on button holds one target. Aimed weapons lead it, the arms track it,
the camera keeps it in view, and single missiles go to it first. When it is
destroyed the lock moves to the next target in view.

Missiles lock onto targets inside the dashed circle. A salvo spreads its missiles
across every lock; with nothing locked they fly to the crosshair.

## Hangar

The hangar sets the loadout for six hardpoints (both hands, both shoulders, both
legs), a frame paint scheme, and one of eight colorways per weapon. It has five
presets and settings for sound, shadows, ink outlines, look sensitivity, inverted
look and render resolution. The loadout and settings are saved in `localStorage`
under `vectorclad.*` keys (saves from earlier builds under `fs07.*` still load).

Weapons, from the weapon sheet:

- **BR-07 Beam Rifle**: fast pink beam bolts
- **HB-90 Hyper Bazooka**: heavy rockets with back-blast and smoke trails
- **MG-79 Machine Gun**: spinning rotary barrels and tracers
- **SC-12 Shotgun Cannon**: ten-pellet spread
- **GL-6 Grenade Launcher**: rotating drum, arcing shells
- **MBC-2 Mega Beam Cannon**: charge, then a sustained beam (hand or shoulder)
- **VP-4 Vulcan Pod**: shoulder gatling
- **MP-6 Missile Pod**: 6 homing missiles behind an opening hatch (shoulder or leg)
- **HMP-8 Heavy Missile Pod**: 8 large missiles (shoulder)
- **μMP-24 Micro Missile Pod**: 24 swarming micro missiles (shoulder or leg)
- **RX-S Shield**: left forearm, raised with the left trigger

## The city

A 10 x 10 grid of blocks modeled on downtown Manhattan, built entirely from the
city texture sheets. The mech stands 40 ft (12.2 m) tall: at startup `main.js`
measures the top of its head in the idle stance and sets the world scale from
that (about 1.71 m per game unit), and the city is laid out in real meters.

- **Street grid:** 100 ft avenues with four one-way lanes and 60 ft cross streets, on long east-west blocks.
  - Crosswalks, stop bars, lane arrows, "don't block the box" junctions and manholes are keyed out of the asphalt sheets.
  - Sidewalks are raised with granite curbs and rounded corners.
- **Buildings:** several kinds, mixed by how close a block is to one of two tall clusters:
  - Walk-ups with storefronts, cornices and rooftop water towers.
  - Prewar mid-rises with setbacks.
  - Glass office slabs and towers with mechanical penthouses.
  - Art deco "wedding cake" towers with copper pyramid crowns.
  - A Woolworth-style gothic tower and a One WTC-style tapered landmark.
  - Party walls are brick, but buildings taller than their neighbors get windows on every side.
- **Open spaces:** a starting plaza with a red cube and planters, a park with a fountain, and a small green.
- **Waterfront:** an esplanade with railings on three sides. North of the playable area the city carries on past a barricade.
- **Street life:** streetlights, traffic signals, subway entrances, street trees, steam stacks and vents, and parked cars (many of them cabs).
  - Walking over a car crushes it. Shooting or blasting one makes it explode, sets off nearby cars, and leaves a burning wreck.
- **Scenery:** Jersey City and Brooklyn skylines across the rivers, a suspension bridge, a midtown skyline with a spired tower to the north, and the Statue of Liberty in the harbor.

All city surfaces sample three texture atlases (`textures/city-facade.jpg`,
`city-surface.jpg`, `city-ground.jpg`) through a shader that tiles inside one atlas
cell with `textureGrad`, so the whole city is merged into a few dozen meshes.
`tools/build_city_atlas.py` rebuilds the atlases and `js/cityTiles.js` from the
source sheets in `textures/city-src/`. Collision uses a spatial grid, and rays walk
it with a 2D DDA.

## Spider-frames

The enemies are six-legged spider machines cut from the spider texture sheets.
They are weak alone (one beam rifle bolt, one missile or a short burst drops
most of them; the big Lancers and Bombardiers take two bolts) but come in waves
that keep growing:

- **Waves:** wave *n* sends 6 + 6*n* spiders and [scorpions](#scorpion-frames),
  in packs, with up to 6 + 5*n* alive at once (64 at most). Spider packs spawn out
  of sight, 75 to 230 units away, on walls and roofs, and the gap between packs
  shrinks each wave. New kinds join as the waves go on, and a Broodmother leads
  every fifth wave. Clearing a wave patches 30% of the mech's armor.
- **Variants:** each kind has its own palette, proportions, tactics and weapon.
  Every one of them has the same glowing red eyes.

| Variant | Palette | From wave | What it does |
| --- | --- | --- | --- |
| **Stalker** | Gunmetal, red glow | 1 | The all-rounder. Crawls the towers, leaps between perches, fires plasma bursts, and charges a red laser from its perch. |
| **Skitterer** | Rust, toxic green glow | 1 | Small, fast and fragile. Rushes the mech in packs of two to four along streets and walls, pounces on it from up to 60 units away (even off a wall), and bursts on contact. It also bursts when shot, hurting anything nearby, mech and spiders alike. |
| **Weaver** | Bone white, cyan glow | 2 | Long-legged with a long abdomen; leaps the most. Spits pairs of web globs that slow the mech and its boost regen for about three seconds. Dashing tears free faster. |
| **Lancer** | Blue steel, violet glow | 3 | Big and slow, with a dorsal lance over its head. Climbs high and perches far off (55 to 170 units), then charges a heavy violet beam for 1.7 seconds. Takes two rifle bolts. |
| **Bombardier** | Brass, orange glow | 4 | Bulbous mortar sac. Stays on rooftops and lobs shells at where the mech is heading. A pulsing orange ring marks each landing spot. Takes two rifle bolts. |
| **Broodmother** | Near black, magenta glow | Every 5th wave | A boss two and a half times a stalker's size with 320 HP. Fires five-bolt fans and sets down pairs of skitterers every seven to ten seconds. |

- **Weapons:** plasma bolts are led at the mech. Lasers show a flickering aiming
  line while they charge, lock just before they fire, then burn along that line,
  so a dash at the right moment dodges them. Fire rates rise with each wave.
- **Armor:** the mech has 1000 AP, regenerating after four seconds out of
  contact. The raised shield turns away hits from the front. Hits flash the
  screen edges and show arcs around the reticle pointing at the shooter. At 0 AP
  the frame is destroyed; **Redeploy** starts again from wave 1.

### How they move

Locomotion follows how real spiders, and the procedural spider rigs built on
them, move:

- **Surfaces:** each spider rides a surface with its own up vector: the street,
  a wall or a roof. Two rays ahead, low and high, find a wall in the way, and the
  spider tips up onto it (an inside edge). When the ground runs out under the
  next step, a ray back under the body finds the far side of the roof edge or
  building corner, and the spider wraps over it (an outside edge). With nothing
  to hold, it falls.
- **Feet:** each foot stays planted in world space until it strays too far from
  its rest spot, then steps. A ray from the hip toward the rest spot finds the
  foothold, so feet reach onto a wall or around a corner before the body does.
  A foot only steps if the new hold is closer to where it wants to be.
- **Gait:** the legs step in an alternating tripod: front and back on one side
  with the middle on the other, so three feet are always down. Each leg is a
  two-bone IK chain with the knee thrown high and outward.
- **Jumps:** spiders leap between buildings, from roofs and from walls, after
  checking that the arc is clear. They crouch, fly a ballistic arc, turn their
  undersides to the landing surface in the air, grab on with every foot at once,
  and leave a silk dragline behind.
- **Behavior:** they climb to perches that can see the mech and fire from there,
  rear up to aim, leap to new perches, or drop to the street and rush in. How far
  they like to perch, how often they leap and how long they stay depend on the
  variant: lancers and bombardiers keep to high perches, and skitterers never
  perch at all.

### Building them from the sheets

`tools/build_spider_atlas.py` traces the parts out of the source sheets along
the dark gaps around each piece (each part is picked by a point inside it),
packs them into `textures/spider.jpg`, writes a glow map of only the lit red
tubes and slits to `textures/spider-glow.jpg`, and records each part's rectangle
and outline in `js/spiderParts.js`. In `js/frameParts.js` (shared with the
scorpions), the outlines become extruded plates with the art mapped onto them:
curved blades for the upper legs, striped claws for the lower legs (each crossed
with a second plate so it has body from any angle), the skull face, brow, fangs
and spine crest. The ribbed
dome and the slit plate are wrapped onto the abdomen and the carapace. The eyes
are additive glow points.

Palette swaps happen per spider in the shader. Each instance carries a tint for
the bare metal, an accent that replaces the red paint (picked out by how much
redder a texel is than its green and blue), and a glow color for the lit tubes.
So every variant shares the same atlas and the same instanced meshes. Variants
also differ in leg length, abdomen shape and size, and lancers carry an extra
dorsal lance plate.

Every spider part is an `InstancedMesh` shared by the whole swarm, so 64 spiders
cost about fifteen draw calls.

## Scorpion-frames

Eight-legged ground hunters built from the same spider sheets and palette swap,
running in the same waves. They don't leap or shoot from the rooftops. They dig
up out of the street, 60 to 200 units away and out of sight, and come straight
for the mech to fight up close:

- **Pincers:** a claw opens as it winds up, then snaps shut on the mech's hips or
  torso (12 AP).
- **Stinger:** the tail cocks back while its venom bulb glows, then whips over the
  scorpion's head onto the mech (30 AP).
- **Telegraphs:** every hit is tested against where the rendered pincer or
  stinger tip actually is, so a dash during the wind-up dodges it. The raised
  shield turns away strikes from the front, along with the venom, shock and grab
  that ride on them.

**Weakness:** a scorpion can only climb about 100 ft (30 m) up a wall. Past that
its grip gives out: it scrabbles at the wall, slips back down and tries again, so
scorpions chasing a mech up a tower end up lined along the wall at the 100 ft
mark. They can still climb over buildings shorter than that, but a mech on a
higher roof, or high in the air, is out of reach of everything but their ranged
attacks.

| Variant | Palette | From wave | What sets it apart |
| --- | --- | --- | --- |
| **Burrower** | Desert tan, amber glow | 1 | Dives into the street and tunnels at the mech, untargetable, straight under buildings, while the street heaves above it. A pulsing ring marks where it will burst out 0.6 seconds later, pincers first (24 AP). |
| **Prowler** | Black | 2 | Runs dark: its lights go out and neither the lock-on button nor missile locks can find it. It swings wide round the mech to strike from behind, where the shield can't help and its hits do 50% more. Its lights flare whenever it strikes or is hit. |
| **Berserker** | Dark red | 2 | Tougher (two rifle bolts). Below half its armor it goes berserk: glow flaring and venting red steam, it moves half again as fast and strikes and recovers far quicker. |
| **Venomtail** | Neon green | 3 | Its sting injects venom that eats 7 AP a second for six seconds and holds off armor regeneration; its pincers inject a little too. Lobs pairs of venom globs from range, or at a mech out of reach. |
| **Shocktail** | Neon blue | 3 | Its sting shorts out the mech's boost (45 drained, regen stalled). From range, and at a mech out of reach, it charges and arcs jagged lightning from its tail that drains boost too. |
| **Scorcher** | Neon orange | 4 | Sprays a stream of fire from its tail that drags after the mech's legs, burning it while it stands in the stream and setting the street alight. Burning patches last a few seconds. |
| **Emperor** | Royal purple, gold trim | 6 | Nearly twice the size of the other scorpions, with 160 HP and hits half again as hard. Its pincer seizes the mech and pins it for 1.8 seconds (dash to break free three times faster) while it reels itself in and stings. Arrives with two escorts. |

### How they're built

`js/scorpions.js` builds scorpions from the spider atlas parts: the thorax plate
on a flat carapace hull, the ribbed dome stretched into the segmented body with
the spine plate along its back, femur and tibia plates for the legs and arms,
heavy hulls for the claw hands, striped claw plates for the fingers and stinger,
and the glowing turbine disc wrapped onto the venom bulb. The neon kinds use a
fourth channel on the palette's accent that makes the paint itself glow.

- **Legs:** eight, stepping in alternating tetrapods with knees thrown wide and
  the body slung low. They share the spiders' surface crawling and foot planting.
- **Tail:** five segments posed with planar CCD in a plane that turns toward the
  target. Each joint only curls forward, so the tail arches over the back at
  rest and whips over the head when it stings. The strike aims at the torso,
  chest or hips, whichever the stinger can reach.
- **Pincers:** two-bone arms with the elbows thrown outward. Each hand points its
  own way, forward at rest and at the mech in a strike, and a hinged finger
  swings open against a fixed one.

Every part is an `InstancedMesh`, drawn only up to the highest scorpion slot in
use, so the 24 scorpions that can be alive at once cost about a dozen draw calls.

## Design notes

The suit follows Armored Core's style:
- **Silhouette:** tall, hunched frame, narrow waist, long arms with heavy forearms.
- **Armor:** sharp, faceted plates that sweep backward.
- **Head:** a beast head thrust forward between raised collar plates, on red hydraulic neck rams:
  - A pointed prow leans out over an open maw lit red behind its fangs, above a lower jaw that ends in a hanging chin.
  - Armor scales layer up and back from the prow into a crest of swept fins.
  - Each eye is a slanted red slit with an orange core, set under a heavy brow with a glowing seam. The eyes glow red in every paint; only the glint at their core takes the paint's eye color.
- **Legs:** blade knees, thin shins and talon feet with heel spurs.
- **Back:** a booster pack with swept stabilizer fins. Missile pods and cannons mount on top of it.
- **Paint:** dark armor over a gold-trimmed frame. The default is Lynx Navy; Unsung Black, Shrieker Steel, Glint White, Desert Ops and Crimson are in the hangar.

Walking is procedural:

- **Foot planting:** each foot locks to its spot on the ground while planted, so feet never slide.
- **Stepping:** a lifted foot peels its heel, arcs forward, and lands heel-first on a spot predicted from the current velocity. Each foot spends 60% of the cycle planted.
- **Leg solving:** two-joint IK bends the hip and knee to reach the foot, with the knees steered forward and outward.
- **Body motion:** the body sinks after each footfall and rises at the passing pose. Weight shifts over the planted leg, the hips twist with the stride while the torso counter-twists and jolts on impact, and the arms swing against the legs.
- **Standing still:** the feet settle into a staggered stance. Turning in place shuffles them to follow.
- **Air and dash:** jumps and dashes use canned leg poses that blend back into the walking system on landing.

The thrusters are built to read as real hardware:

- **Main engines:** two bell nozzles hang from armored housings under the backpack.
  - Each sits in a gimbal ring with hydraulic rams. The rams stretch as the bell swings back for a dash and down for a climb.
  - The bells are heat-tinted, gold at the throat shading to blue at the lip, and glow inside when lit.
- **Backpack verniers:** small nozzles on the pack's upper corners.
- **Calf verniers:** each sits in a recessed bay behind a two-piece armored cover that swings open when they fire.
- **Heel verniers:** set into a notch at the back of each foot.
- **Exhaust:** a camera-facing plume with shock diamonds, a turbulent inner shell and an exit glow. A light and a ground glow wash the area under the suit during a climb.

Armor plates are cut straight from the body sheet: `js/pieces.js` holds the
outlines of the sheet's panels, traced in sheet pixels. `pieceGeo()` in
`js/atlas.js` extrudes a plate to that outline and maps the panel's art onto
its face, so the E-07 hatch, R-07 forearm plate, shin plates, hazard pads and
DANGER intake panel all keep their painted shapes on the model. An inverted-hull
pass (`addOutline()`) draws ink outlines for the anime look; it can be turned off
in the hangar settings.

## Code map

| File | What it does |
| --- | --- |
| `js/regions.js` | Pixel rectangles of the panels used from each texture sheet |
| `js/pieces.js` | Traced outlines of the cut-out armor pieces on the body sheet |
| `js/atlas.js` | Texture loading, box-projected atlas UVs, geometry helpers, paints and skins |
| `js/mech.js` | Mech model, gimbaled bell-nozzle thrusters with plume shaders, IK foot-planting gait, dash/jump/aim animation |
| `js/weapons.js` | Weapon definitions and models, projectiles, homing missiles, lock-on |
| `js/fx.js` | Instanced billboard particles (smoke, fire, sparks), explosions, light pool, decals |
| `js/city.js` | Lower Manhattan: street grid, buildings, roofs, parks, street furniture, cars, waterfront, distant scenery |
| `js/cityTiles.js` | Generated: atlas layouts and tile positions for the city |
| `js/world.js` | Sky, lights, spatial collision grid, raycasts, damage routing |
| `js/spiders.js` | Spider-frames: variants and palettes, instanced model, surface crawling, tripod gait with IK legs, jumps, plasma, webs, mortars and lasers, and the waves for spiders and scorpions |
| `js/scorpions.js` | Scorpion-frames: variants and palettes, instanced model with a CCD tail and pincers, melee AI, the climb limit, and each kind's ability |
| `js/frameParts.js` | Shared by spiders and scorpions: plates and hulls cut from the spider atlas, the palette-swap material, leg rigs and IK, the mech's hit capsule |
| `js/spiderParts.js` | Generated: where each spider part sits in the spider atlas, with its traced outline |
| `js/audio.js` | Synthesized Web Audio sound effects |
| `js/input.js` | Keyboard, pointer lock and touch controls |
| `js/ui.js` | HUD (armor, waves, damage indicators) and hangar menu |
| `js/main.js` | Renderer, world scale, player physics and armor, camera, game loop, game over |
| `js/title/title.js` | Title screen: tap/click/key to start, fade out, portrait handling |
| `js/title/logo.js` | Live 3D VECTORCLAD logo (from the brand kit) |
| `js/title/wordmark-data.js` | Generated: wordmark geometry and brand palette |
| `tools/build_city_atlas.py` | Packs the city texture sheets into atlases |
| `tools/build_spider_atlas.py` | Traces the spider parts out of their sheets and packs them into an atlas and glow map |

The atlas mapping in `atlas.js` (`mapUV`) assigns each triangle to one of six
directions by its normal and maps it into the region chosen for that direction,
cropping the region to the face's aspect ratio so panels never stretch. To
re-skin a part, change the region names passed in its `faces` object.
