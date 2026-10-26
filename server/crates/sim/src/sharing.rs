//! Power sharing for group rides.
//!
//! Riders far off the front of the group give a share of their power to riders far
//! off the back, the way a group rides together at a common effort. This module is
//! pure math: the caller feeds it the members once per second and applies
//! `received_w - given_w` as a power adjustment. Watts given always equal watts
//! received.

use std::collections::HashMap;

use crate::RiderId;

/// Tuning constants for power sharing.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SharingTuning {
    /// Gap (s) from the median rider before anyone gives or receives.
    pub threshold_s: f64,
    /// Further gap (s) over which the share ramps from zero to full.
    pub ramp_s: f64,
    /// Largest fraction of its power a giver gives.
    pub max_share: f64,
    /// Easing time constant (s) for the share changing.
    pub ease_s: f64,
    /// Most a receiver gets, as a fraction of its own power.
    pub max_boost: f64,
    /// Floor (m/s) on the median's speed when converting distance to a time gap.
    pub min_speed: f64,
}

impl Default for SharingTuning {
    fn default() -> Self {
        Self {
            threshold_s: 15.0,
            ramp_s: 30.0,
            max_share: 0.40,
            ease_s: 3.0,
            max_boost: 1.0,
            min_speed: 3.0,
        }
    }
}

/// One rider of the group at this moment.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Member {
    pub id: RiderId,
    /// Distance since the event start (m).
    pub distance_m: f64,
    /// Current speed (m/s).
    pub speed: f64,
    /// Rider's own power (W).
    pub power: f64,
}

/// What one rider gives and receives.
#[derive(Debug, Clone, PartialEq)]
pub struct Flow {
    pub id: RiderId,
    /// Time gap to the median rider (s); positive is ahead.
    pub gap_s: f64,
    pub given_w: f64,
    pub received_w: f64,
    /// Receivers of this rider's watts, largest first, at most 3.
    pub to: Vec<(RiderId, f64)>,
    /// Givers to this rider, largest first, at most 3.
    pub from: Vec<(RiderId, f64)>,
}

/// Eased giving and receiving weights, kept per rider between updates.
#[derive(Debug, Default)]
pub struct Sharing {
    eased: HashMap<RiderId, (f64, f64)>,
}

const LISTED: usize = 3;

fn top(mut list: Vec<(RiderId, f64)>) -> Vec<(RiderId, f64)> {
    list.sort_by(|a, b| b.1.total_cmp(&a.1));
    list.truncate(LISTED);
    list
}

