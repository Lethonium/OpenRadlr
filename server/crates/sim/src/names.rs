//! Generated bot names in the form "Adjective Animal".

use crate::rng::RandomSource;

const ADJECTIVES: &[&str] = &[
    "Swift", "Brave", "Steady", "Lucky", "Sunny", "Rapid", "Quiet", "Bold", "Clever", "Gentle", "Mighty", "Nimble",
    "Jolly", "Calm", "Fierce", "Merry", "Rusty", "Silver", "Golden", "Breezy",
];

const ANIMALS: &[&str] = &[
    "Badger", "Falcon", "Otter", "Fox", "Heron", "Lynx", "Marmot", "Hare", "Ibex", "Kestrel", "Wolf", "Beaver",
    "Stoat", "Swallow", "Bison", "Puffin", "Gecko", "Moose", "Raven", "Panda",
];

/// Returns a name such as "Swift Badger".
pub fn generate(rng: &mut dyn RandomSource) -> String {
    let adjective = ADJECTIVES[rng.index(ADJECTIVES.len())];
    let animal = ANIMALS[rng.index(ANIMALS.len())];
    format!("{adjective} {animal}")
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rng::SplitMix64;

    #[test]
    fn names_have_two_words() {
        let mut rng = SplitMix64::new(1);
        let name = generate(&mut rng);
        assert_eq!(name.split(' ').count(), 2);
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
        let all: Vec<String> = ADJECTIVES
            .iter()
            .flat_map(|a| ANIMALS.iter().map(move |b| format!("{a} {b}")))
            .collect();
        let taken: Vec<&str> = all.iter().map(String::as_str).collect();
        let name = generate_unique(&mut SplitMix64::new(5), &taken);
        assert!(name.ends_with(" 2"), "got {name}");
    }
}
