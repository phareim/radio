# Landscapes

Each landscape is a place with a sound and a painted scene. The music data
lives in `engine/landscapes/<id>.ts`; the scene in `scene/scenes/<id>.ts`.

| id | Name | Scene | Sound |
|---|---|---|---|
| `coast` | Neon Coast | Neon Shrine's home: dusk over the sea, the striped sun on the horizon, palm silhouettes, a pier with lamps, slow waves | D mixolydian → dorian → aeolian, 108 bpm. Square lead, saw pad, pluck arp, synthwave drums. Waves and gulls |
| `summit` | Mountain Top | above the clouds: violet peaks with snow catching pink light, a sea of cloud below, a cairn and a prayer-flag line, first stars | D lydian → ionian, 84 bpm. Choir pad, hollow flute lead, glass arp, half-time toms when it builds. High wind |
| `jungle` | Jungle | dense teal canopy, hanging vines, a waterfall into a pool, a mossy ruin, fireflies | A dorian, 104 bpm with swing. Marimba and kalimba, whistle lead, tribal kit with congas and shaker. Jungle birds, insects, stream |
| `frostwood` | Frostwood | deep cold forest: dark snowy pines, a pale moon, falling snow, low fog, a faint green-violet aurora | E aeolian → phrygian, 72 bpm. Dark pad with tape wow, hollow lead, sparse glass bells, heartbeat kick. Owl, snow hush, wind |
| `village` | Village | a small village at dusk: houses with lit windows, chimney smoke, lanterns on a string, a well, a church tower | F ionian → mixolydian with maj7s, 96 bpm, lazy swing. Electric piano, warm arp, brushed drums. Chimes, birds, a far bell, fire |
| `nightdrive` | Night Drive | the car trip: a coastal highway at night seen from the side, streetlights sweeping past, the city skyline ahead, the moon | A aeolian, 112 bpm. Synthwave: pluck bass 8ths, glide lead, gated snare, pumping pads. Road hum, passing cars |
| `voyager` | Voyager | space exploration: through a ship's window, a ringed planet, nebulae, drifting asteroids, a moving starfield | C lydian, 118 bpm. Berlin-school sequencer arp, FM bells, motorik drums. Radio blips, shimmer |
| `deepspace` | Deep Space | deep space quiet: near-black, very sparse stars, a distant galaxy smudge, slow drift | Bb lydian → aeolian, 60 bpm, a chord every 4 bars. Shimmer drone, glass pad, rare glass bells, no beat until the very top. Space hum |
| `neonrain` | Neon Rain | a rainy city street at night: neon signs, reflections in puddles, rain streaks, a lit noodle bar | G dorian with m9s, 84 bpm, swung. Lofi: electric piano, soft kit, round bass. Rain, city hum |
| `caverns` | Crystal Caverns | under the shrine: a cave with glowing crystals, dripping water, an underground lake reflecting the glow | D harmonic minor → phrygian, 90 bpm. Pulse lead, harp plucks, chip drums, dark pad. Drips (stream), shimmer |

Intensity names, 0–4: STILL, DRIFT, CRUISE, DRIVE, SURGE.

## Scenes for composed channels

A composed channel's music lives in the backend's database; at first it
borrows the painted scene closest to its mood (`scene` in its JSON). It can
get its own painting in `scene/scenes/<landscape id>.ts`, registered in
`scene/index.ts` and `SCENE_IDS` in `engine/catalog.ts`; then its `scene`
points at its own id. `backend/paint.mjs` does this with a Claude Code
agent (see `backend/README.md`).

| Scene id | Channel | Scene |
|---|---|---|
| `crossroads-cafe-5b44` | Crossroads Cafe | old town meets new: stone townhouses with stepped gables and a clock tower on the left, a glass tower with a lobby and a layer-meter screen on the right, the café between (CROSSROADS board, striped awning, espresso machine, a guest outside). A traffic light cycles; trams, pod cars and bikes stop for it; someone crosses on red. Lead and counter notes light old windows, arp and bells tower panes; the kick puffs the machine's steam |
| `autumn-harbour-4ce5` | Autumn Harbour | a fjord harbour at grey dawn in late autumn: snow-topped mountains with the sun rising through a saddle, a village and white church on a hill, a red fishing boat moored in the middle with its wheelhouse lit and someone in oilskins on deck, a breakwater with a blinking harbour light, a red boathouse, a bench, an old lamp and a birch dropping gold leaves on the quay; mist, gulls, a walker with a dog. Arp notes glint on the water (pitch → distance), lead and counter notes light village windows (pitch → height up the hill), bells the church; the kick breathes the lamp and mast lantern and puffs the exhaust; the chord colour tints the harbour light and pennant; intensity is wind |
