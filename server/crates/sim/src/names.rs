//! Bot names: a cast of made-up characters, a first name and a cycling pun
//! for a surname ("Gus Tailwind", "Penny Farthing", "Sally Sprocket"). All
//! invented, so no real person or film character is borrowed. A name also
//! fixes the character's riding type and team (see `bot::RidingStyle::of_name`
//! and `bot::Team::of_name`), so the same name rides the same way everywhere.

use crate::rng::RandomSource;

const FIRST_NAMES: &[&str] = &[
    "Lena",
    "Jonas",
    "Tomás",
    "Lucía",
    "Sofie",
    "Mads",
    "Giulia",
    "Marco",
    "Camille",
    "Hugo",
    "Femke",
    "Daan",
    "Kasia",
    "Piotr",
    "Ella",
    "Oliver",
    "Valentina",
    "Andrés",
    "Rita",
    "Gus",
    "Dolly",
    "Barry",
    "Penny",
    "Hank",
    "Patty",
    "Freddie",
    "Wendy",
    "Clint",
    "Sally",
    "Bonnie",
    "Kurt",
    "Molly",
    "Doug",
    "Gerry",
    "Ruby",
    "Otto",
    "Ingrid",
    "Rosa",
    "Nils",
    "Mila",
];

const SURNAMES: &[&str] = &[
    "Tailwind",
    "Freewheel",
    "Sprocket",
    "Derailleur",
    "Handlebar",
    "Spokes",
    "Cadence",
    "Crankshaw",
    "Chainring",
    "Bidon",
    "Musette",
    "Puncture",
    "Pannier",
    "Headwind",
    "Crosswind",
    "Switchback",
    "Hairpin",
    "Breakaway",
    "Slipstream",
    "Draftsworth",
    "Domestique",
    "Bonk",
    "Lowgear",
    "Bigring",
    "Cleats",
    "Bottlecage",
    "Toeclip",
    "Brakewell",
    "Tubeless",
    "Flatwhite",
    "Chamois",
    "Saddlesore",
    "Wheelie",
    "Bunnyhop",
    "Climbsworth",
    "Watts",
    "Sprintwell",
    "Cobbles",
    "Gravelly",
    "Farthing",
];

/// The easter egg of the cast: a rare rider in Team Zitrone's lemon yellow,
/// after the golden lemons on the road.
pub const LEMON_NAME: &str = "Goldie Lemon";

/// One new bot in this many is Goldie Lemon (while nobody else has the name).
const LEMON_ODDS: usize = 200;

/// Returns a cast name such as "Gus Tailwind" (now and then "Goldie Lemon").
pub fn generate(rng: &mut dyn RandomSource) -> String {
    if rng.index(LEMON_ODDS) == 0 {
        return LEMON_NAME.to_owned();
    }
    let first = FIRST_NAMES[rng.index(FIRST_NAMES.len())];
    let last = SURNAMES[rng.index(SURNAMES.len())];
    format!("{first} {last}")
}

/// Returns a generated name that is not contained in `taken`.
/// Falls back to appending a number if the name space is exhausted.
pub fn generate_unique(rng: &mut dyn RandomSource, taken: &[&str]) -> String {
    for _ in 0..32 {
        let candidate = generate(rng);
        if !taken.contains(&candidate.as_str()) {
            return candidate;
        }
    }
    let base = generate(rng);
    (2..)
        .map(|n| format!("{base} {n}"))
        .find(|candidate| !taken.contains(&candidate.as_str()))
        .expect("an unbounded range always yields a free name")
}

/// A stable 64-bit hash of a name (FNV-1a), the same on every server.
pub fn name_hash(name: &str) -> u64 {
    name.bytes().fold(0xcbf2_9ce4_8422_2325, |h, b| {
        (h ^ u64::from(b)).wrapping_mul(0x0100_0000_01b3)
    })
}

#[cfg(test)]
pub(crate) fn all_names() -> Vec<String> {
    FIRST_NAMES
        .iter()
        .flat_map(|f| SURNAMES.iter().map(move |l| format!("{f} {l}")))
        .chain([LEMON_NAME.to_owned()])
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rng::SplitMix64;

    #[test]
    fn names_are_a_first_name_and_a_cycling_surname() {
        let mut rng = SplitMix64::new(1);
        for _ in 0..200 {
            let name = generate(&mut rng);
            let (first, last) = name.split_once(' ').expect("two words");
            assert!(FIRST_NAMES.contains(&first) && SURNAMES.contains(&last), "{name}");
        }
    }

    #[test]
    fn the_cast_is_large_enough_for_a_full_server() {
        let mut all = all_names();
        all.sort();
        all.dedup();
        assert!(all.len() >= 1000, "{} names", all.len());
    }

    #[test]
    fn unique_names_avoid_taken_ones() {
        let mut rng = SplitMix64::new(1);
        let first = generate(&mut SplitMix64::new(1));
        let next = generate_unique(&mut rng, &[first.as_str()]);
        assert_ne!(first, next);
    }

    #[test]
    fn unique_names_fall_back_to_numbers_when_everything_is_taken() {
        let all = all_names();
        let taken: Vec<&str> = all.iter().map(String::as_str).collect();
        let name = generate_unique(&mut SplitMix64::new(5), &taken);
        assert!(name.ends_with(" 2"), "got {name}");
    }

    #[test]
    fn goldie_lemon_turns_up_now_and_then() {
        let mut rng = SplitMix64::new(3);
        let lemons = (0..20_000).filter(|_| generate(&mut rng) == LEMON_NAME).count();
        assert!((50..=150).contains(&lemons), "{lemons} in 20,000");
    }

    #[test]
    fn the_name_hash_is_stable() {
        assert_eq!(name_hash(""), 0xcbf2_9ce4_8422_2325);
        assert_eq!(name_hash("Gus Tailwind"), name_hash("Gus Tailwind"));
        assert_ne!(name_hash("Gus Tailwind"), name_hash("Gus Sprocket"));
    }
}