impl Sharing {
    /// Advance by `dt` seconds. Returns one [`Flow`] per member, in the same order.
    pub fn update(&mut self, members: &[Member], tuning: &SharingTuning, dt: f64) -> Vec<Flow> {
        let ids: Vec<RiderId> = members.iter().map(|m| m.id).collect();
        self.eased.retain(|id, _| ids.contains(id));
        if members.is_empty() {
            return Vec::new();
        }

        // Lower median by distance.
        let mut order: Vec<usize> = (0..members.len()).collect();
        order.sort_by(|&a, &b| members[a].distance_m.total_cmp(&members[b].distance_m));
        let median = &members[order[(members.len() - 1) / 2]];
        let speed = median.speed.max(tuning.min_speed);

        let k = 1.0 - (-dt / tuning.ease_s).exp();
        let mut gaps = Vec::with_capacity(members.len());
        let mut g = Vec::with_capacity(members.len());
        let mut w = Vec::with_capacity(members.len());
        for m in members {
            let gap = (m.distance_m - median.distance_m) / speed;
            let g_target = tuning.max_share * ((gap - tuning.threshold_s) / tuning.ramp_s).clamp(0.0, 1.0);
            let w_target = ((-gap - tuning.threshold_s) / tuning.ramp_s).clamp(0.0, 1.0);
            let state = self.eased.entry(m.id).or_insert((0.0, 0.0));
            state.0 += (g_target - state.0) * k;
            state.1 += (w_target - state.1) * k;
            gaps.push(gap);
            g.push(state.0);
            w.push(state.1);
        }

        let pool: f64 = members.iter().zip(&g).map(|(m, g)| g * m.power.max(0.0)).sum();
        let w_sum: f64 = w.iter().sum();
        let received: Vec<f64> = if pool > 0.0 && w_sum > 0.0 {
            members
                .iter()
                .zip(&w)
                .map(|(m, w)| (pool * w / w_sum).min(tuning.max_boost * m.power.max(0.0)))
                .collect()
        } else {
            vec![0.0; members.len()]
        };
        let total: f64 = received.iter().sum();

        let mut flows: Vec<Flow> = members
            .iter()
            .zip(&gaps)
            .map(|(m, &gap_s)| Flow {
                id: m.id,
                gap_s,
                given_w: 0.0,
                received_w: 0.0,
                to: Vec::new(),
                from: Vec::new(),
            })
            .collect();
        if total <= 0.0 {
            return flows;
        }

        let mut to: Vec<Vec<(RiderId, f64)>> = vec![Vec::new(); members.len()];
        let mut from: Vec<Vec<(RiderId, f64)>> = vec![Vec::new(); members.len()];
        for (i, m) in members.iter().enumerate() {
            let given = g[i] * m.power.max(0.0) * total / pool;
            flows[i].given_w = given;
            if given <= 0.0 {
                continue;
            }
            for (j, r) in received.iter().enumerate() {
                if *r > 0.0 && j != i {
                    let watts = given * r / total;
                    to[i].push((members[j].id, watts));
                    from[j].push((m.id, watts));
                }
            }
        }
        for (i, flow) in flows.iter_mut().enumerate() {
            flow.received_w = received[i];
            flow.to = top(std::mem::take(&mut to[i]));
            flow.from = top(std::mem::take(&mut from[i]));
        }
        flows
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SPEED: f64 = 10.0;

    /// A member `gap_s` seconds ahead of the median rider (at 1 000 m).
    fn member(id: RiderId, gap_s: f64, power: f64) -> Member {
        Member {
            id,
            distance_m: 1000.0 + gap_s * SPEED,
            speed: SPEED,
            power,
        }
    }

    fn settle(sharing: &mut Sharing, members: &[Member], updates: usize) -> Vec<Flow> {
        let tuning = SharingTuning::default();
        let mut flows = Vec::new();
        for _ in 0..updates {
            flows = sharing.update(members, &tuning, 1.0);
        }
        flows
    }

    fn totals(flows: &[Flow]) -> (f64, f64) {
        (
            flows.iter().map(|f| f.given_w).sum(),
            flows.iter().map(|f| f.received_w).sum(),
        )
    }

    #[test]
    fn nobody_off_the_front_shares_nothing() {
        let members: Vec<Member> = [10.0, 5.0, 0.0, -5.0, -10.0]
            .iter()
            .enumerate()
            .map(|(i, g)| member(i as RiderId, *g, 250.0))
            .collect();
        let flows = settle(&mut Sharing::default(), &members, 20);
        assert_eq!(flows.len(), 5);
        for f in &flows {
            assert_eq!(f.given_w, 0.0);
            assert_eq!(f.received_w, 0.0);
            assert!(f.to.is_empty() && f.from.is_empty());
        }
    }

    #[test]
    fn given_equals_received() {
        let members = vec![
            member(1, 40.0, 300.0),
            member(2, 0.0, 200.0),
            member(3, 0.0, 200.0),
            member(4, -40.0, 150.0),
            member(5, -20.0, 180.0),
        ];
        let flows = settle(&mut Sharing::default(), &members, 20);
        let (given, received) = totals(&flows);
        assert!(given > 0.0);
        assert!((given - received).abs() < 1e-9);
        let far = flows.iter().find(|f| f.id == 4).unwrap();
        let near = flows.iter().find(|f| f.id == 5).unwrap();
        assert!(far.received_w > near.received_w);
        for f in &flows {
            assert!(f.to.len() <= 3 && f.from.len() <= 3);
        }
    }

    #[test]
    fn share_ramps_with_the_gap() {
        let members = vec![member(1, 45.0, 300.0), member(2, 0.0, 250.0), member(3, -45.0, 300.0)];
        let flows = settle(&mut Sharing::default(), &members, 30);
        assert!((flows[0].given_w - 120.0).abs() < 1.0, "{}", flows[0].given_w);
        assert!((flows[2].received_w - flows[0].given_w).abs() < 1e-9);
        assert_eq!(flows[0].to.len(), 1);
        assert_eq!(flows[0].to[0].0, 3);
        assert_eq!(flows[2].from[0].0, 1);
        assert_eq!(flows[1].given_w, 0.0);
        assert_eq!(flows[1].received_w, 0.0);
    }

    #[test]
    fn receiver_cap_scales_givers_down() {
        let members = vec![member(1, 45.0, 1000.0), member(2, 0.0, 200.0), member(3, -45.0, 50.0)];
        let flows = settle(&mut Sharing::default(), &members, 30);
        assert!(flows[2].received_w <= 50.0 + 1e-9);
        assert!(flows[2].received_w > 49.0);
        assert!((flows[0].given_w - flows[2].received_w).abs() < 1e-9);
    }

    #[test]
    fn easing_takes_seconds() {
        let members = vec![member(1, 45.0, 300.0), member(2, 0.0, 250.0), member(3, -45.0, 300.0)];
        let first = Sharing::default().update(&members, &SharingTuning::default(), 1.0);
        let settled = settle(&mut Sharing::default(), &members, 30);
        assert!(first[0].given_w > 0.0);
        assert!(first[0].given_w < 0.3 * settled[0].given_w);
    }

    #[test]
    fn leaving_member_is_forgotten() {
        let mut members = vec![
            member(1, 45.0, 300.0),
            member(2, 0.0, 250.0),
            member(5, 0.0, 250.0),
            member(3, -45.0, 300.0),
            member(4, -50.0, 300.0),
        ];
        let mut sharing = Sharing::default();
        settle(&mut sharing, &members, 20);
        members.retain(|m| m.id != 4);
        let flows = sharing.update(&members, &SharingTuning::default(), 1.0);
        assert_eq!(flows.len(), 4);
        assert!(flows.iter().all(|f| f.id != 4));
        let (given, received) = totals(&flows);
        assert!((given - received).abs() < 1e-9);
        assert!(flows.iter().all(|f| f.to.iter().chain(&f.from).all(|(id, _)| *id != 4)));
        // A rejoining rider starts from scratch.
        members.push(member(4, -50.0, 300.0));
        let first = sharing.update(&members, &SharingTuning::default(), 1.0);
        let settled = settle(&mut Sharing::default(), &members, 30);
        assert!(first[4].received_w < settled[4].received_w);
    }

    #[test]
    fn no_receivers_no_giving() {
        let members = vec![
            member(1, 60.0, 300.0),
            member(2, 0.0, 250.0),
            member(3, 0.0, 250.0),
            member(4, 0.0, 250.0),
        ];
        let flows = settle(&mut Sharing::default(), &members, 30);
        for f in &flows {
            assert_eq!(f.given_w, 0.0);
            assert_eq!(f.received_w, 0.0);
        }
    }

    #[test]
    fn degenerate_groups_are_safe() {
        let tuning = SharingTuning::default();
        let mut sharing = Sharing::default();
        assert!(sharing.update(&[], &tuning, 1.0).is_empty());
        let one = sharing.update(&[member(1, 0.0, 200.0)], &tuning, 1.0);
        assert_eq!(one.len(), 1);
        assert_eq!(one[0].given_w, 0.0);
        // Zero-power giver and receiver: nothing flows, nothing is NaN.
        let members = vec![member(1, 45.0, 0.0), member(2, 0.0, 200.0), member(3, -45.0, 0.0)];
        let flows = settle(&mut Sharing::default(), &members, 30);
        for f in &flows {
            assert!(f.given_w == 0.0 && f.received_w == 0.0);
        }
        // Zero-power receiver gets nothing (cap is +100 % of 0 W).
        let members = vec![member(1, 45.0, 300.0), member(2, 0.0, 200.0), member(3, -45.0, 0.0)];
        let flows = settle(&mut Sharing::default(), &members, 30);
        for f in &flows {
            assert!(f.given_w == 0.0 && f.received_w == 0.0);
        }
    }
}
