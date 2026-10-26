# Shared vehicles

Ride together on one vehicle: a **tandem** (2 seats) or a **beer bike** (5, 7
or 9 seats). Everybody's real power is added up, the vehicle has one speed and
one position, and nobody gets dropped. See
[ADR 14](adr/0014-shared-vehicles-as-linked-riders.md) for the design.

## Riding one

1. The host opens *Create a vehicle* in the ride menu, picks Tandem or Beer
   bike and the number of seats, decides whether *Bots fill free seats* (on by
   default) and presses *Create*. The host becomes the captain.
2. The aboard panel shows a 6-character **code** with a Copy button.
3. Friends enter it with *Board with code* in the start menu (they join
   straight onto the vehicle) or in the ride menu (when they already ride; if
   the vehicle is on another route you move there). They take the first free
   seat, or the place of a bot.
4. *Leave* in the aboard panel gets you off; you ride on alone from the same
   spot at the vehicle's speed.

Codes use the letters and digits without look-alikes (no `0`, `O`, `1`, `I`),
are not case sensitive and work as long as the vehicle exists.

## How it rides

- **Power:** the vehicle's power is the sum of all seats. A beer bike is heavy
  and blunt: nine riders at about 135 W each make roughly 20 km/h on the flat.
  Behind it other riders draft more than behind a normal bike.
- **Your trainer** feels the vehicle's grade, scaled by your own difficulty
  and gear. Gears are per rider: shifting only changes your resistance.
- **Cockpit:** the gauge shows your power, plus a line such as
  `Vehicle 980 W · you 21 %`. The seat panel lists name, watts and share of
  everyone aboard; bots are marked.
- **Recording:** your ride file and Strava get your real power with the
  vehicle's speed and distance. The summary names who rode with you and each
  seat's kJ.
- **Phones and the simulated trainer** can board; their power is summed like any
  other.

## The captain

The captain steers: lane changes and junction turns are theirs; for everybody
else the lane keys do nothing and a short note says *The captain steers*. On a beer
bike the captain sits at the rear end of the counter. If the captain leaves,
the next human in seat order takes over.

## Bots and empty seats

With *Bots fill free seats* the empty seats get seat bots that pedal the
group-ride pace of the humans aboard (2.8 W/kg with none). A newcomer replaces a
bot; a human who leaves is replaced by one. Without bots, empty seats add
nothing. A vehicle with no human left is removed, with its bots.

## Not possible yet

- Hopping onto open seats you meet on the road: you need a code.
- Seated riders can't join races or scheduled events, and entrants can't board.
- No vote on turns, no vehicle cosmetics.
- Vehicles are gone after a server restart.
- Not in the spin studio.
