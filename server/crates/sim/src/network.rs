//! The road network of a map (ADR 0010): places and the two-way roads
//! between them. Riders on a route follow its walk; riders who turn off it
//! at a junction (#15) ride the network road by road.

use crate::route::{Point, GRADE_WINDOW_M};
use std::collections::HashMap;
use std::fmt;

/// A road in one riding direction: the road's index in the network and 1
/// (along its points) or -1 (back).
pub type RoadKey = (u32, i8);

/// Metres into a road its heading is measured over, so a junction's small
/// kinks don't decide which way is straight on.
const HEADING_REACH: f64 = 40.0;

#[derive(Debug, Clone, PartialEq)]
pub struct NodeSpec {
    pub id: String,
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct EdgeSpec {
    pub id: String,
    pub from: String,
    pub to: String,
    pub points: Vec<Point>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NetworkError {
    UnknownPlace { edge: String, place: String },
    TooFewPoints(String),
    DuplicateEdge(String),
}

impl fmt::Display for NetworkError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            NetworkError::UnknownPlace { edge, place } => write!(f, "road {edge} joins unknown place {place}"),
            NetworkError::TooFewPoints(edge) => write!(f, "road {edge} needs two points and a length"),
            NetworkError::DuplicateEdge(edge) => write!(f, "road {edge} is listed twice"),
        }
    }
}

impl std::error::Error for NetworkError {}

#[derive(Debug, Clone)]
pub struct Edge {
    id: String,
    from: usize,
    to: usize,
    points: Vec<Point>,
    cumulative: Vec<f64>,
    length: f64,
}

impl Edge {
    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn length(&self) -> f64 {
        self.length
    }

    /// Segment index and fraction at `t` metres from the first point.
    fn locate(&self, t: f64) -> (usize, f64) {
        let t = t.clamp(0.0, self.length);
        let upper = self.cumulative.partition_point(|&c| c <= t);
        let segment = upper.saturating_sub(1).min(self.points.len() - 2);
        let start = self.cumulative[segment];
        let span = self.cumulative[segment + 1] - start;
        let f = if span > 0.0 { (t - start) / span } else { 0.0 };
        (segment, f.clamp(0.0, 1.0))
    }

    fn position_at(&self, t: f64) -> (f64, f64) {
        let (i, f) = self.locate(t);
        let (a, b) = (self.points[i], self.points[i + 1]);
        (a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f)
    }

    fn elevation_at(&self, t: f64) -> f64 {
        let (i, f) = self.locate(t);
        let (a, b) = (self.points[i].elevation, self.points[i + 1].elevation);
        a + (b - a) * f
    }

    /// Grade in percent along the points at `t` metres from the first point,
    /// over [`GRADE_WINDOW_M`] around it (shorter at the road's ends).
    fn grade_at(&self, t: f64) -> f64 {
        let half = GRADE_WINDOW_M / 2.0;
        let (a, b) = ((t - half).max(0.0), (t + half).min(self.length));
        if b <= a {
            return 0.0;
        }
        (self.elevation_at(b) - self.elevation_at(a)) / (b - a) * 100.0
    }
}

#[derive(Debug, Clone)]
pub struct Network {
    edges: Vec<Edge>,
    by_id: HashMap<String, u32>,
    /// Per place, the roads leaving it (in riding direction).
    leaving: Vec<Vec<RoadKey>>,
}

impl Network {
    pub fn new(nodes: &[NodeSpec], edges: Vec<EdgeSpec>) -> Result<Self, NetworkError> {
        let places: HashMap<&str, usize> = nodes.iter().enumerate().map(|(i, n)| (n.id.as_str(), i)).collect();
        let mut leaving = vec![Vec::new(); nodes.len()];
        let mut built = Vec::with_capacity(edges.len());
        let mut by_id = HashMap::new();
        for spec in edges {
            let place = |id: &str| {
                places.get(id).copied().ok_or_else(|| NetworkError::UnknownPlace {
                    edge: spec.id.clone(),
                    place: id.to_owned(),
                })
            };
            let (from, to) = (place(&spec.from)?, place(&spec.to)?);
            let mut cumulative = vec![0.0];
            for pair in spec.points.windows(2) {
                let run = (pair[1].x - pair[0].x).hypot(pair[1].y - pair[0].y);
                cumulative.push(cumulative.last().copied().unwrap_or(0.0) + run);
            }
            let length = cumulative.last().copied().unwrap_or(0.0);
            if spec.points.len() < 2 || length <= 0.0 {
                return Err(NetworkError::TooFewPoints(spec.id));
            }
            let index = built.len() as u32;
            if by_id.insert(spec.id.clone(), index).is_some() {
                return Err(NetworkError::DuplicateEdge(spec.id));
            }
            leaving[from].push((index, 1));
            leaving[to].push((index, -1));
            built.push(Edge {
                id: spec.id,
                from,
                to,
                points: spec.points,
                cumulative,
                length,
            });
        }
        Ok(Self {
            edges: built,
            by_id,
            leaving,
        })
    }

    pub fn len(&self) -> usize {
        self.edges.len()
    }

    pub fn is_empty(&self) -> bool {
        self.edges.is_empty()
    }

    pub fn edge_index(&self, id: &str) -> Option<u32> {
        self.by_id.get(id).copied()
    }

    /// # Panics
    /// If there is no road `index`.
    pub fn edge(&self, index: u32) -> &Edge {
        &self.edges[index as usize]
    }

    /// Metres along the road's points at `offset` metres in riding direction.
    fn along(&self, (edge, dir): RoadKey, offset: f64) -> f64 {
        let length = self.edge(edge).length;
        if dir > 0 {
            offset
        } else {
            length - offset
        }
    }

