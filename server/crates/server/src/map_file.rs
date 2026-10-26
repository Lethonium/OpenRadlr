//! Road network files (ADR 0010, #26): one per shared map, in `maps/` next
//! to the route files. Clients draw the map from it (terrain, every road,
//! the cafés) and get it unchanged at `/api/map`; the server reads its
//! places and roads, so riders can turn at junctions (#15).

use openradlr_sim::network::{EdgeSpec, Network, NodeSpec};
use openradlr_sim::route::Point;
use serde::Deserialize;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

/// The parts of a network file the server reads; everything else is passed through.
#[derive(Debug, Deserialize)]
struct Outline {
    id: String,
    nodes: Vec<NodeFile>,
    edges: Vec<EdgeFile>,
}

#[derive(Debug, Deserialize)]
struct NodeFile {
    id: String,
    x: f64,
    y: f64,
}

#[derive(Debug, Deserialize)]
struct EdgeFile {
    id: String,
    from: String,
    to: String,
    /// `[x, y, elevation]` in metres.
    points: Vec<[f64; 3]>,
}

/// A loaded map: its file as served and its roads for the simulation.
#[derive(Debug, Clone)]
struct MapEntry {
    json: Arc<str>,
    network: Arc<Network>,
}

/// Network files by map id.
#[derive(Debug, Default, Clone)]
pub struct Maps(HashMap<String, MapEntry>);

impl Maps {
    /// The map's file as served.
    pub fn get(&self, id: &str) -> Option<Arc<str>> {
        self.0.get(id).map(|entry| Arc::clone(&entry.json))
    }

    /// The map's roads.
    pub fn network(&self, id: &str) -> Option<Arc<Network>> {
        self.0.get(id).map(|entry| Arc::clone(&entry.network))
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

/// Reads one network file: valid JSON with an id, places and roads between them.
fn parse(json: &str) -> Result<(String, Network), String> {
    let outline: Outline = serde_json::from_str(json).map_err(|e| format!("not a network file: {e}"))?;
    if outline.id.is_empty() || outline.nodes.is_empty() || outline.edges.is_empty() {
        return Err("a network needs an id, nodes and edges".to_owned());
    }
    let nodes: Vec<NodeSpec> = outline
        .nodes
        .into_iter()
        .map(|n| NodeSpec {
            id: n.id,
            x: n.x,
            y: n.y,
        })
        .collect();
    let edges = outline
        .edges
        .into_iter()
        .map(|e| EdgeSpec {
            id: e.id,
            from: e.from,
            to: e.to,
            points: e.points.iter().map(|&[x, y, z]| Point::new(x, y, z)).collect(),
        })
        .collect();
    let network = Network::new(&nodes, edges).map_err(|e| e.to_string())?;
    Ok((outline.id, network))
}

/// Loads every `*.json` in `dir` (a missing directory just means no maps).
/// Broken or duplicate files are skipped and reported as warnings.
pub fn load_maps(dir: &Path) -> (Maps, Vec<String>) {
    let mut maps = Maps::default();
    let mut warnings = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return (maps, warnings);
    };
    let mut paths: Vec<_> = entries
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .filter(|path| path.extension().and_then(|e| e.to_str()) == Some("json"))
        .collect();
    paths.sort();
    for path in paths {
        let loaded = std::fs::read_to_string(&path)
            .map_err(|e| e.to_string())
            .and_then(|json| parse(&json).map(|(id, network)| (id, network, json)));
        match loaded {
            Ok((id, _, _)) if maps.0.contains_key(&id) => {
                warnings.push(format!("skipping {}: map id {id:?} is already used", path.display()));
            }
            Ok((id, network, json)) => {
                maps.0.insert(
                    id,
                    MapEntry {
                        json: Arc::from(json),
                        network: Arc::new(network),
                    },
                );
            }
            Err(error) => warnings.push(format!("skipping {}: {error}", path.display())),
        }
    }
    (maps, warnings)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tiny(id: &str) -> String {
        format!(
            r#"{{"id":"{id}","extra":1,"nodes":[{{"id":"a","x":0,"y":0}},{{"id":"b","x":9,"y":0}}],
            "edges":[{{"id":"r","from":"a","to":"b","points":[[0,0,0],[9,0,0]]}}]}}"#
        )
    }

    #[test]
    fn parse_needs_an_id_nodes_and_edges() {
        let (id, network) = parse(&tiny("m")).unwrap();
        assert_eq!(id, "m");
        assert_eq!(network.edge_index("r"), Some(0));
        assert!(parse(r#"{"id":"m","nodes":[],"edges":[]}"#).is_err());
        assert!(
            parse(&tiny("m").replace(r#""to":"b""#, r#""to":"z""#)).is_err(),
            "unknown place"
        );
        assert!(parse(r#"{"nodes":[],"edges":[]}"#).is_err());
        assert!(parse("garbage").is_err());
    }

    #[test]
    fn load_maps_keeps_good_files_and_skips_the_rest() {
        let dir = std::env::temp_dir().join(format!("openradlr-maps-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.json"), tiny("valley")).unwrap();
        std::fs::write(dir.join("b.json"), tiny("valley")).unwrap();
        std::fs::write(dir.join("c.json"), "{").unwrap();
        std::fs::write(dir.join("notes.txt"), "ignored").unwrap();
        let (maps, warnings) = load_maps(&dir);
        std::fs::remove_dir_all(&dir).unwrap();
        assert_eq!(maps.len(), 1);
        assert!(maps.get("valley").unwrap().contains("\"valley\""));
        assert_eq!(warnings.len(), 2, "{warnings:?}");
    }

    #[test]
    fn a_missing_directory_means_no_maps() {
        let (maps, warnings) = load_maps(Path::new("/nonexistent/openradlr/maps"));
        assert!(maps.is_empty());
        assert!(warnings.is_empty());
    }

    #[test]
    fn the_bundled_network_loads() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../routes/maps");
        let (maps, warnings) = load_maps(&dir);
        assert!(warnings.is_empty(), "{warnings:?}");
        assert!(maps.get("valley").is_some());
        assert!(maps.network("valley").unwrap().edge_index("valley-east").is_some());
    }
}
