# Bots with character: design

## Why

Bots today are interchangeable. Each one:

- is called "Adjective Animal";
- rides a fixed share of its FTP with some noise;
- changes lanes only to catch a draft;
- spawns wherever the route is emptiest.

A rider meets a bot, overtakes it and never sees it again. Nothing happens between them. On a long route the twelve bots per route are kilometres apart, so you mostly ride alone.

The rethink has four parts:

- **who the bots are:** names, a riding type, a team kit;
- **how they ride:** moves, limited by how much energy they have left;
- **where they appear:** around the riders who are online, in groups;
- **how many there are:** unchanged, `OPENRADLR_TARGET_RIDERS` per route; company comes out of it.

The aim is that every ride has someone to chase, someone to ride with and now and then someone who attacks you.

## Who the bots are: a cast

- **Names:** each bot is a made-up character: a first name and a cycling pun for a surname ("Gus Tailwind", "Penny Farthing", "Sally Sprocket"). There are 40 first names and 40 surnames, 1,600 names in all, enough for any server (a route holds at most 200 riders). Invented names borrow no real person and no film or TV character, so there are no rights or trademark questions.
- **Easter egg:** about one new bot in 200 is "Goldie Lemon", who always rides in Team Zitrone's lemon yellow, after the golden lemons on the road.
- **Fixed per name:** a character's **riding type** and **team** come from a hash of their name. So "Gus Tailwind" is always the same climber in the same kit, on every server and in every session, and riders get to know them. Fitness is not fixed: it is still matched to the humans online.
- **Always marked:** bots stay marked as bots everywhere (`is_bot`, the "bot" badge). Only the name changes.
- **Same source everywhere:** studio and seat bots take their names from the cast too, so they look the same everywhere.

### Riding types (archetypes)

| type | share | weight | W′ | base pace | uphill | what it does |
|---|---|---|---|---|---|---|
| rouleur | 30% | 68–82 kg | 15 kJ | 0.72 FTP | +0.10 | rides on the front of a group (Pull), then moves aside (Swing off) |
| climber | 20% | 52–64 kg | 14 kJ | 0.66 FTP | +0.22 | attacks near climb tops |
| sprinter | 20% | 72–88 kg | 22 kJ | 0.68 FTP | +0.06 | sits in, goes for sprint lines and finishes |
| attacker | 15% | 60–74 kg | 18 kJ | 0.70 FTP | +0.12 | attacks riders near it, answers riders who pass |
| tourer | 15% | 60–95 kg | 10 kJ | 0.58 FTP | +0.06 | easy company, never races anybody |

Rules that apply to every type:

- Descents stay at 0.35 FTP.
- Races ride at 0.95 FTP.
- Group rides ride at 0.75 FTP and make no moves.
- The race-finish kick stays as it is today.

### Teams

There are eight fictional teams, each with a kit colour:

- Zitrone (yellow)
- Moos (green)
- Kirsche (red)
- Lavendel (purple)
- Kreide (chalk white)
- Schiefer (slate black)
- Petrol (teal)
- Rosé (pink)

None of the colours is orange (me) or sky blue (humans). In the 3D view, a bot's jersey has its team's colour instead of the grey all bots shared before. The 2D view keeps the grey dots: it is being redone in #38.

## How bots ride: moves within an energy budget

### Energy (W′)

Every bot carries a **W′ balance** from the critical power model:

- **Critical power:** the bot's FTP.
- **Riding above it** spends W′: (P − CP)·dt joules.
- **Riding below it** recovers the deficit exponentially, with Skiba's time constant τ = 546·e^(−0.01·(CP − P)) + 316 s.

A bot with an empty tank cracks and has to recover. A strong human can therefore wear down an attacker by following it, the way it works in real racing.

### Moves

A bot is always doing exactly one move. **Ride** is the default. The other moves end after a while or when the bot's energy runs low, and then the bot goes back to Ride or into Recover.

| move | power | how it starts | how it ends |
|---|---|---|---|
| Ride | base pace (types above); 0.55 while waiting for its group | default | — |
| Pull | ≥ 0.85 FTP | a rouleur (or, now and then, another type) with a wheel behind it for 10 s and clear road ahead | after 30–60 s, then Swing off |
| Swing off | 0.60 FTP, one lane over | after a pull | when the rider behind has come past, or after 20 s |
| Attack | 1.30–1.60 FTP by type | a climber within 600 m of a climb's top (an attacker within 300 m); an attacker near a human on the flat (about once in 4 min) | after 20–45 s, or when W′ drops below 15% |
| Answer | 1.25 FTP | someone (a human, or anyone in a race) passes within 8 m at least 0.8 m/s faster; the chance depends on the type | once on the passer's wheel (gap < 5 m), after 25 s, or when W′ drops below 30% |
| Sprint | 1.9 FTP (sprinter), 1.5 (others) | within 200 m of a sprint line (sprinters 250 m) with a human within 150 m, or in a race | after the line, or when W′ runs out |
| Recover | 0.55 FTP | after Attack, Answer or Sprint | after 30–60 s, or when W′ is back above 70% |

Limits on starting a move:

- Each line (sprint or summit) is contested at most once per pass.
- A move starts only from Ride with enough W′: more than 50% for an answer, 40% otherwise.
- Bots in a vehicle and bots in a group ride never make moves.
- Attacks and answers happen only near humans (within 80 m), or in races. Bots alone on the map don't spend their energy where nobody is watching, and the world stays calm.

### Lanes during moves

