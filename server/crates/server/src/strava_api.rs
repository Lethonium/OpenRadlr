//! The HTTP calls to Strava: token exchange and refresh, uploads, marking
//! activities as virtual rides.

use crate::strava::{StravaConfig, TokenResponse, UploadStatus};

const TOKEN_URL: &str = "https://www.strava.com/oauth/token";
const UPLOADS_URL: &str = "https://www.strava.com/api/v3/uploads";
const ACTIVITIES_URL: &str = "https://www.strava.com/api/v3/activities";

#[derive(Debug)]
pub struct StravaError(pub String);

impl std::fmt::Display for StravaError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for StravaError {}

impl From<reqwest::Error> for StravaError {
    fn from(error: reqwest::Error) -> Self {
        StravaError(error.to_string())
    }
}

async fn token_request(http: &reqwest::Client, form: &[(&str, &str)]) -> Result<TokenResponse, StravaError> {
    let response = http.post(TOKEN_URL).form(form).send().await?;
    if !response.status().is_success() {
        return Err(StravaError(format!(
            "token request failed with HTTP {}",
            response.status()
        )));
    }
    Ok(response.json().await?)
}

/// Trades the code from the OAuth callback for tokens and the athlete.
pub async fn exchange_code(
    http: &reqwest::Client,
    config: &StravaConfig,
    code: &str,
) -> Result<TokenResponse, StravaError> {
    token_request(
        http,
        &[
            ("client_id", config.client_id.as_str()),
            ("client_secret", config.client_secret.as_str()),
            ("code", code),
            ("grant_type", "authorization_code"),
        ],
    )
    .await
}

pub async fn refresh(
    http: &reqwest::Client,
    config: &StravaConfig,
    refresh_token: &str,
) -> Result<TokenResponse, StravaError> {
    token_request(
        http,
        &[
            ("client_id", config.client_id.as_str()),
            ("client_secret", config.client_secret.as_str()),
            ("refresh_token", refresh_token),
            ("grant_type", "refresh_token"),
        ],
    )
    .await
}

/// A ride file the client sends for upload.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RideFile {
    /// A FIT activity: the client marks it a virtual ride (`sub_sport`), so
    /// Strava files it as one and keeps its elevation.
    Fit(Vec<u8>),
    /// TCX, from older clients: Strava makes it a plain ride and replaces its
    /// elevation from its map.
    Tcx(String),
}

impl RideFile {
    /// Recognises a FIT file by its header or a TCX file by its root element.
    pub fn detect(body: &[u8]) -> Option<Self> {
        if body.len() > 14 && &body[8..12] == b".FIT" {
            return Some(RideFile::Fit(body.to_vec()));
        }
        let text = std::str::from_utf8(body).ok()?.trim_start_matches('\u{feff}');
        (text.trim_start().starts_with("<?xml") && text.contains("<TrainingCenterDatabase"))
            .then(|| RideFile::Tcx(text.to_owned()))
    }
}

/// The activity description. Strava descriptions are plain text, but it turns
/// full URLs into links, so the server links to itself.
pub fn description(public_url: &str) -> String {
    format!("Ridden on OpenRadlr: {public_url}")
}

/// Uploads a ride file. A TCX ride is turned into a virtual ride by
/// [`mark_virtual_ride`] once it is processed (where Strava allows it).
pub async fn upload(
    http: &reqwest::Client,
    access_token: &str,
    ride: RideFile,
    name: &str,
    description: &str,
    external_id: &str,
) -> Result<UploadStatus, StravaError> {
    let (file, data_type) = match ride {
        RideFile::Fit(bytes) => (
            reqwest::multipart::Part::bytes(bytes)
                .file_name("openradlr.fit")
                .mime_str("application/vnd.ant.fit")?,
            "fit",
        ),
        RideFile::Tcx(text) => (
            reqwest::multipart::Part::text(text)
                .file_name("openradlr.tcx")
                .mime_str("application/vnd.garmin.tcx+xml")?,
            "tcx",
        ),
    };
    let form = reqwest::multipart::Form::new()
        .part("file", file)
        .text("data_type", data_type)
        .text("name", name.to_owned())
        .text("description", description.to_owned())
        .text("external_id", external_id.to_owned());
    let response = http
        .post(UPLOADS_URL)
        .bearer_auth(access_token)
        .multipart(form)
        .send()
        .await?;
    if !response.status().is_success() {
        return Err(StravaError(format!("upload failed with HTTP {}", response.status())));
    }
    Ok(response.json().await?)
}

/// Sets the sport type to `VirtualRide`: Strava keeps those off real-world
/// segments and outdoor stats but still shows the map. (The upload API has no
/// field for the sport type, and TCX only knows "Biking".)
pub async fn mark_virtual_ride(
    http: &reqwest::Client,
    access_token: &str,
    activity_id: u64,
) -> Result<(), StravaError> {
    let response = http
        .put(format!("{ACTIVITIES_URL}/{activity_id}"))
        .bearer_auth(access_token)
        .json(&serde_json::json!({ "sport_type": "VirtualRide" }))
        .send()
        .await?;
    if !response.status().is_success() {
        return Err(StravaError(format!(
            "updating the activity failed with HTTP {}",
            response.status()
        )));
    }
    Ok(())
}

/// Asks Strava whether an upload became an activity yet.
pub async fn upload_status(
    http: &reqwest::Client,
    access_token: &str,
    upload_id: u64,
) -> Result<UploadStatus, StravaError> {
    let response = http
        .get(format!("{UPLOADS_URL}/{upload_id}"))
        .bearer_auth(access_token)
        .send()
        .await?;
    if !response.status().is_success() {
        return Err(StravaError(format!(
            "upload status failed with HTTP {}",
            response.status()
        )));
    }
    Ok(response.json().await?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn description_links_to_the_server() {
        assert_eq!(
            description("https://ride.example.com"),
            "Ridden on OpenRadlr: https://ride.example.com"
        );
    }

    #[test]
    fn ride_files_are_recognised_by_their_content() {
        let mut fit = vec![14, 0x20, 0x54, 0x08, 0, 0, 0, 0];
        fit.extend_from_slice(b".FIT");
        fit.extend_from_slice(&[0, 0, 1, 2]);
        assert_eq!(RideFile::detect(&fit), Some(RideFile::Fit(fit.clone())));
        let tcx = "\u{feff}<?xml version=\"1.0\"?><TrainingCenterDatabase/>";
        assert!(matches!(RideFile::detect(tcx.as_bytes()), Some(RideFile::Tcx(t)) if t.starts_with("<?xml")));
        assert_eq!(RideFile::detect(b"<?xml version=\"1.0\"?><gpx/>"), None);
        assert_eq!(RideFile::detect(&[0xff, 0xfe, 0x00]), None);
    }
}
