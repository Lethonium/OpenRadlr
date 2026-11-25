//! Sending the account mails: over SMTP in production, to the log in development.

use crate::mail::{Rendered, BRAND_MARK, BRAND_MARK_CID};
use std::future::Future;
use std::pin::Pin;

pub type MailFuture<'a> = Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>>;

/// The language of the mail; the client sends the rider's UI language.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Language {
    English,
    German,
}

impl Language {
    pub fn from_tag(tag: Option<&str>) -> Self {
        match tag {
            Some(tag) if tag.to_ascii_lowercase().starts_with("de") => Self::German,
            _ => Self::English,
        }
    }
}

pub trait Mailer: Send + Sync {
    /// Sends a rendered mail (see [`crate::mail`]) to `to`.
    fn send<'a>(&'a self, to: &'a str, mail: &'a Rendered) -> MailFuture<'a>;
}

/// Development only: writes the mail's subject (and its code) to the log instead of sending it.
pub struct LogMailer;

impl Mailer for LogMailer {
    fn send<'a>(&'a self, to: &'a str, mail: &'a Rendered) -> MailFuture<'a> {
        Box::pin(async move {
            match &mail.code {
                Some(code) => tracing::warn!(%to, %code, "sign-in code (no SMTP configured, so it is only logged)"),
                None => tracing::warn!(%to, subject = %mail.subject, "mail (no SMTP configured, so it is only logged)"),
            }
            Ok(())
        })
    }
}

/// Where and how to send mail (`OPENRADLR_SMTP_*`).
#[derive(Clone)]
pub struct SmtpSettings {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    /// The sender, e.g. `OpenRadlr <noreply@openradlr.com>`.
    pub from: String,
    /// `true`: TLS from the first byte (port 465); `false`: STARTTLS (port 587).
    pub implicit_tls: bool,
}

impl std::fmt::Debug for SmtpSettings {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SmtpSettings")
            .field("host", &self.host)
            .field("port", &self.port)
            .field("username", &self.username)
            .field("password", &"(hidden)")
            .field("from", &self.from)
            .field("implicit_tls", &self.implicit_tls)
            .finish()
    }
}

pub struct SmtpMailer {
    transport: lettre::AsyncSmtpTransport<lettre::Tokio1Executor>,
    from: lettre::message::Mailbox,
}

impl SmtpMailer {
    pub fn new(settings: &SmtpSettings) -> Result<Self, String> {
        use lettre::transport::smtp::authentication::Credentials;
        use lettre::{AsyncSmtpTransport, Tokio1Executor};
        let builder = if settings.implicit_tls {
            AsyncSmtpTransport::<Tokio1Executor>::relay(&settings.host)
        } else {
            AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&settings.host)
        }
        .map_err(|e| format!("SMTP host {}: {e}", settings.host))?;
        let transport = builder
            .port(settings.port)
            .credentials(Credentials::new(settings.username.clone(), settings.password.clone()))
            .timeout(Some(std::time::Duration::from_secs(20)))
            .build();
        let from = settings
            .from
            .parse()
            .map_err(|e| format!("sender {:?}: {e}", settings.from))?;
        Ok(Self { transport, from })
    }
}

impl Mailer for SmtpMailer {
    fn send<'a>(&'a self, to: &'a str, mail: &'a Rendered) -> MailFuture<'a> {
        Box::pin(async move {
            use lettre::message::{header::ContentType, Attachment, MultiPart, SinglePart};
            use lettre::AsyncTransport as _;
            // Plain text first, then the HTML with the brand mark it shows inline.
            let html = MultiPart::related()
                .singlepart(SinglePart::html(mail.html.clone()))
                .singlepart(Attachment::new_inline(BRAND_MARK_CID.to_owned()).body(
                    BRAND_MARK.to_vec(),
                    ContentType::parse("image/png").expect("a valid content type"),
                ));
            let body = MultiPart::alternative()
                .singlepart(SinglePart::plain(mail.text.clone()))
                .multipart(html);
            let message = lettre::Message::builder()
                .from(self.from.clone())
                .to(to.parse().map_err(|e| format!("recipient: {e}"))?)
                .subject(mail.subject.clone())
                .multipart(body)
                .map_err(|e| format!("building the mail: {e}"))?;
            self.transport
                .send(message)
                .await
                .map(|_| ())
                .map_err(|e| format!("sending the mail: {e}"))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn german_riders_get_german_mails() {
        assert_eq!(Language::from_tag(Some("de-AT")), Language::German);
        assert_eq!(Language::from_tag(Some("en-GB")), Language::English);
        assert_eq!(Language::from_tag(None), Language::English);
    }

    #[test]
    fn the_smtp_password_is_not_debug_printed() {
        let settings = SmtpSettings {
            host: "smtp.example.org".into(),
            port: 587,
            username: "u".into(),
            password: "hunter2".into(), // pragma: allowlist secret (a test placeholder)
            from: "a@example.org".into(),
            implicit_tls: false,
        };
        assert!(!format!("{settings:?}").contains("hunter2"));
    }
}