- **Attack, Answer and Sprint:** the bot moves into a neighbouring lane that is clear for 10 m ahead, if its own lane is blocked.
- **Swing off:** the bot moves to a neighbouring lane.
- **Otherwise:** the existing draft-seeking lane choice applies.

## Where bots appear: company and groups

### Groups

Bots spawn in groups of 2–5 (a single bot now and then):

- **Levels:** within ±3% of each other.
- **Line-up:** in rows across the lanes, 2.5 m apart.
- **Waiting:** a group member that gets more than 25 m ahead of the rest of its group, with none of them close behind, eases off (Ride at 0.55). Moves ignore this. A group therefore stays together until somebody attacks.
- **Breaking up:** a member more than 300 m from the rest rides solo from then on.

### Company

Every human riding a route keeps company. "Riding" means on the route: not in a workout, a race, an event or a vehicle.

- **The goal:** at least 6 bots (`bots_near_human`) around them: up to 1,500 m ahead (`company_radius_m`) or up to 400 m behind (`company_behind_m`). Bots further back have been passed and no longer count, so a new group takes their place ahead.
- **Topping up:** when a human has fewer, groups spawn for them, at least 350 m from every human (`spawn_clear_m`: out of sight, so nothing appears in view).
- **Ahead (70%):** 350–800 m ahead, at 0.85–0.95 × the human's level. The human catches them within a few minutes: a group to chase.
- **Behind (30%):** 350–600 m behind, at 1.05–1.15 × the human's level. They catch the human, which gives a wheel to jump on.

These numbers come from a simulated hour per route, with one rider at 75% of a 3.0 W/kg FTP:

| route | no bot within 300 m | bots within 150 m (mean) | moves called near the rider |
|---|---|---|---|
| Col de la Forge | 29 s | 3.4 | 14 |
| Riverside Flats | 330 s | 2.0 | 18 |
| Island Tour | 29 s | 3.0 | 13 |

A first try had the spawns 350–1,200 m ahead and counted bots up to 1,500 m behind. On Col de la Forge that left the rider alone for 1,696 s of the hour, with one move nearby.

### Making room

When the route is already at its target:

- a bot more than `bot_despawn_distance_m` from every human, and not keeping anyone company, is removed to make room;
- surplus bots leave as before: the one farthest from humans first, and only out of sight.

## How many: unchanged, `OPENRADLR_TARGET_RIDERS`

A route keeps `target_riders` riders, humans plus bots, as before. That's the existing `OPENRADLR_TARGET_RIDERS`: 12 by default, 75 in production. Company doesn't add bots. It moves the route's own bots: far ones make room, and groups take their place around the humans.

- With `target_riders = 0`, a route has no bots at all: the OpenBikeNet velodrome and the tests.
- With no humans online nothing changes but the groups.
- With many humans and a small target, the company is thinner: each human gets what is left, and the humans are company for each other.

A first draft grew the target with the humans (`humans × 7`, capped at a new, fixed 48). That left two settings for one thing, and with production's 75 the cap did nothing. So `OPENRADLR_TARGET_RIDERS` stays the one setting.

Simulated hours on Col de la Forge (one rider at 75% of a 3.0 W/kg FTP; the other riders started with them):

| target | humans | riders | bots within 150 m (mean) | no bot within 300 m |
|---|---|---|---|---|
| 12 | 1 | 12 | 2.7 | 64 s |
| 75 | 1 | 75 | 3.4 | 75 s |
| 12 | 3 | 12 | 2.9 | 322 s |

## Protocol (additive, no version bump)

Bots' `riders[]` entries gain three fields:

- `team`: the team id, for example `"moos"`.
- `style`: `rouleur` | `climber` | `sprinter` | `attacker` | `tourer`.
- `move`: `pull` | `attack` | `answer` | `sprint`. It is left out while riding or recovering.

Humans and remote riders never have these fields. Older clients ignore them.

## Client

- **3D jerseys:** a bot's jersey has its team's kit colour; an unknown team keeps the bot grey.
- **Rider list:** the bot badge names the riding type ("climber bot" / "Kletterer-Bot").
- **Ticker:** a pure `ride/botMoves.js` watches the riders around me and posts a line when a bot near me (same route, within 120 m) starts a move:
  - "Gus Tailwind attacks!"
  - "… goes for the sprint!"
  - "… takes up the chase!" (only when it was behind me)
  - "… comes through for a turn on the front."

  Only the start of a move counts. There is at most one line every 15 s, and each bot gets at most one line per move in 90 s.

## Not in scope

- Bots riding the network off their route, or turning at junctions.
- Bots reacting to chat.
- Persistent rivalries: a bot remembering that you dropped it yesterday. The fixed cast makes that possible later.
- Spacing and passing physics: #17 handles those. This design changes only the bots' power and lane choices, so the two combine. Whichever merges second needs a rebase in `world.rs` and `bot.rs`.

## Testing

All of these tests are deterministic and use the injected RNG:

- **Sim:**
  - the W′ model (spend, then recover with Skiba's τ);
  - each move's start and end;
  - lines contested once per pass;
  - no moves in a vehicle or a group ride;
  - a cast character's type and team are stable;
  - names are unique;
  - groups spawn together, wait for each other and split up;
  - company spawns out of sight, ahead or behind, at the right levels;
  - the route keeps its target however many humans want company;
  - `target_riders = 0` means no bots.
- **Server:** the new fields on bots, and their absence on humans.
- **Client:**
  - kit colours (none orange or sky blue);
  - the bot badge text;
  - the ticker's start-only rule, its rate limits and its distance.