    /// Where a rider `offset` metres into road `key` is (map coordinates).
    pub fn position(&self, key: RoadKey, offset: f64) -> (f64, f64) {
        self.edge(key.0).position_at(self.along(key, offset))
    }

    /// Grade in percent in riding direction.
    pub fn grade(&self, key: RoadKey, offset: f64) -> f64 {
        self.edge(key.0).grade_at(self.along(key, offset)) * f64::from(key.1)
    }

    /// The place road `key` leads to.
    pub fn exit_place(&self, (edge, dir): RoadKey) -> usize {
        let edge = self.edge(edge);
        if dir > 0 {
            edge.to
        } else {
            edge.from
        }
    }

    /// Heading (radians, counter-clockwise from east) at `offset` metres in
    /// riding direction, over the next few metres.
    fn heading(&self, key: RoadKey, offset: f64, reach: f64) -> f64 {
        let (x0, y0) = self.position(key, offset);
        let (x1, y1) = self.position(key, offset + reach);
        (y1 - y0).atan2(x1 - x0)
    }

    /// How far a rider turns going from the end of `from` onto `onto`
    /// (radians, positive to the left).
    pub fn turn(&self, from: RoadKey, onto: RoadKey) -> f64 {
        let length = self.edge(from.0).length;
        let reach = HEADING_REACH.min(length / 2.0);
        let arriving = self.heading(from, length - reach, reach);
        let leaving = self.heading(onto, 0.0, HEADING_REACH.min(self.edge(onto.0).length / 2.0));
        let turn = leaving - arriving;
        turn.sin().atan2(turn.cos())
    }

    /// The roads a rider at the end of `key` can take: every road leaving
    /// that place except turning back.
    pub fn onward(&self, key: RoadKey) -> impl Iterator<Item = RoadKey> + '_ {
        self.leaving[self.exit_place(key)]
            .iter()
            .copied()
            .filter(move |&next| next != (key.0, -key.1))
    }

    /// The straightest way on from the end of `key` (back the way it came at
    /// a dead end).
    pub fn straight_on(&self, key: RoadKey) -> RoadKey {
        self.onward(key)
            .min_by(|&a, &b| self.turn(key, a).abs().total_cmp(&self.turn(key, b).abs()))
            .unwrap_or((key.0, -key.1))
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    fn node(id: &str, x: f64, y: f64) -> NodeSpec {
        NodeSpec { id: id.into(), x, y }
    }

    fn road(id: &str, from: &str, to: &str, points: &[(f64, f64, f64)]) -> EdgeSpec {
        EdgeSpec {
            id: id.into(),
            from: from.into(),
            to: to.into(),
            points: points.iter().map(|&(x, y, e)| Point::new(x, y, e)).collect(),
        }
    }

    /// A junction `j` at (1000, 0): `in` arrives from the west; `ahead`
    /// carries on east, `left` climbs north 10 m over 500 m, `right` goes
    /// south-east.
    pub(crate) fn crossroads() -> Network {
        Network::new(
            &[
                node("w", 0.0, 0.0),
                node("j", 1000.0, 0.0),
                node("e", 2000.0, 0.0),
                node("n", 1000.0, 500.0),
                node("s", 1700.0, -700.0),
            ],
            vec![
                road("in", "w", "j", &[(0.0, 0.0, 0.0), (1000.0, 0.0, 0.0)]),
                road("ahead", "j", "e", &[(1000.0, 0.0, 0.0), (2000.0, 0.0, 0.0)]),
                road("left", "j", "n", &[(1000.0, 0.0, 0.0), (1000.0, 500.0, 10.0)]),
                road("right", "s", "j", &[(1700.0, -700.0, 0.0), (1000.0, 0.0, 0.0)]),
            ],
        )
        .unwrap()
    }

    #[test]
    fn positions_and_grades_follow_the_riding_direction() {
        let net = crossroads();
        let left = net.edge_index("left").unwrap();
        assert_eq!(net.position((left, 1), 100.0), (1000.0, 100.0));
        assert_eq!(net.position((left, -1), 100.0), (1000.0, 400.0));
        assert!((net.grade((left, 1), 100.0) - 2.0).abs() < 1e-9);
        assert!((net.grade((left, -1), 100.0) + 2.0).abs() < 1e-9);
    }

    #[test]
    fn onward_roads_leave_the_junction_without_turning_back() {
        let net = crossroads();
        let id = |name| net.edge_index(name).unwrap();
        let arriving = (id("in"), 1);
        let mut onward: Vec<RoadKey> = net.onward(arriving).collect();
        onward.sort_unstable();
        assert_eq!(onward, vec![(id("ahead"), 1), (id("left"), 1), (id("right"), -1)]);
        assert_eq!(net.straight_on(arriving), (id("ahead"), 1));
        assert!(net.turn(arriving, (id("left"), 1)) > 1.5, "north is a left turn");
        assert!(
            net.turn(arriving, (id("right"), -1)) < -0.7,
            "south-east is a right turn"
        );
        // From the dead end in the north the only way is back.
        assert_eq!(net.straight_on((id("left"), 1)), (id("left"), -1));
    }

    #[test]
    fn broken_networks_are_refused() {
        let unknown = Network::new(
            &[node("a", 0.0, 0.0)],
            vec![road("r", "a", "b", &[(0.0, 0.0, 0.0), (1.0, 0.0, 0.0)])],
        );
        assert!(matches!(unknown, Err(NetworkError::UnknownPlace { .. })));
        let short = Network::new(&[node("a", 0.0, 0.0)], vec![road("r", "a", "a", &[(0.0, 0.0, 0.0)])]);
        assert_eq!(short.unwrap_err(), NetworkError::TooFewPoints("r".into()));
    }
}
