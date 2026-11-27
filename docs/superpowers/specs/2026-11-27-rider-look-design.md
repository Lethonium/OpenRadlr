# Rider look: customise your rider, unlock more with achievements — Design (short)

Issue #25, layer 1 (cosmetics). Stacked on the polished world (#144): it customises the rigged rider that PR brings.

## Intent

Riders should be able to make their rider their own, and earn more fun pieces by riding, so achievements give
something back. Nothing changes how the ride feels (no physics, no bonuses). The owner asked for (2026-11-27):

- unlocks through achievements, only some pieces open from the start;
- fun items, "like sock height";
- editing in the profile menu with a live preview;
- a pass on the rider first, because it sometimes looked strange (done: chin straps, sunglasses, hair under the
  helmet, belly instead of a hump, no UV seams).

## Approaches

1. **Look overrides on the existing look (chosen).** `lookOf(id)` already rolls height, build, skin, hair, kit cut,
   pattern, colours, glasses, gloves, bike and frame. A saved rider look is the same fields, chosen. Small new parts
   for the fun items. Others get it as a short code.
2. A separate avatar model with its own meshes. Duplicates the rig work of #144 for no gain.
3. Local only (my screen, like the classic rider). Cheaper, but the point of a look is that others see it.

## Decisions (builder's calls; the owner said "just dive in")

- **Where it lives:** per rider (`openradlr.look`, rider-scoped storage, so it is in the account backups). No server
  storage.
- **What is free:** every skin tone and hair colour (identity is never locked), hair short/long, height (1.50–2.05 m)
  and build (slim, average, strong, heavy), kits road/long/casual, patterns solid/hoops/band, every palette colour,
  helmet colour, glasses, gloves, shoes, socks low/crew, bikes road and city.
- **Unlocked by an achievement** (the existing ones; locked pieces show the achievement's name):

  | Piece | Achievement |
  |---|---|
  | Sash pattern | First ride |
  | Panels pattern | Century |
  | Skinsuit | Marathon |
  | Chevron pattern | 1000 m climbed |
  | Polka dots | 4000 m climbed |
  | Fade pattern | 10 summits |
  | Rainbow bands | 1000 watts |
  | Tall socks | 4 weeks in a row |
  | Knee-high socks | Thumb warrior (secret) |
  | Gravel bike | Tourist |
  | Gold frame | 1000 km |
  | Aero helmet | 12 weeks in a row |
  | Lemon helmet | 10 lemons |
  | Ponytail | Bendy (secret) |
  | Handlebar moustache | Both ways |
  | Classic rider and bike, cycling cap | Old School |

- **The classic rider** becomes the look's style (`modern` / `classic`); the Settings checkbox goes, an "on" stored
  there is carried into the look once. Others see it too now.
- **On the wire:** a new client message `look {look}` (a code of at most 48 characters `[0-9a-z]`), sent after
  `joined` and on every change while riding. The server keeps it per client and passes it on as `riders[].look`,
  without reading it. Additive: old clients ignore it, no protocol version bump. A code from a newer client that
  this client cannot read falls back to the rolled look field by field.
- **Colour code:** a setting "Kit colours: riders' own kits (default) / colour code". With own kits, riders with a
  look wear it (me too); riders without one keep the colour code, bots keep their team kits. With the colour code,
  everyone's jersey colour follows the code as today, the rest of the look still shows.
- **Preview:** a "Look" page in the Profile dialog: a turning, pedalling cyclist on a small canvas of its own
  (lazy-loaded with the 3D code), then the choices as chips and swatches by group (Body, Kit, Head, Bike). Every
  change saves and redraws. "Surprise me" rolls a look from the unlocked pieces. Without WebGL 2 the page shows no
  preview, the choices still work.
- **Defaults:** a rider without a saved look gets the look rolled from their rider key, so they look the same every
  ride once they open the page; until then the server id decides as today.
- **Not now:** looks in the 2D views (#145 draws baked sprites), looks on far "cheap" riders (they stay neutral, as
  now), physics accessories (layer 2), new achievements.

## Left to the builder

Exact palettes, chip layout and sizes, the shapes of the fun pieces (they must read at ride distance), and the
code's layout (versioned, one character per choice).
