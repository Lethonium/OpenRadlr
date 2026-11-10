# 22. Bots as characters with tactics, spawned around the riders

Date: 2026-11-10 · Status: accepted

## Context

Bots kept every route at a fixed twelve riders. Each one:

- got a random "Adjective Animal" name and riding style;
- rode a fixed share of its FTP;
- spawned wherever its route was emptiest.

They never reacted to humans. On longer routes a rider was mostly alone, and meeting a bot changed nothing (#64).

## Decision

- **A cast, not random bots.** A bot's name is made up from fixed lists: a first name and a cycling pun for a surname ("Gus Tailwind"), so no real person or film character is borrowed. Its riding type (rouleur, climber, sprinter, attacker, tourer) and its team follow from a stable hash of the name, so the same name rides the same way everywhere. Fitness is still matched to the humans online.
- **Moves within an energy budget.** Each bot does one move at a time: ride, pull, swing off, attack, answer, sprint or recover.
  - Moves start from what the bot sees: a line ahead, a rider coming past, a wheel behind, a human close by.
  - They end on time or on energy. Energy is the W′ balance of the critical power model, with Skiba's recovery time constant, and FTP serves as critical power.
  - Attacks and answers need a human close by (or a race), so bots alone on the map ride quietly.
  - Moves only change power and lane choice. The physics, drafting and races are untouched.
- **Spawning follows the humans.**
  - A route's target is `max(target_riders, humans × (1 + bots_near_human))`, capped at `max_route_riders`. `target_riders = 0` still means no bots.
  - Every human riding freely keeps `bots_near_human` bots within a window: 1.5 km ahead, 400 m behind.
  - Missing company spawns in groups, out of sight. Mostly the groups are ahead and a bit slower (to chase), sometimes behind and a bit faster (to come by).
  - On a full route, bots far from everyone make room.
- **The wire stays additive.** Bots' rider entries gain `team`, `style` and `move`. No version bump: older clients ignore them.

## Consequences

- **Every ride has company and something happens.** In a simulated hour on Col de la Forge, the rider was alone (no bot within 300 m) for 29 s instead of half the hour, with about one move nearby every four minutes.
- **The bot count changes with humans online.** A route with five riders keeps up to 35 riders instead of 12, so the per-tick cost of bots grows. `max_route_riders` (48) bounds it.
- **Bots now spawn in groups,** so the old test "bots start apart" became "groups start apart".
- **Bot tuning lives in `bot.rs` (`tactics`) and `SimConfig`.** Further characters (rivalries, a bot remembering you) can build on the stable cast.
- **Overlap with #17:** the spacing and passing PR (#17) touches the same files. The two combine (moves set power and a lane wish; spacing caps speed and steers past), but whichever merges second needs a rebase.
