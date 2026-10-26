//! Routes: a polyline with elevation that riders follow.
//!
//! The server only ever needs the distance along the route and the grade at
//! that distance. Rendering geometry and decoration seeds are carried along so
//! that clients get the identical route from the server.
//!
//! Every route is treated as a loop in the POC: a rider who reaches the end
//! continues at the start. If the last point does not coincide with the first,
//! a closing segment back to the start is added.

use std::fmt;

/// Metres of road a grade is measured over (riding the route and on the
/// network): long enough to even out the steps between points, short enough
/// that climbs still begin where they do.
pub const GRADE_WINDOW_M: f64 = 50.0;

/// A route vertex in metres. `x`/`y` are horizontal, `elevation` is height.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
    pub elevation: f64,
}

impl Point {
    pub const fn new(x: f64, y: f64, elevation: f64) -> Self {
        Self { x, y, elevation }
    }

    fn horizontal_distance(&self, other: &Point) -> f64 {
        ((other.x - self.x).powi(2) + (other.y - self.y).powi(2)).sqrt()
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum MarkerKind {
    StartFinish,
    Sprint { length: f64 },
    Climb { length: f64 },
}

#[derive(Debug, Clone, PartialEq)]
pub struct Marker {
    pub kind: MarkerKind,
    pub distance: f64,
}

/// One road of a route on a road network (ADR 0010, #14): the stretch
/// `[from, to)` of the route rides the road `edge` in direction `dir` (1 from
/// its first point to its last, -1 back) over its whole `length`.
#[derive(Debug, Clone, PartialEq)]
pub struct WalkStep {
    pub edge: String,
    pub dir: i8,
    pub from: f64,
    pub to: f64,
    /// The road's own length (the route's stretch differs by its rounded corners).
    pub length: f64,
}

/// Where on the network a route distance lies: the walk's step, and how far
/// along its road in riding direction (metres of the road, from where the
/// route enters it).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct EdgePosition {
    pub step: usize,
    pub offset: f64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RouteError {
    TooFewPoints,
    ZeroLength,
    NoLanes,
    /// The walk does not cover the route from 0 to its end, one step after the other.
    BrokenWalk,
}

impl fmt::Display for RouteError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RouteError::TooFewPoints => write!(f, "a route needs at least two points"),
            RouteError::ZeroLength => write!(f, "a route must have a positive length"),
            RouteError::NoLanes => write!(f, "a route needs at least one lane"),
            RouteError::BrokenWalk => write!(f, "the walk must cover the route step after step"),
        }
    }
}

impl std::error::Error for RouteError {}

/// Everything needed to build a [`Route`].
#[derive(Debug, Clone)]
pub struct RouteSpec {
    pub id: String,
    pub name: String,
    pub lanes: u8,
    pub seed: u64,
    pub points: Vec<Point>,
    pub markers: Vec<Marker>,
    /// The roads the route rides, if it lies on a road network; empty otherwise.
    pub walk: Vec<WalkStep>,
}

#[derive(Debug, Clone)]
pub struct Route {
    id: String,
    name: String,
    lanes: u8,
    seed: u64,
    markers: Vec<Marker>,
    walk: Vec<WalkStep>,
    /// Vertices including the closing vertex back to the start.
    nodes: Vec<Point>,
    /// Distance from the start at each node; `cumulative[0] == 0`.
    cumulative: Vec<f64>,
    length: f64,
}

