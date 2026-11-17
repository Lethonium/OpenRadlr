# Artwork licence

The code of OpenRadlr is licensed under the [GNU AGPL v3](LICENSE). The
artwork is licensed separately, under the
[Creative Commons Attribution-ShareAlike 4.0 International licence](https://creativecommons.org/licenses/by-sa/4.0/)
(CC BY-SA 4.0).

## What counts as artwork

The image files in:

- `docs/assets/` (emblem, screenshots)
- `client/public/icons/` (app icons, favicons, brand mark)
- `landing/public/` and `landing/src/assets/` (landing page images and icons)

The 3D world, riders and vehicles are drawn by code in `client/public/js/`
and fall under the AGPL like the rest of the code.

## What you may do

Use, copy, change and share the artwork, also commercially and in forks, as
long as you:

- **credit it**: "Artwork © The OpenRadlr contributors, CC BY-SA 4.0", with a
  link to this repository, and say if you changed it;
- **share alike**: publish your changed versions under CC BY-SA 4.0 too.

## Scenery models

The 3D models under `client/public/assets/scenery/` are not the contributors'
work. They are imported from free packs and keep the licence they came with:
**CC0 1.0** in every case, so they impose nothing on anyone using, changing or
redistributing them.

| Kit | Source | Licence |
| --- | --- | --- |
| `nature` | [Nature Kit 2.1](https://kenney.nl/assets/nature-kit) by Kenney | CC0 1.0 |
| `racing` | [Racing Kit 2.0](https://kenney.nl/assets/racing-kit) by Kenney | CC0 1.0 |
| `fantasy-town` | [Fantasy Town Kit 2.0](https://kenney.nl/assets/fantasy-town-kit) by Kenney | CC0 1.0 |
| `quaternius-nature` | [Ultimate Nature Pack](https://quaternius.com/packs/ultimatenature.html) by Quaternius | CC0 1.0 |
| `quaternius-farm` | [LowPoly Farm Buildings](https://quaternius.itch.io/lowpoly-farm-buildings) by Quaternius | CC0 1.0 |

Each kit's `manifest.json` records the pack URL, the licence URL and the date
the models were taken, and `make scenery-check` fails if a kit claims
anything other than CC0. Every pack also ships its own `License.txt` saying
CC0 1.0, which is the evidence the manifests name.

The `fantasy-town` buildings (cottages, church, windmill) are assembled from
the pack's wall and roof parts by `tools/scenery/assemble.mjs` and recoloured;
they are combinations of Kenney's models, under the same CC0, and the pack's
`License.txt` sits beside them.

**CC0 only, and this is checked, not trusted.** Quaternius also publishes a
newer *Quaternius Asset License*, which forbids redistributing the models.
Their pack pages still link CC0, and CC0 cannot be withdrawn, so their packs
would stay free to redistribute — but a pack that shows the other licence is
not imported, however good it looks: this repository is public, so a model
here is a model everyone can download.

The two Quaternius kits in this repository are the CC0 packs. `quaternius-nature`
is the Ultimate Nature Pack; its own `License.txt` says CC0 1.0 and is copied
beside the kit. `quaternius-farm` is LowPoly Farm Buildings; its itch.io page
states CC0 1.0 and the pack has no separate licence file. Both were built with
`tools/scenery/assemble-quaternius.mjs`, which selects the models, writes a
cheap far twin and records the provenance in the manifest.

## Name and logo

The licence covers the copyright in the files, not the **OpenRadlr name or
the lemon logo as a brand**. See [TRADEMARKS.md](TRADEMARKS.md): a fork can
reuse the art, but must not present itself as OpenRadlr.
