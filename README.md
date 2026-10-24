# VECTORCLAD

A three.js tech demo for VECTORCLAD: an Armored Core-style mech, the FS-07A Vanguard or
the HV-02 Obsidian heavy frame, flown in from the harbor under a heavy lifter and set down
in Port Meridian, a harbor city overrun by spider-frames, six-legged machines
that climb the towers, scorpion-frames that claw and sting, swarms of small
riftlings, and a black robotic millipede long enough to lie across several city
blocks. In this build nothing comes on its own: a debug menu (the `` ` `` key)
summons any of them through portals in the sky. Packs of dropships set
allied tanks down in the streets to hunt them too. The mech walks, boost-dashes,
jump-jets, and fires beam rifles, cannons and full missile salvos. The city is alive:
people walk its sidewalks and fill its buildings, traffic drives its streets and trains
run on its elevated railway, and all of it can be blown apart. Everything is
procedural geometry: the mech and its weapons are textured from two sheets in
`textures/`, the city from fifty-two more in `textures/city-src/` and the eighty
asset packs' sheets in `assets/` (facades, storefronts, roofs, bark and foliage, and
car skins) and its sixty billboard ads, the ceilings inside its buildings from five in `textures/ceiling-src/`,
and the spiders and scorpions from ten in `textures/spider-src/`. There is no build step.

## Run it

Serve the repository root with any static server and open it in a browser:

```sh
npx http-server -p 8080 .
# then visit http://localhost:8080/
```

three.js 0.170.0 loads from jsDelivr, so the first load needs a network connection.

It's a sandbox: there are no waves, and the fight starts empty. Monsters come only
from the [summon menu](#summoning).

## Deploy

`.github/workflows/pages.yml` publishes the game to GitHub Pages on every push to `main`.
To turn it on, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
The game is then served at `https://agilancer.github.io/vectorclad/`.

## Title screen

Before anything else loads, a boot screen downloads the title theme (see Music below).
Then the game opens on a title screen with the live 3D VECTORCLAD logo (from the
`vectorclad-brand` kit) while textures and the city load behind it. A tap, click or any
key fades it out and hands over to the loading screen or, once loading is done, the
intro card. The game doesn't start rendering until the title is gone, so the two never
compete for the GPU.

On phones held upright, a "Rotate your phone" overlay covers the screen until the phone
is turned sideways. Tapping start on a phone also asks for fullscreen and a landscape
lock, which Android browsers honor and iOS ignores. Turning a phone upright mid-fight,
or leaving the page, pauses the game in the hangar.

The logo files live in `js/title/`. `logo.js` and `wordmark-data.js` are copied from the
brand kit; regenerate them there rather than editing them here. The title's three.js
add-ons (bloom, post-processing) load through the import map in `index.html`, which
points `three` at the same 0.170.0 build as `js/three.js`; keep the two versions in sync.

## Music

The soundtrack is eight songs by THEDEMONMECHANIZEDMACHINEDESTROYER in `audio/music/`.
**Vectors** is the title theme. `js/boot.js` downloads it before the title screen or the
game start loading, and it plays on the title screen. Getting past the title lowers the
music to 55% over about a second, so the sound effects sit on top of it. After Vectors the
other seven (**Oh No, Robot Insects**, **Sentient Plague**, **They Came From the Sky!** and
**Vectors II** to **V**) play in a shuffled order, then Vectors again, then the seven in a
new order, for as long as the game runs. Each song downloads in full while the one before it plays (from 30 seconds in, so it
doesn't slow the texture download), and the music pauses while the tab is hidden. The
hangar has a Music toggle next to Sound.

Browsers don't play audio until the player taps, clicks or presses a key. When the browser
blocks autoplay, which is usual on a first visit, the boot screen shows "Tap to power up"
once Vectors has loaded, and the music and title start on that tap. On iOS, which ignores
`audio.volume`, the music goes through a Web Audio gain node that it shares with the
sound effects (`audioContext()` in `js/audio.js`).

The masters are 48 kHz WAVs kept outside the repo. To re-encode them as 160 kbps MP3s:

```sh
pip install lameenc
python tools/build_music.py "F:/! THEDEMONMECHANIZEDMACHINEDESTROYER"
```

The song list is at the top of `js/music.js`.

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
| Summon menu (tech demo) | `` ` `` (or `~`), or the Summon button | Summon |
| Camera zoom | Mouse wheel | |

The aim reaches straight up and straight down, so the weapons fire in any direction.
Looking steeply down, the view slides forward so the crosshair rests on the ground just
ahead of the feet, where the arms can reach. The camera starts zoomed all the way in.

Dashing and jump-jetting draw on one boost gauge. A full gauge holds about nine
seconds of dash and refills in about three once the mech is back on the ground. If
it runs dry the boosters overheat and stay off until the gauge is back to 40.

The lock-on button holds one target. Aimed weapons lead it, the arms track it,
the camera keeps it in view, and single missiles go to it first. When it is
destroyed the lock moves to the next target in view.

Missiles lock onto targets inside the dashed circle. A salvo spreads its missiles
across every lock; with nothing locked they fly to the crosshair. Leg pods pop
their missiles almost straight up so they arc over the ground in front of the feet.

## Summoning

This is still a tech demo and a sandbox: there are no waves, and nothing attacks
until it is called in. Right before the fight starts (the moment the Kestrel H's clamps would
open), the drop holds on a notice saying so; **Okay** (or `Enter`) lets the frame go.

Press `` ` `` in the fight (or click **Summon** on the HUD, or tap it on a
touchscreen) to open the summon menu on the left. The game keeps running behind
it, and the pointer is free to use the sliders; `` ` `` again or **Close** takes
the pointer back for aiming (`Esc` or a click on the view closes it too). Every
monster in the game has a row: a slider for how many and a **Summon** button. The
HUD's HOSTILES box counts everything out there or on its way through a portal.

On a touchscreen (no `` ` `` key) the loadout and pause hangar also have a
**Debug** button. From the pause hangar it goes back into the fight with the menu
open; from the loadout before a drop it opens the menu over the loadout, where a
Summon only queues the monster (the button reads **Queued**; press it again to take
it back) and everything queued comes through as soon as the frame is released.

| Monsters | How many per summon |
| --- | --- |
| Spider-frames: Stalker, Skitterer, Weaver, Lancer, Bombardier | 1 to 20 |
| Medium spider-frames: Bulwark, Warden, Mender, Magnetar, Quarrier | 1 to 5 |
| Scorpion-frames: Burrower, Prowler, Berserker, Shocktail, Scorcher, Venomtail | 1 to 20 |
| Emperor scorpion | 1 to 5 |
| [Riftlings](#riftlings) | 1 to 200 |
| Broodmother | 1 to 5 |
| [The millipede](#the-millipede) | 1 (only one at a time) |

A kind's button is disabled for a minute after it summons, counting down on the
button. If there's no room left (136 spiders, 128 scorpions and 400 riftlings at
once), a summon brings what fits.

**Portals.** Every monster comes through a portal of its own, about 800 ft
straight ahead of where the mech is looking (kept inside the city):

- Sky portals lie flat, 400 ft up, a little wider than the monster they carry
  (about 12 m across for a riftling, 40 m for a stalker, up to 80 m for an Emperor).
  Each is a swirling vortex in the monster's glow color with a dark heart, a hot
  rim and a crackling halo; it springs open, the monster drops out of its face and
  falls to the street or roof below, and it snaps shut. The vortex is drawn opaque,
  so the monster stays hidden until it falls through.
- They only open in clear sky: never over a tower's roof, and never beside a
  building that reaches up near them. And they open where the mech can see them:
  each portal is checked against the mech's line of sight and rises (as high as
  650 ft) to show over the roofs in between, or moves elsewhere in the area. If
  the patch ahead is all towers, or hidden behind them, the area slides to the
  nearest open sky the mech can see, up to about 180 m off to the side.
- A summon of many staggers its portals one after another across an area that
  grows with the count (up to about 140 m across for riftlings, 200 m for the big
  kinds), so twenty stalkers drop in over
  nine seconds and two hundred riftlings come down like rain over eight.
- The millipede's portal stands upright a few meters off the street, 54 m across.
  `js/millipede.js` tries 90 spots and headings near the 800 ft mark for one whose
  disc clears whatever is under it and stands clear of the buildings beside it,
  in view of the mech, with a route that leaves it lying on the roofs, low and
  clear of the mech. The
  body crawls out through it, sloping down onto the rooftops; everything still
  behind the portal is clipped away (and can't be shot or locked), its legs reach
  for holds as they come through, and the portal closes behind the tail.

`js/summons.js` holds the list, the placement and the cooldowns, `js/portals.js`
draws every portal as one instance of two instanced meshes (two draw calls for a
whole rain of them), and `SummonMenu` in `js/ui.js` is the menu.

## Frames

**Launch** on the intro card opens the frame select screen, then the loadout, then
**Deploy** flies the frame in (see [Insertion](#insertion)). **Quick deploy** skips
straight to the drop with the last frame and loadout. After a lost fight, **Hangar**
goes back to the frame select and **Redeploy** flies a fresh frame in.

| Frame | Armor | Walk | Dash | Boost | |
| --- | --- | --- | --- | --- | --- |
| **FS-07A Vanguard** | 1000 AP | 46 km/h | 220 km/h | 9.6 s | The field-trial frame; takes the hangar's paint schemes |
| **HV-02 Obsidian** | 1450 AP | 39 km/h | 189 km/h | 7.7 s | Heavy armor in black, ivory and gold (`assets/heavy-frame`) |

The select screen shows each frame's armor, walk and dash speeds and how long a full
boost gauge lasts, and puts the picked frame on show in the plaza. Both frames are built
on the same rig, sockets and thrusters (`HeavyMech` subclasses `Mech` and reskins it), so
a loadout moves across unchanged; the world is always scaled from the Vanguard, so the
city's size never changes with the frame. The frame can also be swapped in the pause
hangar mid-fight: it keeps the same share of its armor. The frame list is in
`js/frames.js`; the pick is saved under `vectorclad.frame`.

## Hangar

The hangar sets the loadout for six hardpoints (both hands, both shoulders, both
legs), the frame, a frame paint scheme (the Vanguard's; the Obsidian wears its own finish),
and one of eight colorways per weapon. It has five
presets and settings for sound, music, [graphics](#graphics), shadows, ink outlines, look
sensitivity, inverted look and render resolution. Before a drop it is the loadout screen, with **Deploy** and
a way back to the frames; in a fight it pauses the game. The loadout and settings are saved in `localStorage`
under `vectorclad.*` keys (saves from earlier builds under `fs07.*` still load).

Weapons, from the weapon sheet:

- **BR-07 Beam Rifle**: fast pink beam bolts
- **HB-90 Hyper Bazooka**: heavy rockets with back-blast and smoke trails (a 30% tighter blast than it used to have)
- **MG-79 Machine Gun**: spinning rotary barrels and tracers
- **SC-12 Shotgun Cannon**: ten-pellet spread
- **GL-6 Grenade Launcher**: rotating drum, arcing shells (blast 30% tighter, like the bazooka's; the missile pods keep theirs)
- **MBC-2 Mega Beam Cannon**: charge, then a sustained beam (hand or shoulder)
- **VP-4 Vulcan Pod**: shoulder gatling
- **MP-6 Missile Pod**: 6 homing missiles behind an opening hatch (shoulder or leg)
- **HMP-8 Heavy Missile Pod**: 8 large missiles (shoulder)
- **μMP-24 Micro Missile Pod**: 24 swarming micro missiles (shoulder or leg)
- **RX-S Shield**: left forearm, raised with the left trigger

## Graphics

The hangar's **Graphics** setting picks how each frame is drawn (`js/post.js`):

| Setting | |
| --- | --- |
| **Low** | The scene straight to the screen. Phones and tablets start here. |
| **High** | Bloom on everything that glows, heat shimmer round it, glare round the sun, a light grade and vignette, and red closing in from the edges as the mech is hit |
| **Ultra** | High, plus ambient occlusion, god rays and a sun shadow map twice as sharp |
| **Auto** | Ultra to begin with, then a setting lower whenever play stays under about 45 frames a second for four seconds. The default on desktop. |

- **The same picture underneath.** High and Ultra draw the scene into an offscreen target
  exactly as Low draws it onto the canvas: tone-mapped and sRGB-encoded in the shaders (three
  does that for the canvas and XR targets only, so the target says it is one), into plain
  RGBA8 so blending works the same too, with MSAA. Every hand-tuned shader keeps its
  colors, and the effects go on top.
- **Only what glows blooms.** Materials that skip tone mapping (eyes, sensors, tracers,
  bolts) and additive ones (beams, thruster plumes, fire, flashes, the spiders' eyes) are
  drawn again each frame, alone, into a glow target that shares the scene's depth, so walls
  still hide them. The glow is blurred down a six-level mip chain and back up and added over
  the scene, so the sky and sunlit concrete never bloom. The wider levels of the same blur
  drive the heat shimmer.
- **Depth does the rest.** The sun's glare is as strong as the share of its disc that shows
  past the buildings, read from the depth buffer. On Ultra, god rays smear the open sky out
  from the sun, and ambient occlusion samples a hemisphere round each pixel at half
  resolution, with normals rebuilt from depth and a blur that keeps to surfaces at the same
  depth. Neither draws the scene again.

On every setting:

- **Haze.** three's linear fog is reworked for every material through its shader chunks
  (`js/world.js`): measured along the ray, not the view axis, so it doesn't shift as the
  camera turns; thickest along the ground and thinning with height, so tower tops stand out
  of it; warm toward the sun and cool away from it.
- **Clouds.** Fair-weather cumulus drift across the sky, lit from the sun's side, gray
  underneath, thinning into the haze toward the horizon.
- **Drawing less.** Besides the cars and trees (below):
  - The spiders' instanced parts, eyes and silk are drawn only up to the highest slot in
    use, not for all 64 spiders (the scorpions already were).
  - The frame and its weapons are a few hundred meshes, each with its outline, each drawn
    again for the sun's shadow. Meshes under the same joint with the same material are
    merged into one, and each joint's outlines into one (`batchRigid()` in `js/atlas.js`):
    what code still moves, hides or recolors (pistons, thrusters, hatches, barrels) is left
    alone. The Vanguard goes from about 500 draw calls to 260. Outlines no longer cast
    shadows.
  - Instanced meshes with nothing in them (furniture before a building breaks open, spider
    parts between waves, stumps, idle particles) are taken off the camera's layer, so they
    don't bind their shaders every frame for nothing.

## The city

Port Meridian: a 15 x 15 grid of blocks on a peninsula between two rivers and a harbor,
with a forest along its west side, built entirely from the city texture sheets and the
asset packs. The mech stands 40 ft (12.2 m) tall: at startup `main.js`
measures the top of its head in the idle stance and sets the world scale from
that (about 1.71 m per game unit), and the city is laid out in real meters.

- **Street grid:** 28 m avenues and cross streets, both four lanes wide (a 20 m roadway on the cross streets), on long east-west blocks. Avenues run one way; cross streets alternate between one way and two way with a double yellow.
  - Crosswalks, stop bars, lane arrows, "don't block the box" junctions and manholes are keyed out of the asphalt sheets.
  - Sidewalks are raised with granite curbs and rounded corners.
  - Streets and sidewalks draw on ten ground kits (tactile, crisp, cobble, ruin, faded, redcurb, hazard, buslane, grime, fresh), picked by how worn the pavement is in each part of town:
    - A smooth wear field over the city leaves about half the intersections clean, a quarter worn and a quarter broken.
    - Clean streets get fresh asphalt, crisp lane lines, double yellows and crosswalks; worn and broken ones get faded and cracked paint, stained or broken slabs, and cracked patches and potholes laid over the asphalt in soft-edged rounds.
    - Each road keeps one asphalt per wear level along its whole length, laid in world space and mirrored at the tile edges, so it has no seams. Avenues run unbroken through the intersections, and the surface only changes where the wear does. The asphalt is drawn from plain tiles without painted lines and close in tone.
    - Each sidewalk picks its own tile, so the paving changes block by block. The original slab tiles stay in the clean mix.
    - Manholes, sidewalk covers and grates, tree pits under the street trees, and the starting plaza's paving (setts, fan cobbles, herringbone brick or pavers) come from the kits too.
- **Buildings:** several kinds, mixed by how close a block is to one of three tall clusters (one around the starting plaza, one to the southeast and a smaller one beyond it toward the highway):
  - Walk-ups with storefronts and cornices; prewar mid-rises with setbacks.
  - Glass office slabs and towers with mechanical penthouses; a third of the towers wear a crown instead.
  - Twisting towers, whose square floors turn a quarter turn or so on the way up, and tapering octagonal and hexagonal towers with spires.
  - Stacked towers of shifted boxes that swing from side to side and hang out over the sidewalks, alternating two facades.
  - Stone setback towers with a couple of shallow steps.
  - Crowns: a sloped glass wedge, a glowing halo ring held on struts over a glass drum, or a steel lattice lantern around a needle.
  - Signature blocks: the observation needle (the city's landmark, a tapering concrete shaft with a flared pod, a glass viewing ring and a beaconed mast), twin towers on a podium joined by a sky bridge, a gate building whose bridge of floors spans a plaza the mech can walk through, and a stepped ziggurat with a garden and trees on every terrace.
  - Roofs carry gardens, steel tanks, masts, solar panels, billboards and helipads. About half the walk-ups and prewar buildings also carry an old timber water tower on braced steel legs.
  - Big screens hang over the streets on some tall buildings.
  - Every billboard, wall screen and kiosk screen shows one of the sixty ads in `assets/billboards`: forty eccentric products (Miracle Office Shrimp, Sleepless Mint, Crunchy Water and the rest) and twenty serious corporate campaigns. The ads are dealt out in a shuffled order, the whole pack before any repeats, so every one of them is up somewhere in the city (each shows on six or seven of its 380 screens).
  - Party walls are brick, but buildings taller than their neighbors get windows on every side.
  - Many facades are composed from twenty panel kits, each a family of materials: steel, precast, graphite, brick, concrete, limestone, teal glass, aluminum, navy, slate, sandstone, indigo, silver, travertine, seaglass, masonry, ivory, basalt, azure, and a sheet of whole facades.
    - Each building picks one kit and one window bay, so its floors line up.
    - Piers frame the corners and split long sides into evenly sized groups of bays.
    - Offices and towers get a louvered mechanical floor every 40 to 85 m and under each setback, and their penthouses wear the kit's louvers.
    - Walk-ups draw from the brick, limestone and masonry kits; prewar buildings and art deco towers from the masonry and warm stone kits; offices and towers from the glass, metal and dark stone ones.
  - Twenty more kits come from the skyscraper facade sheets (`assets/skyscraper-facades`): silver aluminum, art deco limestone with bronze, white precast, black steel curtain wall, red brick industrial, brutalist concrete, champagne aluminum, terracotta rainscreen, pale granite, green copper, white ceramic tile, 1920s sandstone, blue-gray metal panel, dark basalt with bronze, travertine fins, weathered 1970s concrete, burgundy metal and brick, pale green enamel, ribbed titanium and neo-gothic limestone. Each sheet's window bays, wall panels (with a pier cut down the middle of each) and louvers join the facade mix by style.
  - Ground floors open onto the street through twenty storefront kits (`assets/street-level-storefronts`): bakeries, bookshops, coffee shops, pharmacies, florists, butchers, barbers, laundromats, galleries, record shops, tailors and more. A street front is a run of their shop windows and doorways, now and then one with its shutter down, under a sign board; their upper-floor windows face walk-ups and row houses too.
  - Roofs are covered from twenty roof sheets (`assets/rooftop-textures`): rubber membrane, gravel ballast, standing seam, copper, terracotta, slate, white membrane, concrete, bitumen, sedum, solar, corrugated steel, pavers, decking, zinc, shingles and more, with drains, vents and hatches from the same sheet set into them.
- **Residential streets:** the blocks by the forest are detached houses, two floors or so under hipped roofs of terracotta, slate, shingle, ceramic, zinc or copper, set back behind lawns with a path to the door and a tree in the yard. Beyond them, and along much of the south waterfront, row houses stand wall to wall, three or four floors over their doorways, with cornices along the top.
- **The forest:** a belt of woods 190 m deep runs the length of the city between its westernmost avenue and the west esplanade. Gravel trails carry every cross street through it and one runs its length; boulders and fallen logs lie along them. A smooth field drifts the stands from oak, beech, maple, birch, elm, linden and poplar woods into pines, spruces, firs and cedars, with groves of redwoods twice their height.
- **Open spaces:** a starting plaza with an armillary of steel rings and planters, two parks with fountains, three small greens, and the plaza under the gate building.
- **Elevated structures:** built from ten structure kits (railway, steel truss, overpass, viaduct, interchange, footing, suspension, cable-stay, stonework and industrial).
  - An elevated railway runs down the avenue beside the starting plaza: double track on a deck carried by lattice girders, on steel bents about every 15 m (never in a cross street's roadway: there they step back to the crosswalks, and the traffic passes under). Trains run on it (see **Trains** below).
  - An elevated expressway runs along the east waterfront: four lanes on girders and hammerhead piers, with lamps along its barriers. At the south end a ramp brings it down to the esplanade.
  - Both decks clear the mech (17 m up), so it can walk under them, and both are solid: jump up onto either, or walk up the highway ramp, and walk along the top. Railings and barriers keep it on unless it jumps them. Spiders perch on them like roofs.
- **Waterfront:** an esplanade with railings on the east and west (past the forest) and a stone balustrade with lamp pedestals along the south shore. North of the playable area the city carries on past a barricade.
- **Street life:** streetlights, traffic signals, transit entrances with blue lamps, kiosks with screens, street trees, the odd steam vent, cars parked along the curbs and driving the streets, and people on the sidewalks (see **People** below).
  - Walking over a car crushes it. Shooting or blasting one makes it explode, sets off nearby cars, and leaves a burning wreck.
  - Running into a tree rips it out of the ground, leaving a stump, and it tumbles and rolls away. Walk or dash into a fallen tree to kick it along.
  - Any shot, blast or beam that hits a tree knocks it loose and sets it burning, and so do spider fire, a Scorcher's flames and the burning ground they leave. A burning tree chars and drops its leaves, and sets alight any tree it rolls into.
- **Trees:** twelve species, each with its own bark and foliage from the bark-and-foliage sheets (`assets/bark-and-foliage`) and its own crown: round heads of leafy clumps on oaks, maples, beeches and lindens, vase-shaped elms, slender birches with pale bark, columnar poplars, tiered pines, spruces and firs, conical cedars, and redwoods with long bare trunks. Every tree is sized and shaped a little differently. The streets and parks have the broadleaf kinds and the odd pine; the forest has them all. Trees are drawn in chunks of the city, so whole chunks drop out of view and out of the sun's shadow pass, and chunks more than 450 m off draw coarser clumps, cones and trunks over the same instances.
- **Scenery:** skylines on the far shores of both rivers, uptown towers to the north led by a twisting supertall, and out in the harbor a lighthouse on a rocky islet and a line of wind turbines whose rotors turn.
  - A suspension bridge across the east river: H towers on pile caps in the water, a deck stiffened by trusses, main cables and hangers, anchorages, and an approach rising from the seawall on piers.
  - A cable-stayed bridge across the west river, north of the playable area: A-frame pylons with fans of stays, and approaches on piers at both shores.

### Cars and traffic

Every car wears one of a hundred skins from the car sheets in `assets/car-sprites`
(ten each of sedans, hatchbacks, coupes, supercars, muscle cars, SUVs, pickups, vans,
wagons and rally cars), and its body is built to fit its skin. Each sheet holds unfolded
car nets: a plan strip (hood, roof, trunk) between two full-length side profiles, the
front fascia above and the rear below. `tools/build_asset_atlas.py` cuts every net into its
five pieces (where pieces touch, the fascias hang off the plan strip like tabs; they are
cut free along the narrowest gap, row by row, and where a side's windows run into the plan
strip, along the plan strip's edge as it runs there; each piece is trimmed to its opaque
pixels, which drops the sheets' soft fringes, and the plan strip loses its mirror arms) and
measures the side profile and plan at 28 stations from bumper to bumper. The car's sides follow the painted silhouette, wheels,
arches, windshield and roof line included, its top wears the plan strip and its ends the
fascias. All cars share one topology and one draw call: the vertex shader reads each
instance's skin from a data texture and moves the vertices to fit it. Each frame only the
cars in view (out to 1.2 km), and those near the mech whose shadows can fall in view, are
copied into that draw; the rest of the city's thousand-odd cars cost nothing.

- **Parked cars** line the curb lanes of every street.
- **Traffic** keeps to the middle lanes, one way along the avenues and one way or two way
  on the cross streets; the roads round the edge of the city run both ways, so a car that
  comes to the edge always has somewhere to turn. Cars follow the car ahead, turn at intersections where the streets
  allow, and stop for the mech, for wrecks, rubble and pieces of building in the road, and
  for fallen trees. Up to 180 drive at once; new ones keep coming in out of the mech's
  sight to replace those lost, and wrecks are cleared away once nobody is near.
- Driving cars are as breakable as parked ones: the mech treads on them, and shots and
  blasts set them burning.

### People

The city is full of people, at their true size beside the 12 m mech (`js/people.js`):

- **Fifty models:** twenty you'd meet in a city (office workers, a banker, a businesswoman,
  a construction worker in a hard hat, a police officer, a nurse, a cook, joggers, a
  tourist, students, a courier, retirees, children, a skater, a mechanic, a doctor, a
  musician) and thirty more from the city's wardrobe. Each is a build (height, girth), a
  skin tone, a haircut, clothes (shirts and jackets with short or long sleeves, trousers,
  shorts or skirts, shoes) and now and then a hat or a bag.
- **Animated on a rig of joint angles:** they idle (shifting their weight, looking round),
  walk, run, die (toppling over), slide backward off a ledge (leaning back, feet scrabbling,
  arms windmilling) and fall (tumbling, flailing). Every part of every person is one
  InstancedMesh, so the crowd draws in a handful of calls.
- **On the sidewalks:** a few hundred walk the loops round the blocks near the mech,
  stopping now and then and crossing the streets at the corners. Those left far behind are
  moved on to blocks near the mech again, out of its sight.
- **In the buildings:** when a building is first broken open, its floors round the hole
  fill with people and furniture, some buildings far more than others (offices most, homes
  fewer). The ones by the hole are thrown out of it or slide backward off the broken floor
  and fall; the rest stay inside until the next blast throws them or the floor under them
  goes.
- **What happens to them:** explosions throw and kill them, rounds and beams cut them down,
  the mech's feet squash them, falling pieces of building and train cars crush them, and a
  fall from more than a storey or so ends in a little red splat on the pavement. Blasts,
  falling buildings and the mech coming close send everyone near running.

**Furniture** (`js/furniture.js`): sixteen pieces modeled in three.js from boxes and
cylinders: desks with monitors and office chairs, filing cabinets, bookshelves full of
books, water coolers and potted plants for the offices; sofas, armchairs, beds, tables
and chairs, televisions, fridges, wardrobes and floor lamps for the homes. Blasts throw
them out through the holes, tumbling; a piece whose floor is shot away falls; they bounce
and come to rest on the street, on the rubble or on the floors below.

### Trains

A train comes in on the elevated railway about once a minute, out of the north end of the
line beyond the barricade (`js/train.js`): cab cars at both ends and four coaches between, stainless steel
from the silver aluminum facade sheet with ribbed titanium roofs, on bogies. It runs south
down the line, stops at the end of it by the water, crosses over to the other track and
runs back north out of the city.

It brakes to a stop for the mech standing on the track, and for a train stopped ahead of it,
so trains held up queue behind each other (and the next one waits to come in). But wherever the deck has been shot
away under it, or a wreck is lying on the line, it derails: the cars stay coupled while it
brakes, and each one leaves the rails as it runs off the broken end of the track (the
leading one as it runs into the wreck ahead), going on as a rigid body with the train's
speed. It tumbles off and crashes down onto whatever is below, crushing cars, people and
trees. Whatever is left when the train stops lies on the deck for the next one to plough
into. The trains keep coming whether or not the line is still there, so the wrecks pile up
in and under the gap, each settled car becoming something solid for the next ones to land
on and for the mech to climb. A settled wreck stays put only while something holds it up:
shoot the deck out from under one, or the wreck it lies on, and it comes down.

### Atlases

All city surfaces sample six texture atlases (`textures/city-facade.jpg`,
`city-surface.jpg`, `city-ground.jpg`, `city-panels.jpg`, `city-roads.jpg`,
`city-structs.webp`) through a shader that tiles inside one atlas cell with
`textureGrad`, so the whole city is merged into a few dozen meshes. Each vertex carries
its cell's rectangle, so cells can be any size. If the facade, ground or structure
panels ever outgrow one 4096 px page, the build splits them over `city-panels2.jpg`
(or `city-roads2.jpg`, `city-structs2.webp`) and on, keeping each kit on one page, and
the city gives each page its materials. The structure atlas is WebP so its see-through
pieces keep their alpha.
`tools/build_city_atlas.py` rebuilds the atlases and `js/cityTiles.js` from the
source sheets in `textures/city-src/`. The asset packs add four more pages, built by
`python3 tools/build_asset_atlas.py [--review DIR]` (it needs NumPy, Pillow and SciPy)
into `js/kitTiles.js`, which merges them into the city's tiles: `city-kits.jpg` (the
skyscraper facade kits), `city-stores.jpg` (the storefront kits), `city-roofs.jpg` (roof
coverings and details), plus `trees.jpg` (bark and foliage) and `cars.webp` (the car
skins, with alpha). Every facade, storefront, roof and foliage sheet is a 4 x 4 grid of
modules; the build finds the grid lines near the quarter marks and cuts each module a
little inside them, so no sliver of its neighbor repeats along an edge. `--review` draws
the car cuts over each car sheet. `python3 tools/build_billboard_atlas.py` (Pillow and
NumPy) scales the billboard ads into the 16:9 cells of `textures/billboards.jpg` and
writes where each one sits into `js/billboards.js`. Collision uses a spatial grid, and rays walk
it with a 2D DDA.

The panel kits (the sheets named in `KITS` in `tools/build_city_atlas.py`) are
sheets of loose panels on dark gutters. `python3 tools/build_city_atlas.py --segment
<review dir>` cuts them out along the gutter network (it needs OpenCV), writes each
panel's rectangle to `tools/city-panels.json`, and draws numbered sheets into the
review directory. Each kit sets the gray level that counts as gutter and, for sheets
whose gutters fade in places, a gap bridge that closes short breaks along a gutter
line; `PANEL_FIXES` lists the rare panels the cut still gets wrong. The last field of
each panel is its role, picked by hand: `B` window bay, `P` pier, `S` solid wall, `V`
vent, `x` unused. Roles carry over when the sheets are cut again. The normal build packs
every panel in use into `city-panels.jpg` at its own aspect ratio, scaled to a common
texel density from each kit's measured floor height.

The ground kits (`GROUND_KITS`) are road and sidewalk tiles between thin separator
lines, so `--segment` cuts them along rows and columns instead: by the separators'
color, by thin lines lighter than their surroundings, along only the lines that cross
the whole sheet, or along lines given by hand for a sheet whose separators are too
faint. Their roles are `A` asphalt, `W` sidewalk, `Z` plaza paving, `C` crosswalk, `L`
white lane line, `Y` yellow center line, `X` box junction, `O` round cover, `Q` square
cover or grate, `T` tree pit and `H` damage (cracks and potholes). The build packs them
into `city-roads.jpg`, and on the way turns crosswalks and lines so their stripes run up
the tile, crops lines to their paint and covers and pits to their outline, and evens out
broad stains on the tiled surfaces so they don't show as a checkerboard.

The structure kits (`STRUCT_KITS`) are loose pieces on a charcoal background, cut like
the facade panels but keeping sparse shapes such as towers, piers and lamp posts. Their
roles are `D` road deck, `K` track deck, `F` concrete slab, `B` barrier, `G` girder face,
`C` column, `S` block or pile cap, `L` cable bundle, `T` truss, `R` railing, `U`
balustrade, `H` hanger, `N` steel bent, `M` lamp post, `P` pier, `W` tower and `Y` pylon.
Tiles are packed as they are; the rest have the background keyed out into the atlas's
alpha, so trusses, railings and balustrades draw as see-through cards (and cast
see-through shadows). Piers, towers and pylons also have their outline traced into
`OUTLINES` in `js/cityTiles.js`, holes included, and the city extrudes them into solid
slabs with the piece on both faces. Bridges size their towers and pylons from these
outlines, so the deck always passes through the opening under the crossbeam.

## Destruction

Everything the mech can shoot in the playable city can be shot apart: buildings and towers,
their cornices, penthouses, billboards, solar panels and the old timber water towers on the
walk-up and prewar roofs, lamp posts, signals, kiosks, subway entrances, the El and the
elevated highway. (The bridges and the distant skylines stay whole; trees have their own
physics in `js/trees.js`.) It lives in `js/destruct/`.

- **Hits carve cells.** A structure stays part of the city's merged meshes until something
  hits it. Then it is voxelized into cells of about half a meter (up to 1.25 m for the
  biggest towers). The grid lines snap to every wall, floor and setback, so cell faces lie
  exactly on the original surfaces. Each round takes its own bite:
  - machine gun, vulcan and shotgun rounds punch holes about 1.5 m across;
  - beam rifle bolts blow out holes about 3 m across;
  - rockets, grenades and missiles leave craters 4 to 10 m across;
  - the mega beam burns a trench as deep as it is held on a spot, so a sweep cuts a line
    through a building.

  Spider fire chips the city too, but less: plasma bolts, lasers, mortar shells and
  skitterer blasts.
  - Outer walls are built a little tougher than the rest: every cell facing the outside
    has a quarter more hit points.
- **Holes are cut to the pixel.** A damaged structure keeps the triangles it was drawn
  with as a skin. A 3D mask texture, one texel per cell, drops every fragment whose cell is
  gone, with torn cladding at the edges and scorch around them, and the shadow map uses the
  same mask, so light falls through the holes. Behind the skin, the cells are built like a
  building: one-cell walls of the facade's material (glass curtain wall, stone, brick or
  panel), floor slabs, a grid of columns about 7 m apart, a core in tall towers, and rooms
  between them.
  - A hole shows broken concrete with rebar, brick or shattered curtain wall, and the
    rooms behind it, lit by their ceilings (see **Ceilings and lights** below).
  - Faces are greedy-meshed one 16-cell chunk at a time, so a hit only re-meshes what it
    touched.
- **Load paths are built in.** Where one volume stands on another (a setback tier, the
  needle's shaft on its lobby drum, its pod on the shaft, a penthouse on a roof), there is a
  slab between them, and the upper walls carry on down through the rooms below to what holds
  them up. Flaring and tapering walls are one connected shell, and crowns, masts and halos
  are tied to what holds them. Nothing in a building floats free until it is cut free.
- **Structures fail like structures.** After damage, a standing structure is checked
  four ways:
  - **Islands:** cells cut off from the ground break away. After a collapse, anything else
    it left hanging in the air goes too.
  - **Sections:** at each weakened level, the section that is left (walls, columns and
    core: the outer walls carry load like the rest) is analysed as an elastic section under
    the weight above it.
    - The load's offset from what is left bends the section: it squeezes harder on one side
      and pulls on the other. Pulled too hard, that side cracks open and the rest takes it
      all.
    - Every building's strength is calibrated so its most stressed intact level carries 3.4
      times its load, bending included.
    - Plan pieces more than about 8 m apart stand apart: twin towers, the bents of the El.
    - Squeezed evenly past its strength, a level crushes and the floors above drop a storey.
    - Squeezed on one side, cracked open on the other, or with the load past its edge, it
      tips over toward the damage. Blow a notch into one side of a tower's base and it
      falls that way like a felled tree.
  - **Chunks:** parts of the plan left too far from anything still carrying load down
    through the level break away with what stands over them: a corner whose walls and
    column were blown out, a run of facade over a wide breach. The more load a part carries,
    the less far the floors and walls above can reach out to hold it. What spans over the
    gap arches, so the piece that drops narrows going up, and what is left above may give
    way next.
  - **Spans:** floors, lintels and overhangs held too far from a solid path to the ground
    give way in slabs. Shoot out a run of columns and the floor above sags off.
- **Tipping is a hinge.** When a level tips, its squeezed edge crumbles back to a pivot
  line just behind where the load bears, in a burst of rubble and dust out of the stump's
  top and the falling part's foot. The top then pivots there on a hinge. It leans slowly at
  first, held by the strength left in the hinge, which grinds and groans and sheds grit.
  Then it speeds up as its weight swings out past the edge. The hinge lets go when it snaps,
  when it slides off its edge, when the stump under it goes, or when the gap the crumbled
  edge left closes under the falling part's foot. From there the part pivots on its front
  edge and topples.
- **Neighbors don't hold each other up.** Buildings in a row stand flush against each other,
  but a piece that breaks away gets no support from the walls it was flush against, its own
  stump's sides or the building next door. It slides down them freely until it leans or
  pushes into them, and then it collides as with anything else.
- **Nothing broken is left standing.** A block pancaking down crushes everything under its
  whole footprint, hollow or not, so a tapering shaft doesn't slide down inside the wider one
  below. Walls a cell thick and columns that a collapse left standing free topple a moment
  later, if they are taller than they could stand unbraced (about 16 times their thickness,
  8 to 18 m; steel twice that). Masts, poles and parapets built that way are left alone. Skin
  backed by nothing that is left disappears with it, torn edges and all: cladding hangs into a
  hole only from wall still standing, so a felled tower leaves no outline of itself in the air.
- **Falling pieces are rigid bodies** (`physics.js`). Each is a voxel grid with mass and
  inertia summed over its cells. It collides through probes on its outer corners against
  the street, unbroken buildings, damaged ones and other pieces, with friction, warm
  starting and sleep.
  - **Contacts crush.** Where a contact presses harder than the material can take, both
    sides grind away. A toppling top chews through the edge it pivots on and goes over,
    or wedges itself against the next building.
  - **Pancakes.** A block that drops onto what is left of a building crushes down through
    it storey by storey, as real towers do.
  - **Shattering.** Hard landings break pieces along jagged Voronoi cracks. The cracks
    cluster around the impact, so a falling tower's far end may survive as one big block
    leaning on the street.
  - **What they hit.** Pieces carve whatever they land on, up to three places a step, which
    can bring that down too. How much each impact crushes goes by the energy it brings
    there: the piece's mass at that point and the speed it came in at, so by how far it
    fell. A slab off a roof dents the street; a toppling tower's top caves in the building
    it lands on.
    They crush cars, lamp posts, spiders and scorpions, tear out trees, and hurt the mech.
    Spiders on a piece that breaks away fall off it, and roof-garden trees topple when the
    roof under them goes. Loose trees roll on broken floors and against standing walls.
- **Rubble and dust:** up to 2,400 tumbling chunks (900 on touch devices), shaped by
  material: rocks, glass shards, timber splinters and steel rods. Collapses throw out dust
  surges, and straining levels groan and shed grit before they go.
- **Shrapnel:** explosions also tear big chunks off what they hit, slabs of wall and floor
  one to three meters across and lengths of twisted steel, thrown hard out of the crater:
  one for about every twelve cubic meters blown away, so a bigger hole throws more.
- **What's inside comes out:** people and furniture fill the floors round a hole and spill
  out of it (see **People** under **The city**).
- **The mech walks into what it breaks open.** It stands on broken floors and climbs
  rubble.

- **It keeps the frame rate.** Hot loops run on typed arrays with no per-cell allocation.
  Strength calibration weighs only the levels whose section changes. A blast that reaches
  several unbroken buildings turns them into voxels nearest first, within a per-frame budget
  (12 ms, 7 ms on touch devices), and carves the rest a frame or two later.

### Ceilings and lights

Blow a building open and its floors are lit, each its own way. `js/destruct/ceilings.js`
draws the ceilings per pixel in the broken faces' shader, so they cost no geometry.

- **A theme per building.** What a building is clad in picks its theme, and the theme
  picks a house set of fixtures, tiles and diffusers:
  - glass towers get modern flat LED panels and linear lights in fine tiles, cool white,
    or tech floors of perforated metal pans with slots of light run end to end;
  - concrete and panel blocks get offices of louvered and basket troffers in speckled
    tile, or institutional prismatic lenses with grilles and returns;
  - prewar brick and stone get old troffers and warm tubes, water-stained tiles, more dead
    tubes and the odd failing ballast.
- **A layout per floor.** Fixtures sit on the 0.6 m ceiling grid, square ones in one
  module and long ones in three or four. Runs of one to four floors share a tenant's layout:
  the fixture, its spacing, whether rows run end to end or stagger, and which way they
  run. Every floor then shifts, turns or respaces it and mixes its own tiles and vents.
  The lowest floor is a lobby of bright, widely spaced panels, and now and then a vacant
  floor is left dark. The layouts are a float texture with one texel per grid layer, which
  the shader decodes.
- **The fixtures light the rooms.** Floors, walls and columns add the light of the four
  fixtures of the ceiling over them, with the fixtures' tint, and the tiles round a fixture
  glow. Little of the sky reaches that deep into a building, so a room with its power off
  is dark.
- **Power.** A big hit makes the whole building flicker: fixtures cut in and out and the
  supply dips, then it settles. Round the hit, fixtures crackle out with a shower of blue
  sparks from the ceiling and stay dead. A fixture whose piece of ceiling is shot away goes
  out. A level giving way browns out what is left standing. A piece that breaks away loses
  its supply: its lights sputter and die one by one as it falls.

`tools/build_ceiling_atlas.py` cuts the fixtures, tiles and vents out of the sheets in
`textures/ceiling-src/` (a light is trimmed to its opening in the T-bar, which the shader
draws itself) and packs them into `textures/ceiling.jpg`. It writes a glow map of only the
lit diffusers to `textures/ceiling-glow.jpg` and the slots and theme tags to
`js/ceilingTiles.js`.

The test script `tools/tests/destruction.js` (headless Chromium through Playwright) runs
these scenarios: bullet holes, a tower cut past halfway, a pancake collapse, props, the
needle felled by missiles into one side of its base, a building dropped between its flush
neighbors, a building corner blown out, the El, walking into a breach, activation cost of
the biggest structures, real weapons, ceilings of each theme with a blast and a slice
through them, and a soak with the swarm. It prints timings and
writes screenshots to `tools/tests/out/`. On a machine without a GPU or without access to
the CDN, `SIM=1` runs game time without rendering between screenshots, and `THREE_DIR`
serves a local copy of the three.js package.

## Spider-frames

The enemies are six-legged spider machines cut from the spider texture sheets.
They're big (a stalker's body alone is longer than the mech is tall) but weak
alone (one beam rifle bolt, one missile or a short burst drops most of them; the
big Lancers and Bombardiers take two bolts). They come only when
[summoned](#summoning), dropping out of portals in the sky:

- **Variants:** each kind has its own palette, proportions, tactics and weapon.
  Every one of them has the same glowing red eyes.

| Variant | Palette | What it does |
| --- | --- | --- |
| **Stalker** | Gunmetal, red glow | The all-rounder. Crawls the towers, leaps between perches, fires plasma bursts, and charges a red laser from its perch. |
| **Skitterer** | Rust, toxic green glow | Small, fast and fragile. Rushes the mech in packs of two to four along streets and walls, pounces on it from up to 60 units away (even off a wall), and bursts on contact. It also bursts when shot, hurting anything nearby, mech and spiders alike. |
| **Weaver** | Bone white, cyan glow | Long-legged with a long abdomen; leaps the most. Spits pairs of web globs that slow the mech and its boost regen for about three seconds. Dashing tears free faster. |
| **Lancer** | Blue steel, violet glow | Big and slow, with a dorsal lance over its head. Climbs high and perches far off (55 to 170 units), then charges a heavy violet beam for 1.7 seconds. Takes two rifle bolts. |
| **Bombardier** | Brass, orange glow | Bulbous mortar sac. Stays on rooftops and lobs shells at where the mech is heading. A pulsing orange ring marks each landing spot. Takes two rifle bolts. |
| **Broodmother** | Near black, magenta glow | A boss two and a half times a stalker's size with 320 HP. Fires five-bolt fans and sets down pairs of skitterers every seven to ten seconds. |

- **Weapons:** plasma bolts are led at the mech. Lasers show a flickering aiming
  line while they charge, lock just before they fire, then burn along that line,
  so a dash at the right moment dodges them.
- **Armor:** the mech has 1000 AP, regenerating after four seconds out of
  contact. The raised shield turns away hits from the front. Hits flash the
  screen edges and show arcs around the reticle pointing at the shooter. At 0 AP
  the frame is destroyed; **Redeploy** starts again in an empty city.

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

## Medium spider-frames

Twice the size of a stalker, slow, and built to soak up fire: 170 to 300 HP, six
to ten beam rifle bolts or two or three bazooka hits. They're too heavy to leap.
To get from one roof to the next a medium spider bridges: it walks to the edge
facing the next roof and, if the gap is within its leg span and the roofs are
close enough in height, stretches across, rear feet gripping one roof and front
feet the other, until its body is over. A gap too wide (any street) means
climbing down, crossing and climbing up the other side.

| Variant | Palette | What sets it apart |
| --- | --- | --- |
| **Bulwark** | Brass, amber glow | A riot-shield plate over its face turns away three quarters of direct fire from in front, and 40% of blasts. Fires twelve-round gatling bursts. Flank it, or shoot it from behind. |
| **Mender** | White, green glow | Keeps near the other frames and plays medic: a green beam from the emitter on its crane arm repairs the most damaged frame within 70 units, 32 HP a second. Shoots at the mech when nothing needs fixing. Kill it first. |
| **Warden** | Blue steel, gold glow | Raises a shield dome (240 HP) over itself and whatever stands near it. Shots from outside stop on the dome, blasts outside it don't reach in, and missiles can't lock onto it. Broken, it comes back eight seconds later. Step inside it, or break it and finish the Warden before it's back. |
| **Magnetar** | Silver, red trim, blue glow | Two spinning coils on its back charge a tractor beam that holds the mech for three seconds and drags it toward the Magnetar a little faster than the mech can walk. Dash to pull away. |
| **Quarrier** | Sandstone, orange glow | Tears a boulder out of the roof it stands on, holds it overhead and hurls it at where the mech is heading. The boulder smashes what it lands on (about 57 AP on a direct hit). |

`js/mediums.js` gives them their goals, their bridging and their gear; the
spider code in `js/spiders.js` walks and draws them like any other spider.

## Riftlings

Small six-limbed swarm predators from the Riftlings asset pack
(`assets/riftlings/`), about 2 m tall: a split crest, scythe arms and a barbed
tail, in neon green, orange, purple or blue. They only come from the summon menu,
up to two hundred at a time, each through its own small portal.

- **Hunting:** each one lands, sometimes stops to scream, then runs at the mech
  (or at an allied tank that is a good deal nearer), weaving and keeping apart from
  the rest of the brood. A wall in the way gets climbed and the riftling comes over
  the roof; at a roof's edge it takes a running leap for the next roof or drops to
  the street. From a few strides off it leaps at the mech's chest.
- **Attacks:** close in, they slash at the mech's legs, about 2 AP a slash, so one
  is a nuisance and a hundred wrapped round the mech will strip it in seconds. Their
  hits are handed to the mech once a frame, as one hit.
- **Weak:** 8 HP, so anything kills one. The mech's footfalls squash any under its
  feet, a hard landing squashes a wider ring, and a dashing mech bowls them over.
  Bodies lie for seven seconds, then sink away.

`js/riftlings.js` is the game side; the model and its thirteen animations are the
pack's, posed on the GPU from a baked pose texture, so the whole brood is one
instanced mesh and one draw call.

## Scorpion-frames

Eight-legged ground hunters built from the same spider sheets and palette swap,
summoned the same way, and bigger than the spiders: a Burrower's raised tail
stands as tall as the mech, and an Emperor's more than twice as tall. They don't
leap or shoot from the rooftops. They drop out of their portals onto the street
or a roof and come straight for the mech to fight up close:

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
scorpions chasing a mech up a tower end up lined along the wall with their heads
at the 100 ft mark. They can still climb over buildings shorter than that, but a
mech on a higher roof, or high in the air, is out of reach of everything but
their ranged attacks. Their pincers do reach a little past the line, so a mech
standing right at the edge of a roof just above it can still be clawed.

| Variant | Palette | What sets it apart |
| --- | --- | --- |
| **Burrower** | Desert tan, amber glow | Dives into the street and tunnels at the mech, untargetable, straight under buildings, while the street heaves above it. A pulsing ring marks where it will burst out 0.6 seconds later, pincers first (24 AP). |
| **Prowler** | Black | Runs dark: its lights go out and neither the lock-on button nor missile locks can find it. It swings wide round the mech to strike from behind, where the shield can't help and its hits do 50% more. Its lights flare whenever it strikes or is hit. |
| **Berserker** | Dark red | Tougher (two rifle bolts). Below half its armor it goes berserk: glow flaring and venting red steam, it moves half again as fast and strikes and recovers far quicker. |
| **Venomtail** | Neon green | Its sting injects venom that eats 7 AP a second for six seconds and holds off armor regeneration; its pincers inject a little too. Lobs pairs of venom globs from range, or at a mech out of reach. |
| **Shocktail** | Neon blue | Its sting shorts out the mech's boost (45 drained, regen stalled). From range, and at a mech out of reach, it charges and arcs jagged lightning from its tail that drains boost too. |
| **Scorcher** | Neon orange | Sprays a stream of fire from its tail that drags after the mech's legs, burning it while it stands in the stream and setting the street alight. Burning patches last a few seconds. |
| **Emperor** | Royal purple, gold trim | Nearly twice the size of the other scorpions, with 160 HP and hits half again as hard. Its pincer seizes the mech and pins it for 1.8 seconds (dash to break free three times faster) while it reels itself in and stings. |

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

## The millipede

Summoned, a black robotic millipede hundreds of feet long crawls out of an upright
portal (see [Summoning](#summoning)) along the rooftops and settles draped across two or three city blocks near the mech: it lies on the
roofs, sags over the streets between them, and grips roofs and facades with two
pairs of legs under each of its ten armored sections.

- **Armor:** each section carries three layers of plates: black, then steel, then
  bronze. Weapons break plates off one at a time (they tumble off the body), the
  outer ones first; a plate with another still over it takes only a fifth of a
  blast. Nothing else wears them down: not the roofs it lies on, not its own
  coils. The keel underneath never comes off.
- **Reactor cores:** a hole through all three layers over the middle of a section
  opens its reactor core, a rainbow gem in a cage. A few more hits destroy it and
  the section goes dark. Roughly four bazooka hits per core, or a missile salvo on
  one spot.
- **The head** can't be hurt while any core still burns. Raised on its neck at the
  front of the body, it watches the mech, fires five-bolt plasma fans and bites
  anything that comes close.
- **Breaking loose:** with the last core gone, thrusters in its neck light, the
  head tears free, climbs, flies off a fair way, turns and hunts the mech from the
  air with twin solid red beams from its eyes. They charge for a second, then burn
  for three, dragging after the mech (walking won't shake them, dashing will) and
  carving through whatever buildings they cross. The head takes 1900 damage,
  about fifteen direct bazooka hits.
- **Death:** the dying head rams through twenty to thirty buildings, tearing a
  tunnel through each, then climbs, spins faster and faster, and blows apart in a
  huge explosion with fireworks and a ring of smoke rolling out. The rest of the
  body goes up section by section.

The boss bar counts its reactor cores, then the head's armor.

### How it's built

`js/millipede.js` plans its route from its portal (see [Summoning](#summoning)):
a straight run back through the portal for the body still to come, and a gentle
arc forward from it. Over the arc it lays the tightest drape: the lowest line over
every roof it passes that never slopes more steeply than 0.65, starting from the
portal's height. Of 90 tries it takes the one in view of the mech that lies most
on roofs, low and smooth, and clear of the mech, then crawls the body out along it. Each section is a rigid piece laid along the drape
and lifted until it clears every roof under it, with a ribbed sleeve over each
joint.

The 1260 plates are curved tiles in three instanced meshes, one per layer. Shots
are tested against each section analytically: the ray moves into the section's
frame and meets the three armor cylinders, the keel, the core and the end frames
in turn, so it stops on the first plate still there, or on the core through a
hole. Blasts reach every plate in range, shielded by whatever is still on top.
The legs reuse the spider atlas plates and two-bone IK, finding holds on roofs,
walls or nothing (they dangle). The head is built from primitives with the body's
own plates on its crown; it's a target of its own, armored until the cores are
gone.

## Insertion

Every deploy starts with the frame slung under a **Kestrel H heavy lifter**: a gunmetal
variant of the Kestrel dropship, half again its size, with ducted lift fans in place of the
rocket pods and a cradle under the belly whose clamp arms hold the mech by the shoulders.
There is no control during the flight, about twenty-three seconds behind letterbox bars with a
release countdown:

- It starts some 250 meters up over the harbor south of the city, the skyline ahead, and
  swoops down onto the line of an avenue, pulling out just over the traffic at the seawall.
- From there it threads the streets between the towers with the mech's feet some twenty
  meters over the road: up the avenue, a left onto a cross street through the tallest
  canyon, a right, a left past the twisting supertall, and a wide right over the starting
  plaza that brings it to a hover with its nose north. It banks into every turn, dips its
  nose as it speeds up and lifts it as it brakes, and bobs gently as it goes.
- Its line and pace are worked out each time from the city: the route is counted in blocks
  from the plaza and runs down the middle of the gap the buildings leave in each street, its
  corners are arcs tight enough that the wings clear the towers, it never drops below what
  clears every roof under its wings, and it slows for each turn and speeds up out of it,
  every change of pace eased so none is sudden.
- The camera starts off its right flank over the water, swings in behind it as it reaches
  the city and rides its line through the streets, hanging back further the faster it goes,
  and eases into the usual over-the-shoulder view by the release.
- The clamps open about seven meters up and the frame drops onto the plaza; it is the
  player's from the moment it lets go. The lifter climbs straight out of the towers and
  flies off north. The swarm can't touch it.

## Allies

Packs of three to ten **Kestrel assault lifters**, each with a **Bastion armored carrier**
slung under it, fly in about every minute (the first a quarter of a minute after the
release), mostly over the harbor, sometimes over the rivers east or west. Both are the
models from the Riftlings preview (`assets/riftlings/preview.html`), ported to
`js/vehicles/models.js`.

- **Kestrels** fly in a V at a height that clears every roof on the way, split up over the
  city, each to its own street: a crossing or the middle of a block 40 to 260 m from the
  mech, with open sky over it (never under the El or the highway). Over its spot a Kestrel
  turns to lie along the street, comes straight down between the buildings, sets its tank
  down, and climbs back out over the skyline. While it is low its chin turret covers the
  street in short bursts.
- **Bastions** drive the street grid, keeping to the right of the road, from crossing to
  crossing toward the nearest bug, or back toward the mech when there is none. They stop to
  shoot at whatever they can see within 175 m, leading it, with twin guns that elevate to hit
  bugs on walls and roofs, and roll over cars and flatten them. Tanks give each other room,
  and one that can't get past rubble or wrecks marks that block and finds another way.
- **The swarm hunts them back.** A spider, scorpion or medium frame goes after a tank or
  Kestrel that is a good deal nearer than the mech: it crawls, perches and aims at it, and
  its plasma, lasers, mortar shells, pounces, pincers and stings land on it. Bosses keep to
  the mech. A Bastion has 150 armor; wrecked, it burns for half a minute with its turret
  blown off its ring. A Kestrel has 300; shot down, it spins in burning and crashes, and a
  tank still under it is lost with it. Only the Kestrel H carrying the mech is safe.
- Tank kills don't count toward the mech's kills or light its hit marker. There are at most
  16 tanks and 12 Kestrels at once (10 and 8 on touch devices), drawn as instanced meshes:
  one per part and material of each model, posed per copy, so a whole pack costs a few dozen
  draw calls.

The headless test `tools/tests/allies.js [frames|drop|tanks|soak]` checks the frame select
and loadout screens on a desktop and a landscape phone, flies an insertion and checks the
landing, forces a pack in and watches the tanks fight the swarm (and a Kestrel shot down),
and plays two minutes in real time for the frame rate. Screenshots go to `tools/tests/out/`.

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
| `js/atlas.js` | Texture loading, box-projected atlas UVs, geometry helpers, ink outlines and merging rigid parts, paints and skins |
| `js/mech.js` | Mech model, gimbaled bell-nozzle thrusters with plume shaders, IK foot-planting gait, dash/jump/aim animation |
| `js/frames.js` | The frames in the hangar (FS-07A Vanguard, HV-02 Obsidian): armor, speeds, boost, and how each is built |
| `assets/heavy-frame/heavy-mech.js` | The HV-02 Obsidian: new armor on the stock rig (subclasses `Mech`) |
| `js/weapons.js` | Weapon definitions and models, projectiles, homing missiles, lock-on |
| `js/fx.js` | Instanced billboard particles (smoke, fire, sparks), explosions, light pool, decals |
| `js/city.js` | Port Meridian: street grid, buildings, houses and row houses, roofs, parks, the forest, street furniture, elevated railway and highway, waterfront, bridges, distant scenery |
| `js/trees.js` | Trees: species, textured trunks and crowns instanced by chunk, uprooting, rigid-body tumbling and rolling, burning |
| `js/cars.js` | Cars: bodies shaped to their skins in the vertex shader, parked cars, lane-following traffic that turns and respawns |
| `js/people.js` | People: fifty models, the rig and its animations, sidewalk walkers, panic, building occupants, falls and splats |
| `js/furniture.js` | Furniture: sixteen modeled pieces, furnishing broken floors, thrown and tumbling pieces |
| `js/train.js` | The El's trains: the route, derailing where the track is gone or blocked, wrecks as rigid boxes that pile up |
| `js/kitTiles.js` | Generated: the facade, storefront and roof kits, tree tiles and car skins with their measured outlines |
| `js/cityTiles.js` | Generated: atlas layouts, tile positions, the facade, ground and structure panels and kits, and the traced outlines of solid structure pieces |
| `js/post.js` | Post-processing for High and Ultra: the offscreen scene, the glow pass and bloom, heat shimmer, sun glare, god rays, ambient occlusion, the grade |
| `js/world.js` | Sky and clouds, haze, lights, spatial collision grid (colliders, moving cars and trees), raycasts (through voxel structures and falling pieces), damage routing, filling broken buildings |
| `js/destruct/destruct.js` | Destruction: activating structures, damage, structural checks (islands, bending sections, chunks, spans, remnants), tipping on hinges, breaking away, crushing, shattering, rendering budgets |
| `js/destruct/grid.js` | Voxel grids on lines snapped to the original surfaces, materials, ray marching and push-out |
| `js/destruct/voxelize.js` | Turns a city owner's recorded volumes into walls, floors, columns, cores and rooms |
| `js/destruct/skin.js` | Original triangles lifted out of the city meshes, masked per pixel by a 3D cell texture (and in shadows) |
| `js/destruct/mesher.js` | Greedy mesher for broken faces and the rooms behind them, chunk by chunk |
| `js/destruct/physics.js` | Rigid voxel bodies: probes, contacts, sequential-impulse solver, hinges, sleep |
| `js/destruct/debris.js` | Instanced rubble chunks that tumble, bounce and settle |
| `js/destruct/textures.js` | Painted atlas for broken materials, office floors, ceiling tile and plaster; the broken faces' material |
| `js/destruct/ceilings.js` | Ceiling themes, per-floor layouts, the ceiling and room-lighting shader, and the lights' power: flicker, outages, pieces going dark |
| `js/ceilingTiles.js` | Generated: slots of the ceiling atlas and the theme tags of its fixtures, tiles and vents |
| `tools/tests/destruction.js` | Headless destruction scenarios: timings and screenshots |
| `tools/tests/allies.js` | Headless frame select, loadout, insertion, tank drops and the tanks' fight with the swarm: checks and screenshots |
| `tools/tests/summons.js` | Headless summon menu, cooldowns, every kind's portal drop, the riftling rain and the millipede's portal: checks and screenshots |
| `js/spiders.js` | Spider-frames: variants and palettes, instanced model, surface crawling, tripod gait with IK legs, jumps, falls from portals, plasma, webs, mortars and lasers, and the summoned swarm's bookkeeping (spiders, scorpions, riftlings, the millipede); which foe each one goes after (the mech or an ally) |
| `js/summons.js` | The summon menu's list of monsters, where their portals open (800 ft ahead, in clear sky), the staggered drops and the one-minute cooldowns |
| `js/portals.js` | Summoning portals: instanced vortex and halo shaders, opening, holding and closing, embers |
| `js/riftlings.js` | Riftlings: the asset pack's instanced swarm wired into the game: falling, running, climbing, roof leaps, pounces and slashes, being squashed and shot |
| `js/allies.js` | The Kestrel H insertion, packs of Kestrels setting Bastion tanks down, tank driving and gunnery, what the swarm does to them, and the instanced fleets that draw them |
| `js/vehicles/models.js` | The Kestrel dropship (and its Kestrel H heavy-lifter variant) and the Bastion armored carrier, from the Riftlings preview |
| `js/scorpions.js` | Scorpion-frames: variants and palettes, instanced model with a CCD tail and pincers, melee AI, the climb limit, and each kind's ability |
| `js/mediums.js` | Medium spider-frames: variants, bridging between roofs, gear, shield domes, repair and tractor beams, thrown boulders |
| `js/millipede.js` | The millipede: rooftop route and drape, sectioned body, three-layer plate armor and reactor cores, legs, the head's flight, eye beams, ramming and finale |
| `js/frameParts.js` | Shared by spiders, scorpions and the millipede: plates and hulls cut from the spider atlas, the palette-swap material, leg rigs and IK, beams, the mech's hit capsule |
| `js/spiderParts.js` | Generated: where each spider part sits in the spider atlas, with its traced outline |
| `js/audio.js` | Synthesized Web Audio sound effects |
| `js/music.js` | Soundtrack playlist: title theme, shuffled rotation, volume drop after the title |
| `js/boot.js` | Entry point: downloads the title theme, then loads the title screen and the game |
| `js/input.js` | Keyboard, pointer lock and touch controls |
| `js/ui.js` | HUD (armor, hostiles, damage indicators), the summon menu, frame select cards and hangar menu |
| `js/main.js` | Renderer, world scale, player physics and armor, frame swaps, the screens from intro to drop, camera (and the insertion's), game loop, game over |
| `js/title/title.js` | Title screen: tap/click/key to start, fade out, portrait handling |
| `js/title/logo.js` | Live 3D VECTORCLAD logo (from the brand kit) |
| `js/title/wordmark-data.js` | Generated: wordmark geometry and brand palette |
| `tools/build_city_atlas.py` | Packs the city texture sheets into atlases and cuts the facade, ground and structure kits |
| `tools/build_asset_atlas.py` | Packs the asset packs in `assets/`: facade, storefront and roof kits, tree tiles, and the car nets cut into pieces and measured |
| `tools/city-panels.json` | Each facade, ground and structure panel's rectangle on its sheet and its hand-picked role |
| `tools/build_spider_atlas.py` | Traces the spider parts out of their sheets and packs them into an atlas and glow map |
| `tools/build_ceiling_atlas.py` | Cuts the light fixtures, ceiling tiles and vents out of their sheets and packs them into the ceiling atlas and glow map |
| `tools/build_music.py` | Encodes the soundtrack WAVs to the MP3s in `audio/music/` |

The atlas mapping in `atlas.js` (`mapUV`) assigns each triangle to one of six
directions by its normal and maps it into the region chosen for that direction,
cropping the region to the face's aspect ratio so panels never stretch. To
re-skin a part, change the region names passed in its `faces` object.