impl Route {
    pub fn new(spec: RouteSpec) -> Result<Self, RouteError> {
        if spec.lanes == 0 {
            return Err(RouteError::NoLanes);
        }
        if spec.points.len() < 2 {
            return Err(RouteError::TooFewPoints);
        }

        let mut nodes = spec.points;
        let first = nodes[0];
        let last = nodes[nodes.len() - 1];
        if first.horizontal_distance(&last) > 1e-6 {
            nodes.push(first);
        }

        let mut cumulative = Vec::with_capacity(nodes.len());
        let mut total = 0.0;
        cumulative.push(0.0);
        for pair in nodes.windows(2) {
            total += pair[0].horizontal_distance(&pair[1]);
            cumulative.push(total);
        }
        if total <= 0.0 {
            return Err(RouteError::ZeroLength);
        }
        if !spec.walk.is_empty() {
            // The steps follow each other from 0 to the end (a metre of slack at the end).
            let mut at = 0.0;
            for step in &spec.walk {
                let joined = (step.from - at).abs() < 1e-6;
                if !joined || step.to <= step.from || step.length <= 0.0 || !matches!(step.dir, 1 | -1) {
                    return Err(RouteError::BrokenWalk);
                }
                at = step.to;
            }
            if (at - total).abs() > 1.0 {
                return Err(RouteError::BrokenWalk);
            }
        }

        Ok(Self {
            id: spec.id,
            name: spec.name,
            lanes: spec.lanes,
            seed: spec.seed,
            markers: spec.markers,
            walk: spec.walk,
            nodes,
            cumulative,
            length: total,
        })
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn lanes(&self) -> u8 {
        self.lanes
    }

    pub fn seed(&self) -> u64 {
        self.seed
    }

    pub fn markers(&self) -> &[Marker] {
        &self.markers
    }

    /// The roads the route rides (empty off the road network).
    pub fn walk(&self) -> &[WalkStep] {
        &self.walk
    }

    /// The road under route distance `distance`, or `None` off the network.
    pub fn edge_at(&self, distance: f64) -> Option<EdgePosition> {
        if self.walk.is_empty() {
            return None;
        }
        let d = self.wrap(distance);
        let step = self.walk.partition_point(|s| s.to <= d).min(self.walk.len() - 1);
        let s = &self.walk[step];
        let t = ((d - s.from) / (s.to - s.from)).clamp(0.0, 1.0);
        Some(EdgePosition {
            step,
            offset: t * s.length,
        })
    }

    /// Total length of one lap in metres.
    pub fn length(&self) -> f64 {
        self.length
    }

    /// Maps any distance (also negative or beyond one lap) onto `[0, length)`.
    pub fn wrap(&self, distance: f64) -> f64 {
        let wrapped = distance.rem_euclid(self.length);
        if wrapped >= self.length {
            0.0
        } else {
            wrapped
        }
    }

    /// Distance from `from` forward to `to` along the loop, in `[0, length)`.
    pub fn forward_gap(&self, from: f64, to: f64) -> f64 {
        self.wrap(to - from)
    }

    /// Shortest distance between two positions along the loop, in either direction.
    pub fn loop_distance(&self, a: f64, b: f64) -> f64 {
        let forward = self.forward_gap(a, b);
        forward.min(self.length - forward)
    }

    /// Index of the segment containing `distance` and the fraction along it.
    fn locate(&self, distance: f64) -> (usize, f64) {
        let d = self.wrap(distance);
        let upper = self.cumulative.partition_point(|&c| c <= d);
        let segment = upper.saturating_sub(1).min(self.nodes.len() - 2);
        let start = self.cumulative[segment];
        let span = self.cumulative[segment + 1] - start;
        let t = if span > 0.0 { (d - start) / span } else { 0.0 };
        (segment, t.clamp(0.0, 1.0))
    }

    pub fn elevation_at(&self, distance: f64) -> f64 {
        let (i, t) = self.locate(distance);
        let a = self.nodes[i].elevation;
        let b = self.nodes[i + 1].elevation;
        a + (b - a) * t
    }

    /// Grade in percent (rise over horizontal run) at the given distance,
    /// measured over [`GRADE_WINDOW_M`] around it: a route's points are a few
    /// metres apart and its grade would jump at each of them, which a trainer
    /// passes on as spikes in resistance.
    pub fn grade_at(&self, distance: f64) -> f64 {
        let half = (GRADE_WINDOW_M / 2.0).min(self.length / 2.0);
        let rise = self.elevation_at(distance + half) - self.elevation_at(distance - half);
        rise / (2.0 * half) * 100.0
    }

    /// Horizontal position at the given distance.
    pub fn position_at(&self, distance: f64) -> (f64, f64) {
        let (i, t) = self.locate(distance);
        let a = self.nodes[i];
        let b = self.nodes[i + 1];
        (a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A 1000 m square loop: 250 m flat, 250 m climbing 10 m, 250 m flat, 250 m descending.
    pub(crate) fn square_loop() -> Route {
        Route::new(square_loop_spec()).expect("valid route")
    }

    pub(crate) fn square_loop_spec() -> RouteSpec {
        RouteSpec {
            id: "square".into(),
            name: "Square".into(),
            lanes: 4,
            seed: 1,
            points: vec![
                Point::new(0.0, 0.0, 100.0),
                Point::new(250.0, 0.0, 100.0),
                Point::new(250.0, 250.0, 110.0),
                Point::new(0.0, 250.0, 110.0),
            ],
            markers: vec![],
            walk: vec![],
        }
    }

    /// A long, completely flat loop for physics tests.
    pub(crate) fn flat_loop(length: f64) -> Route {
        Route::new(RouteSpec {
            id: "flat".into(),
            name: "Flat".into(),
            lanes: 4,
            seed: 1,
            points: vec![Point::new(0.0, 0.0, 0.0), Point::new(length / 2.0, 0.0, 0.0)],
            markers: vec![],
            walk: vec![],
        })
        .expect("valid route")
    }

    #[test]
    fn closes_the_loop_automatically() {
        assert!((square_loop().length() - 1000.0).abs() < 1e-9);
    }

    #[test]
    fn rejects_invalid_routes() {
        let base = RouteSpec {
            id: "x".into(),
            name: "x".into(),
            lanes: 1,
            seed: 0,
            points: vec![Point::new(0.0, 0.0, 0.0)],
            markers: vec![],
            walk: vec![],
        };
        assert_eq!(Route::new(base.clone()).unwrap_err(), RouteError::TooFewPoints);

        let no_lanes = RouteSpec {
            lanes: 0,
            ..base.clone()
        };
        assert_eq!(Route::new(no_lanes).unwrap_err(), RouteError::NoLanes);

        let zero = RouteSpec {
            points: vec![Point::new(1.0, 1.0, 0.0), Point::new(1.0, 1.0, 5.0)],
            ..base
        };
        assert_eq!(Route::new(zero).unwrap_err(), RouteError::ZeroLength);
    }

    #[test]
    fn grade_matches_segment_slope() {
        let route = square_loop();
        assert!((route.grade_at(100.0) - 0.0).abs() < 1e-9);
        assert!((route.grade_at(300.0) - 4.0).abs() < 1e-9);
        assert!((route.grade_at(900.0) + 4.0).abs() < 1e-9);
    }

    #[test]
    fn grade_eases_into_a_climb_over_the_window() {
        let route = square_loop();
        // The climb starts at 250 m: half of the window lies on it there.
        assert!((route.grade_at(250.0) - 2.0).abs() < 1e-9);
        assert!((route.grade_at(230.0) - 0.4).abs() < 1e-9);
        assert!((route.grade_at(275.0) - 4.0).abs() < 1e-9);
        // Across the start of the loop, after the descent.
        assert!((route.grade_at(0.0) + 2.0).abs() < 1e-9);
    }

    #[test]
    fn elevation_is_interpolated() {
        let route = square_loop();
        assert!((route.elevation_at(375.0) - 105.0).abs() < 1e-9);
    }

    #[test]
    fn distances_wrap_around_the_loop() {
        let route = square_loop();
        assert!((route.wrap(1250.0) - 250.0).abs() < 1e-9);
        assert!((route.wrap(-100.0) - 900.0).abs() < 1e-9);
        assert!((route.grade_at(1300.0) - route.grade_at(300.0)).abs() < 1e-9);
    }

    #[test]
    fn gaps_respect_the_loop() {
        let route = square_loop();
        assert!((route.forward_gap(990.0, 10.0) - 20.0).abs() < 1e-9);
        assert!((route.forward_gap(10.0, 990.0) - 980.0).abs() < 1e-9);
        assert!((route.loop_distance(10.0, 990.0) - 20.0).abs() < 1e-9);
    }

    pub(crate) fn step(edge: &str, dir: i8, from: f64, to: f64, length: f64) -> WalkStep {
        WalkStep {
            edge: edge.into(),
            dir,
            from,
            to,
            length,
        }
    }

    #[test]
    fn route_distance_maps_onto_the_walks_roads() {
        let route = Route::new(RouteSpec {
            walk: vec![step("a", 1, 0.0, 500.0, 510.0), step("b", -1, 500.0, 1000.0, 500.0)],
            ..square_loop_spec()
        })
        .unwrap();
        assert_eq!(route.edge_at(0.0), Some(EdgePosition { step: 0, offset: 0.0 }));
        let mid = route.edge_at(250.0).unwrap();
        assert_eq!(mid.step, 0);
        assert!((mid.offset - 255.0).abs() < 1e-9, "scaled to the road's own length");
        assert_eq!(route.edge_at(750.0), Some(EdgePosition { step: 1, offset: 250.0 }));
        assert_eq!(route.edge_at(1250.0), route.edge_at(250.0), "wraps with the loop");
        assert_eq!(square_loop().edge_at(10.0), None);
    }

    #[test]
    fn a_walk_must_cover_the_route() {
        let broken = |walk| {
            Route::new(RouteSpec {
                walk,
                ..square_loop_spec()
            })
            .unwrap_err()
        };
        assert_eq!(broken(vec![step("a", 1, 0.0, 400.0, 400.0)]), RouteError::BrokenWalk);
        assert_eq!(
            broken(vec![
                step("a", 1, 0.0, 400.0, 400.0),
                step("b", 1, 450.0, 1000.0, 550.0)
            ]),
            RouteError::BrokenWalk
        );
        assert_eq!(broken(vec![step("a", 0, 0.0, 1000.0, 1000.0)]), RouteError::BrokenWalk);
    }

    #[test]
    fn position_is_interpolated() {
        let (x, y) = square_loop().position_at(375.0);
        assert!((x - 250.0).abs() < 1e-9);
        assert!((y - 125.0).abs() < 1e-9);
    }
}
